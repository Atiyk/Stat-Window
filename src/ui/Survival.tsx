import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { loadSlate } from '../content/inventory';
import type { Question } from '../content/schema';
import { gameReducer, type GameAction } from '../engine/game';
import type { StorageLike } from '../engine/storage';
import { potentialPoints } from '../engine/scoring';
import { trackOnce, track, type ShareMethod } from '../lib/track';
import { formatDay } from '../lib/format';
import type { SurvivalCatalog } from '../survival/catalog';
import {
  currentRound,
  endReason,
  isOver,
  newRun,
  roundState,
  runScore,
  runStatus,
  survives,
  type SurvivalRun,
} from '../survival/engine';
import { loadPool } from '../survival/gate';
import type { Supply } from '../survival/pool';
import { need, RULESET, SURVIVAL_ROUNDS } from '../survival/rules';
import { newSeed, pickRun } from '../survival/select';
import { createSurvivalStore, SURVIVAL_KEY, SURVIVAL_PREVIEW_KEY, type SurvivalStore } from '../survival/storage';
import { Round } from './Round';
import { SURVIVAL_FLAG } from '../survival/flag';

type Props = {
  /** Real UTC day. */
  today: string;
  /** Preview builds only: pretend it is this UTC day. */
  asOf: string | null;
  /** How the player got here, for the start event. */
  source: 'cta' | 'link';
  /** The public flag requires the beta gate; preview only needs one playable run. */
  requireBeta: boolean;
  storage: StorageLike | null;
  onBackToDaily: () => void;
};

type Loaded = { catalog: SurvivalCatalog; supply: Supply; questions: Map<string, Question> };

const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');


/** Question bodies for a set of ids: reserves from the catalog, the rest from their (already played) day files. */
async function loadQuestions(catalog: SurvivalCatalog, ids: readonly string[]): Promise<Map<string, Question>> {
  const map = new Map<string, Question>();
  for (const q of catalog.reserves) if (ids.includes(q.id)) map.set(q.id, q);
  const days = [...new Set(ids.map((id) => catalog.tags[id]?.day).filter((d): d is string => !!d))];
  const slates = await Promise.all(days.map((d) => loadSlate(d)));
  for (const s of slates) for (const q of s?.questions ?? []) if (ids.includes(q.id) && catalog.tags[q.id]?.day === s!.date) map.set(q.id, q);
  return map;
}

export default function Survival({ today, asOf, source, requireBeta, storage, onBackToDaily }: Props) {
  const day = asOf ?? today;
  // Every preview build (with or without asof) keeps its runs apart and sends nothing.
  const preview = SURVIVAL_FLAG !== 'on' || asOf !== null;
  const store: SurvivalStore = useMemo(() => createSurvivalStore(storage, preview ? SURVIVAL_PREVIEW_KEY : SURVIVAL_KEY), [storage, preview]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState<SurvivalRun | null>(() => store.load().current);
  const startSource = useRef<'cta' | 'link' | 'again'>(source);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped when another tab's save replaces what this tab shows, so the round remounts from the saved truth.
  const [epoch, setEpoch] = useState(0);
  // No events from preview runs that pretend to be another day.
  const send = useCallback((key: string, e: Parameters<typeof track>[0]) => {
    if (!preview) trackOnce(key, today, e);
  }, [preview, today]);

  // Load the pool for the day, plus the questions of a run already in the save.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { catalog, supply } = await loadPool(day);
        const current = store.load().current;
        const ids = current?.questionIds ?? [];
        const questions = await loadQuestions(catalog, ids);
        if (current && ids.some((id) => !questions.has(id))) {
          // Content changed under a saved run: drop it rather than show a broken round.
          store.discard(current.id);
          if (live) setRun(null);
        }
        if (live) setLoaded({ catalog, supply, questions });
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [day, store]);

  // Another tab moved this run on (or started a new one): adopt it between rounds.
  const busy = useRef(false);
  useEffect(() => {
    const onStorage = () => {
      if (busy.current) return;
      const saved = store.load().current;
      if (!saved) return;
      setRun((mine) => {
        if (!mine || saved.id !== mine.id || saved.results.length > mine.results.length || saved.advanced > mine.advanced) {
          setEpoch((e) => e + 1);
          return saved;
        }
        return mine;
      });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [store]);

  // A run adopted from another tab may need question bodies we haven't loaded.
  useEffect(() => {
    if (!loaded || !run || run.questionIds.every((id) => loaded.questions.has(id))) return;
    void loadQuestions(loaded.catalog, run.questionIds).then((qs) => setLoaded((l) => (l ? { ...l, questions: new Map([...l.questions, ...qs]) } : l)));
  }, [loaded, run]);

  const start = async () => {
    if (!loaded) return;
    const { catalog, pool, supply } = await loadPool(day);
    const fail = () => setNotice('Couldn’t start a run: not enough eligible questions right now. Try again tomorrow.');
    if (!supply.playable || (requireBeta && !supply.beta)) return fail();
    // The run just finished is still `current` (it moves to `recent` only when the new one starts).
    const saved = store.load();
    const recent = new Set([...saved.recent.flat(), ...(saved.current?.questionIds ?? [])]);
    const seed = newSeed();
    const ids = pickRun(pool, seed, recent);
    if (!ids) return fail();
    const questions = await loadQuestions(catalog, ids);
    if (ids.some((id) => !questions.has(id))) return fail();
    setNotice(null);
    const stored = store.start(newRun(hex(seed), day, ids));
    setLoaded((l) => (l ? { ...l, questions: new Map([...l.questions, ...questions]) } : l));
    setRun(stored);
    if (stored.id === hex(seed)) send(`sv:start:${stored.id}`, { name: 'survival_start', source: startSource.current });
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  if (failed) {
    return (
      <Panel title="Survival didn’t load." preview={preview} onBack={onBackToDaily}>
        <p className="archive-sub">Check your connection and try again. Today’s Daily Five is unaffected.</p>
      </Panel>
    );
  }
  if (!loaded) return <p className="loading" aria-live="polite">Loading Survival…</p>;

  const best = store.load().best[RULESET];

  if (run && !isOver(run)) {
    const round = currentRound(run);
    const q = loaded.questions.get(run.questionIds[round]!);
    if (!q) return <p className="loading" aria-live="polite">Loading Survival…</p>;
    return (
      <SurvivalRound
        key={`${run.id}:${round}:${epoch}`}
        run={run}
        round={round}
        question={q}
        preview={preview}
        onBusy={(b) => (busy.current = b)}
        onLock={(rec) => {
          const next = store.lock(run.id, round, rec);
          if (!next) {
            setRun(store.load().current);
            return;
          }
          const stored = next.results[round];
          const mine = stored && stored.lo === rec.lo && stored.hi === rec.hi && stored.points === rec.points && stored.hit === rec.hit;
          if (!mine) {
            // Another tab locked this round first: show its result, not ours, and count nothing here.
            setEpoch((e) => e + 1);
            setRun(next);
            return;
          }
          setRun(next);
          const reason = endReason(rec, round);
          if (reason) send(`sv:end:${run.id}`, { name: 'survival_end', round: round + 1, reason });
          if (runStatus(next) === 'won') send(`sv:win:${run.id}`, { name: 'survival_win' });
        }}
        onNext={() => {
          const next = store.advance(run.id) ?? store.load().current;
          setRun(next);
          const survived = next ? runScore(next).rounds : 0;
          if (next && next.id === run.id && (survived === 5 || survived === 10 || survived === 15) && survives(next.results[round]!, round)) {
            send(`sv:reach:${run.id}:${survived}`, { name: 'survival_reach', round: survived });
          }
        }}
      />
    );
  }

  if (run && isOver(run)) {
    return (
      <SurvivalEnd
        run={run}
        best={best}
        supply={loaded.supply}
        canPlay={loaded.supply.playable && (!requireBeta || loaded.supply.beta)}
        preview={preview}
        questions={loaded.questions}
        notice={notice}
        onAgain={() => {
          startSource.current = 'again';
          void start();
        }}
        onShare={(m) => send(`sv:share:${run.id}:${m}`, { name: 'survival_share', method: m })}
        onBack={onBackToDaily}
      />
    );
  }

  const open = loaded.supply.playable && (!requireBeta || loaded.supply.beta);
  return (
    <Panel title="Survival" preview={preview} onBack={onBackToDaily} asOf={asOf}>
      <p className="survival-lede">
        Twenty NBA questions, one life. Same brackets as the Daily Five, but every round has a minimum score: catch the answer
        <em> and </em>earn at least that much, or the run ends.
      </p>
      <ul className="survival-rules">
        <li>Round 1 needs {need(0)} points. Round 20 needs {need(SURVIVAL_ROUNDS - 1)}.</li>
        <li>Questions come from Daily Fives that are already over, never today’s or a future one.</li>
        <li>Separate from your daily stats and streak. Kept in this browser.</li>
      </ul>
      {best && (
        <p className="survival-best">
          Your best: <b className="tabular">{best.rounds}</b> {best.rounds === 1 ? 'round' : 'rounds'}, <span className="tabular">{best.points}</span> pts
        </p>
      )}
      {open ? (
        <div className="results-actions">
          <button type="button" className="btn btn-primary" onClick={() => void start()}>
            Start a run
          </button>
          {notice && <p className="archive-sub" role="status">{notice}</p>}
        </div>
      ) : (
        <p className="archive-sub" role="status">
          Not open yet: Survival needs more questions from finished days ({loaded.supply.total} so far). Each day’s Daily Five adds five.
        </p>
      )}
    </Panel>
  );
}

function Panel({ title, preview, asOf = null, onBack, children }: { title: string; preview: boolean; asOf?: string | null; onBack: () => void; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <article className="results survival">
      {preview && <PreviewNote asOf={asOf} />}
      <header className="results-head">
        <p className="context">Survival · NBA</p>
        <h1 className="results-title" ref={ref} tabIndex={-1}>
          {title}
        </h1>
      </header>
      {children}
      <div className="results-actions">
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          Back to the Daily Five
        </button>
      </div>
    </article>
  );
}

function PreviewNote({ asOf }: { asOf: string | null }) {
  return (
    <p className="storage-note survival-preview" role="note">
      Preview build{asOf ? `, as of ${formatDay(asOf)}` : ''}. Not public; runs here are kept apart and not counted.
    </p>
  );
}

function Track({ run, round, phase }: { run: SurvivalRun; round: number; phase: string }) {
  return (
    <div className="survival-track" role="img" aria-label={`Round ${round + 1} of ${SURVIVAL_ROUNDS}, ${round} survived so far`}>
      {Array.from({ length: SURVIVAL_ROUNDS }, (_, i) => {
        const r = run.results[i];
        const shown = r && (i < round || phase === 'resolved');
        const status = shown ? (survives(r, i) ? 'hit' : 'miss') : i === round ? 'current' : 'todo';
        return <span key={i} className="survival-cell" data-status={status} />;
      })}
    </div>
  );
}

function SurvivalRound(props: {
  run: SurvivalRun;
  round: number;
  question: Question;
  preview: boolean;
  onBusy: (busy: boolean) => void;
  onLock: (rec: SurvivalRun['results'][number]) => void;
  onNext: () => void;
}) {
  const { run, round, question: q } = props;
  const [state, raw] = useReducer(gameReducer, undefined, () => roundState(run, q));
  const min = need(round);

  const dispatch = useCallback(
    (a: GameAction) => {
      if (a.type === 'next') {
        if (state.phase === 'resolved') props.onNext();
        return;
      }
      // A window under the minimum can't survive even if it's inside: don't let it lock.
      if (a.type === 'lock' && (state.phase === 'ready' || state.phase === 'adjusting') && potentialPoints(q, state.window) < min) return;
      raw(a);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.phase, state.window, q, min, props.onNext],
  );

  // Save the lock before the reveal plays, exactly like the Daily Five.
  const saved = useRef(run.results.length > round);
  useEffect(() => {
    const rec = state.results[0];
    if (rec && !saved.current) {
      saved.current = true;
      props.onLock(rec);
    }
    props.onBusy(state.phase === 'locked' || state.phase === 'revealing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.results, state.phase]);

  const { points: banked } = runScore({ ...run, results: state.phase === 'resolved' ? run.results : run.results.slice(0, round) });
  const rec = run.results[round];
  const lastRound = round === SURVIVAL_ROUNDS - 1;
  const alive = rec ? survives(rec, round) : true;

  return (
    <>
      {props.preview && <PreviewNote asOf={null} />}
      <Round
        state={state}
        dispatch={dispatch}
        label={`Survival · Round ${round + 1} of ${SURVIVAL_ROUNDS}`}
        showHint={false}
        onFirstTouch={() => {}}
        survival={{
          need: min,
          total: banked,
          ledger: <Track run={run} round={round} phase={state.phase} />,
          nextLabel: !alive ? 'See your run' : lastRound ? 'See your run' : 'Next round',
        }}
      />
    </>
  );
}

function SurvivalEnd(props: {
  run: SurvivalRun;
  best: { rounds: number; points: number; runId: string } | undefined;
  supply: Supply;
  canPlay: boolean;
  preview: boolean;
  questions: Map<string, Question>;
  notice: string | null;
  onAgain: () => void;
  onShare: (m: ShareMethod) => void;
  onBack: () => void;
}) {
  const { run, best } = props;
  const status = runStatus(run);
  const { rounds, points } = runScore(run);
  const isBest = best?.runId === run.id;
  const last = run.results.at(-1);
  const lastQ = last ? props.questions.get(last.questionId) : undefined;
  const reason = last ? endReason(last, run.results.length - 1) : null;
  const [toast, setToast] = useState<string | null>(null);
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const share = async () => {
    // Spoiler-free: rounds and points only, never a question or an answer.
    const text = [
      status === 'won' ? `Stat Window Survival: all ${SURVIVAL_ROUNDS} rounds, ${points} pts` : `Stat Window Survival: ${rounds}/${SURVIVAL_ROUNDS} rounds, ${points} pts`,
      `${'🟩'.repeat(rounds)}${status === 'won' ? '' : '⬛'}`, // taste-skill-ignore: share-text convention
      `${window.location.origin}/?survival`,
    ].join('\n');
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        props.onShare('native');
        return;
      }
      if (!navigator.clipboard?.writeText) throw new Error('No clipboard');
      await navigator.clipboard.writeText(text);
      setToast('Copied. Paste it anywhere.');
      props.onShare('clipboard');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        props.onShare('cancelled');
        return;
      }
      setToast('Couldn’t copy automatically.');
      props.onShare('failed');
    }
  };

  return (
    <article className="results survival">
      {props.preview && <PreviewNote asOf={null} />}
      <header className="results-head">
        <p className="context">Survival · NBA · {run.ruleset}</p>
        <h1 className="results-title" ref={ref} tabIndex={-1}>
          {status === 'won' ? 'All twenty. You survived.' : rounds === 0 ? 'Out in round one.' : `Survived ${rounds} of ${SURVIVAL_ROUNDS}.`}
        </h1>
        <p className="results-total">
          <span className="results-score tabular">{rounds}</span>
          <span className="results-max">
            of {SURVIVAL_ROUNDS} rounds · <span className="tabular">{points}</span> pts
          </span>
        </p>
        <p className="survival-best">
          {isBest ? 'A new personal best.' : best ? `Your best: ${best.rounds} rounds, ${best.points} pts.` : ''}
        </p>
        {status === 'lost' && last && lastQ && (
          <p className="versus">
            Round {run.results.length} (needed {need(run.results.length - 1)}):{' '}
            {reason === 'miss' ? 'the answer was outside your window.' : `you caught it, but ${last.points} was under the minimum.`}
          </p>
        )}
      </header>
      <div className="results-actions">
        {props.canPlay ? (
          <button type="button" className="btn btn-primary" onClick={props.onAgain}>
            Run it again
          </button>
        ) : (
          <p className="archive-sub">Not enough new questions for another run yet.</p>
        )}
        <button type="button" className="btn btn-quiet" onClick={() => void share()}>
          Share your run
        </button>
        {props.notice && <p className="archive-sub" role="status">{props.notice}</p>}
        <p className="share-note">Shares your rounds and points, never the questions or answers.</p>
        <button type="button" className="btn btn-quiet" onClick={props.onBack}>
          Back to the Daily Five
        </button>
      </div>
      <div className="toast" role="status" aria-live="polite" data-visible={toast !== null}>
        {toast}
      </div>
    </article>
  );
}
