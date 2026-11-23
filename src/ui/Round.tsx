import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { canLock, currentQuestion, ROUNDS, totalPoints, type GameAction, type GameState, type PracticeTiming } from '../engine/game';
import { MAX_POINTS_PER_ROUND, potentialPoints } from '../engine/scoring';
import { formatValue, unitFor } from '../lib/format';
import { feedback } from './feedback';
import { Readout } from './Readout';
import { Ruler, type RulerReveal } from './Ruler';
import { usePrefersReducedMotion } from './hooks';
import { browserFunFactSeed, pickFunFact } from './fun-facts';
import { pickReactions } from './reactions';
import { contextLabel } from '../content/category';

type Props = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  /** Plain question index; difficulty remains an internal editorial label. */
  label: string;
  /** Set when the run came from a friend's link: shown before the first round only. */
  challenge?: { vs: number | null; vsTime: number | null } | null;
  onFirstTouch: () => void;
  timing?: PracticeTiming;
  /**
   * Survival mode only. Everything else about the round (window, lock, reveal,
   * scoring) is the Daily Five's, unchanged; this only swaps the ledger, the
   * running total, the score line and the Next button, and adds the minimum.
   */
  survival?: SurvivalChrome | undefined;
};

export type SurvivalChrome = {
  /** Minimum points this round needs. */
  need: number;
  /** Points banked by survived rounds, to show in the corner. */
  total: number;
  ledger: ReactNode;
  nextLabel: string;
};

const FIRST_TRAVEL_MS = 510;
const TRAVEL_MS = 440;
const CLAMP_MS = 110;
const SHOT_CLOCK_MS = 24_000;
/**
 * Session storage protects reloads; local storage also protects a player who
 * opens the same unfinished official puzzle in another tab of this browser.
 * This is convenience, not anti-cheat: private windows and cleared storage
 * are independent, and nobody's times are server-verified.
 */
const sessionShotKey = (id: string) => `stat-window:shot:v1:${id}`;
const sharedShotKey = (day: string, id: string) => `stat-window:shot:daily:v1:${day}:${id}`;
function savedShotStart(id: string, day: string, shared: boolean): number | null {
  if (typeof window === 'undefined') return null;
  const values: number[] = [];
  // Accessing the storage property itself can throw (some private or
  // restricted browsers), not only getItem. Guard the getter as well.
  const keys: ['sessionStorage' | 'localStorage', string][] = [['sessionStorage', sessionShotKey(id)]];
  if (shared) keys.push(['localStorage', sharedShotKey(day, id)]);
  for (const [kind, key] of keys) {
    try {
      const raw = window[kind].getItem(key);
      const n = raw === null ? NaN : Number(raw);
      // Do not honour future or invalid timestamps. An earlier valid start
      // wins when tabs disagree about a started round.
      if (Number.isFinite(n) && n > 0 && n <= Date.now() + 1000) values.push(n);
    } catch { /* local/session storage can both be blocked */ }
  }
  return values.length ? Math.min(...values) : null;
}
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export function Round({ state, dispatch, label, challenge = null, onFirstTouch, timing = 'timed', survival }: Props) {
  const q = currentQuestion(state);
  const reduced = usePrefersReducedMotion();
  const last = state.results[state.round];
  const resolved = state.phase === 'resolved' && last;
  const interactive = state.phase === 'ready' || state.phase === 'adjusting';
  const timed = timing === 'timed' && survival === undefined;
  const [factSeed] = useState(browserFunFactSeed);
  const extra = useMemo(() => pickFunFact(q, factSeed), [q, factSeed]);
  // One short reaction per reveal, stable across refreshes and not repeated within a run.
  const reaction = useMemo(() => resolved && !resolved.timedOut
    ? pickReactions(
        state.results.slice(0, state.round + 1).map((r, i) => {
          const rq = state.slate.questions[i] ?? q;
          return { questionId: r.questionId, input: { ...r, min: rq.min, max: rq.max, step: rq.step, round: i, rounds: ROUNDS } };
        }),
        factSeed,
      ).at(-1)?.text
    : undefined, [resolved, state.results, state.round, state.slate.questions, q, factSeed]);
  const [progress, setProgress] = useState(0);
  const liveResult = useRef<typeof last>(undefined);
  const roundRef = useRef<HTMLElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const skipRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Restore the elapsed clock on the first render rather than briefly flashing
  // 24 seconds while React effects hydrate the saved deadline.
  const [initialShotStart] = useState(() => timed && interactive
    ? savedShotStart(q.id, state.slate.date, state.mode === 'daily')
    : null);
  const [secondsLeft, setSecondsLeft] = useState(() => initialShotStart === null
    ? SHOT_CLOCK_MS / 1000
    : Math.ceil(Math.max(0, SHOT_CLOCK_MS - (Date.now() - initialShotStart)) / 1000));
  const shot = useRef<{ startedAt: number | null; stopped: boolean }>({
    startedAt: initialShotStart,
    stopped: false,
  });
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const shotKey = sessionShotKey(q.id);
  const crossTabKey = sharedShotKey(state.slate.date, q.id);
  const shareWithTabs = state.mode === 'daily';
  const rememberStart = (at: number): number => {
    const actual = Math.min(at, savedShotStart(q.id, state.slate.date, shareWithTabs) ?? at);
    try { window.sessionStorage.setItem(shotKey, String(actual)); } catch { /* storage blocked */ }
    if (shareWithTabs) {
      try { window.localStorage.setItem(crossTabKey, String(actual)); } catch { /* storage blocked */ }
    }
    return actual;
  };
  const elapsed = () =>
    shot.current.startedAt === null ? 0 : Math.max(0, Math.min(SHOT_CLOCK_MS, Date.now() - shot.current.startedAt));
  const startShot = () => {
    if (!timed || shot.current.startedAt !== null || shot.current.stopped) return;
    shot.current.startedAt = rememberStart(Date.now());
  };
  const stopShot = () => {
    const spent = Math.round(elapsed());
    shot.current.stopped = true;
    // After a locked answer, no deadline remains to restore. Keeping one
    // could instantly expire a fresh replay if a player resets their save.
    try { window.sessionStorage.removeItem(shotKey); } catch { /* blocked storage */ }
    if (shareWithTabs) {
      try { window.localStorage.removeItem(crossTabKey); } catch { /* blocked storage */ }
    }
    return spent;
  };
  const lockShot = () => {
    if (!canLock(state) || (survival && worth < survival.need)) return;
    if (!timed) { dispatch({ type: 'lock' }); return; }
    if (shot.current.stopped) return;
    startShot();
    const spent = stopShot();
    if (spent >= SHOT_CLOCK_MS) dispatch({ type: 'timeout', elapsedMs: SHOT_CLOCK_MS });
    else dispatch({ type: 'lock', elapsedMs: spent });
  };
  useEffect(() => {
    if (!timed) return;
    if (!interactive) {
      // A restored result or a result from another tab has already used its time.
      if (last && !shot.current.stopped) stopShot();
      return;
    }
    // Question is mounted only after Start. Never add time on another tab.
    const startedAt = rememberStart(Date.now());
    shot.current = { startedAt, stopped: false };
    setSecondsLeft(Math.ceil(Math.max(0, SHOT_CLOCK_MS - (Date.now() - startedAt)) / 1000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, timed, state.round, q.id]);

  const worth = potentialPoints(q, state.window);

  useEffect(() => {
    if (!timed || !interactive) return;
    const tick = () => {
      const s = shot.current;
      if (s.startedAt === null || s.stopped) return;
      const left = Math.max(0, SHOT_CLOCK_MS - elapsed());
      setSecondsLeft(Math.ceil(left / 1000));
      if (left === 0) {
        s.stopped = true;
        try { window.sessionStorage.removeItem(shotKey); } catch { /* blocked storage */ }
        if (shareWithTabs) {
          try { window.localStorage.removeItem(crossTabKey); } catch { /* blocked storage */ }
        }
        dispatchRef.current({ type: 'timeout', elapsedMs: SHOT_CLOCK_MS });
      }
    };
    // Browser intervals may be throttled in background tabs. The authoritative
    // deadline uses Date.now, and is rechecked immediately when the tab returns.
    const id = window.setInterval(tick, 100);
    document.addEventListener('visibilitychange', tick);
    // A second official-daily tab can start first; always adopt the earliest
    // shared deadline, never extend one that is already running.
    const onStorage = (event: StorageEvent) => {
      if (shot.current.stopped || !shareWithTabs || event.key !== crossTabKey || event.newValue === null) return;
      const other = Number(event.newValue);
      if (Number.isFinite(other) && other > 0 && other <= Date.now() + 1000 &&
          shot.current.startedAt !== null && other < shot.current.startedAt) {
        shot.current.startedAt = other;
        try { window.sessionStorage.setItem(shotKey, String(other)); } catch { /* blocked storage */ }
        tick();
      }
    };
    window.addEventListener('storage', onStorage);
    tick();
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('storage', onStorage);
    };
  }, [timed, interactive, state.round]);

  // New round: reset the reveal and move focus to the question for screen readers.
  useEffect(() => {
    setProgress(0);
    const focused = document.activeElement;
    if (focused === document.body || roundRef.current?.contains(focused)) {
      headingRef.current?.focus({ preventScroll: true });
      // Start may be below the fold in practice, just like Next in a long reveal.
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [state.round, q.id]);

  // locked → (brief clamp) → revealing
  useEffect(() => {
    if (state.phase !== 'locked' || !last) return;
    if (liveResult.current !== last) {
      liveResult.current = last;
      if (!last.timedOut) feedback.lock();
    }
    const t = window.setTimeout(() => dispatchRef.current({ type: reduced ? 'settle' : 'reveal' }), reduced ? 0 : CLAMP_MS);
    return () => window.clearTimeout(t);
  }, [state.phase, reduced, last]);

  // Move the marker from the far end of the ruler and settle on the landing frame.
  useEffect(() => {
    if (state.phase !== 'revealing' || !last) return;
    if (reduced) {
      dispatchRef.current({ type: 'settle' });
      return;
    }
    let raf = 0;
    let lastTickAt = 0;
    const start = performance.now();
    const duration = state.round === 0 ? FIRST_TRAVEL_MS : TRAVEL_MS;
    skipRef.current = false;
    const step = (now: number) => {
      const t = skipRef.current ? 1 : Math.min(1, (now - start) / duration);
      if (now - lastTickAt > 70 + t * 160 && t < 0.92) {
        feedback.roll();
        lastTickAt = now;
      }
      if (t < 1) {
        setProgress(easeOutCubic(t));
        raf = requestAnimationFrame(step);
      } else {
        if (last.points > 0) feedback.hit(last.points);
        else if (!last.hit) feedback.miss();
        dispatchRef.current({ type: 'settle' });
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [state.phase, state.round, last, reduced]);

  // Focus Next as soon as the answer and real score land.
  useEffect(() => {
    if (state.phase !== 'resolved' || !last) return;
    const focused = document.activeElement;
    if (focused === document.body || roundRef.current?.contains(focused)) {
      actionRef.current?.focus({ preventScroll: true });
    }
  }, [state.phase, last]);

  const revealing = state.phase === 'revealing' || state.phase === 'resolved';
  // The flag sets off from whichever end of the ruler is farther from the answer, so it always has to cross ground.
  const from = q.answer - q.min > q.max - q.answer ? q.min : q.max;
  const reveal: RulerReveal | null = revealing && last ? {
    progress: resolved ? 1 : progress,
    hit: last.hit,
    from,
    zero: last.hit && last.points === 0,
    missBy: last.missBy,
  } : null;
  const freshResult = resolved && liveResult.current === last;
  const perfect = freshResult && last.points === MAX_POINTS_PER_ROUND;
  const missDistance = resolved && resolved.missBy > 0 ? `${formatValue(resolved.missBy, q.step)} ${unitFor(resolved.missBy, q.unit)}` : '';
  const resultLabel = resolved && (resolved.timedOut ? 'Shot clock violation.' : !resolved.hit ? 'Outside.'
    : resolved.points === 0 ? 'Inside, but too wide to score.' : 'Inside.');
  const announcement = resolved
    ? `${resultLabel}${missDistance ? ` Missed by ${missDistance}.` : ''} ${resolved.points} points. The answer is ${formatValue(q.answer, q.step)} ${unitFor(q.answer, q.unit)}.`
    : !interactive ? last?.timedOut ? 'Time’s up.' : 'Window locked.' : '';
  // Don't leak the outcome before the answer lands.
  const runningTotal = survival ? survival.total : totalPoints(state.phase === 'resolved' ? state.results : state.results.slice(0, state.round));
  const short = survival !== undefined && worth < survival.need;
  const lockable = canLock(state) && !short;
  const isLast = state.round >= ROUNDS - 1;

  return (
    <article ref={roundRef} className="round" data-phase={state.phase} data-fresh-result={freshResult || undefined}>
      <div className="round-head">
      <div className="round-top">
        {survival ? survival.ledger : <ol className="ledger" aria-label="Rounds">
          {Array.from({ length: ROUNDS }, (_, i) => {
            const r = state.results[i];
            const shown = r && (i < state.round || state.phase === 'resolved' || state.phase === 'complete');
            const status = shown ? (!r.hit ? 'miss' : r.points > 0 ? 'hit' : 'zero') : i === state.round ? 'current' : 'todo';
            return (
              <li key={i} className="ledger-cell" data-status={status} data-new-result={freshResult && i === state.round || undefined}>
                <span className="sr-only">
                  Question {i + 1}: {shown ? `${r.points} points` : i === state.round ? 'now playing' : 'to play'}
                </span>
                <span className="ledger-num" aria-hidden="true">{shown ? r.points : i + 1}</span>
              </li>
            );
          })}
        </ol>}
        <p className="round-meta">
          <span className="round-label">{label}</span>
          <span className="round-total" data-earned={freshResult && last.points > 0 || undefined}>
            <span className="tabular">{runningTotal}</span> pts
          </span>
          {timed && <span className="shot-clock" data-urgent={interactive && secondsLeft <= 5 || undefined} role="timer"
            aria-label={interactive ? `Shot clock: ${secondsLeft} seconds left` : 'Shot clock stopped'}>
            {!interactive && last?.elapsedMs !== undefined
              ? `${Math.ceil(Math.max(0, SHOT_CLOCK_MS - last.elapsedMs) / 1000)}s`
              : `${secondsLeft}s`}
          </span>}
        </p>
      </div>

      <header className="question-block">
        {challenge && interactive && (
          <p className="challenge-note">
            {challenge.vs === null ? (
              'A friend sent you these five.'
            ) : (
              <>
                Beat your friend’s <b className="tabular">{challenge.vs}</b> points{challenge.vsTime !== null ? ` in ${Math.ceil(challenge.vsTime / 1000)}s` : ''}.
              </>
            )}
          </p>
        )}
        <h1 className="question" ref={headingRef} tabIndex={-1}>
          {q.prompt}
        </h1>
        <p className="context">{contextLabel(q)}</p>
      </header>
      </div>

      <section className="field" aria-label="Your window">
        <div className="field-inner">
          <Readout
            question={q}
            window={state.window}
            editable={interactive}
            onFirstTouch={() => { startShot(); onFirstTouch(); }}
            onChange={(w, m) => {
              // Typing an exact number also starts the clock and retires the tutorial.
              startShot();
              onFirstTouch();
              dispatch({ type: 'setWindow', window: w, moving: m });
            }}
          />

          <div className="sr-only" role="status">{announcement}</div>
          <div className="verdict-line">
            {resolved && last.timedOut ? (
              <p className="outcome outcome-miss"><span className="outcome-word">Shot clock violation.</span>
                <span className="outcome-detail">Buzzer. +0. The answer is below.</span></p>
            ) : resolved && survival ? (
              <SurvivalOutcome points={last.points} hit={last.hit} need={survival.need} perfect={!!perfect} missBy={missDistance} />
            ) : resolved ? (
              last.hit ? (
                <p className="outcome outcome-hit" data-zero={last.points === 0 || undefined}>
                  <span className="outcome-word">
                    <span className="outcome-glyph" aria-hidden="true">✓</span>
                    {last.points === 0 ? 'Inside, but too wide to score.' : 'Inside.'}
                  </span>
                  <span className="outcome-points tabular" data-perfect-window={perfect || undefined} aria-hidden="true">+{last.points}</span>
                  <span className="sr-only">{last.points} points.</span>
                </p>
              ) : (
                <p className="outcome outcome-miss">
                  <span className="outcome-word">
                    <span className="outcome-glyph" aria-hidden="true">✕</span>
                    Outside.
                  </span>
                  <span className="outcome-detail">
                    Missed by {missDistance}
                  </span>
                </p>
              )
            ) : state.phase === 'locked' || state.phase === 'revealing' ? (
              <p className="worth worth-locked">{last?.timedOut ? 'Time’s up. Revealing the answer…' : 'Window locked. Revealing the answer…'}</p>
            ) : survival ? (
              <p className="worth" data-short={short || undefined}>
                {worth === 0 ? (
                  <>Pull the brackets in. You need <b className="tabular">{survival.need}</b> to survive.</>
                ) : short ? (
                  <>Worth <b className="tabular">{worth}</b>. You need <b className="tabular">{survival.need}</b>: tighten it.</>
                ) : (
                  <>Worth <b className="tabular">{worth}</b> if it’s inside. You need {survival.need}.</>
                )}
              </p>
            ) : worth === 0 && canLock(state) ? (
              // Lockable, but so wide it rounds to 0: say so before the lock, not after.
              <p className="worth" data-zero>
                Worth <b className="tabular">0</b> even if it’s inside. Pull in further.
              </p>
            ) : worth === 0 ? (
              <p className="worth">
                Pull the brackets in to start scoring.
              </p>
            ) : (
              <p className="worth">
                Worth <b className="tabular">{worth}</b> if it’s inside, 0 if not.
              </p>
            )}
          </div>

          <Ruler
            question={q}
            window={state.window}
            interactive={interactive}
            reveal={reveal}
            onChange={(w, m) => { startShot(); dispatch({ type: 'setWindow', window: w, ...(m ? { moving: m } : {}) }); }}
            onCommit={() => {
              if (!short) lockShot();
            }}
            onFirstTouch={() => { startShot(); onFirstTouch(); }}
          />
        </div>
      </section>

      {resolved && (
        <section className="story" aria-label="About this answer">
          {reaction && !survival && <p className="story-reaction">{reaction}</p>}
          <p className="story-answer">
            <span className="tabular">{formatValue(q.answer, q.step)}</span> {unitFor(q.answer, q.unit)}
          </p>
          <p className="story-note">{q.note}</p>
          {extra && (
            <aside className="story-extra" aria-label="Bonus sports fact">
              <p className="story-extra-text">{extra.text}</p>
            </aside>
          )}
        </section>
      )}

      <div className="action-bar">
        {interactive ? (
          <button type="button" className="btn btn-primary" disabled={!lockable} onClick={lockShot}>
            {lockable ? 'Lock the window' : survival && canLock(state) ? `Tighten to ${survival.need}+ to lock` : 'Pull the brackets in first'}
          </button>
        ) : state.phase === 'revealing' ? (
          <button type="button" className="btn btn-primary btn-skip" onClick={() => (skipRef.current = true)}>
            Skip
          </button>
        ) : (
          <button
            ref={actionRef}
            type="button"
            className="btn btn-primary"
            disabled={state.phase !== 'resolved'}
            onClick={() => dispatch({ type: 'next' })}
          >
            {state.phase !== 'resolved' ? 'Locked' : survival ? survival.nextLabel : isLast ? 'See your day' : 'Next question'}
          </button>
        )}
      </div>
    </article>
  );
}

function SurvivalOutcome({ hit, points, need, perfect, missBy }: { hit: boolean; points: number; need: number; perfect: boolean; missBy: string }) {
  if (hit && points >= need) {
    return (
      <p className="outcome outcome-hit">
        <span className="outcome-word">
          <span className="outcome-glyph" aria-hidden="true">✓</span>
          Survived.
        </span>
        <span className="outcome-points tabular" data-perfect-window={perfect || undefined} aria-hidden="true">+{points}</span>
        <span className="sr-only">{points} points.</span>
      </p>
    );
  }
  return (
    <p className="outcome outcome-miss">
      <span className="outcome-word">
        <span className="outcome-glyph" aria-hidden="true">✕</span>
        {hit ? 'Inside, but short.' : 'Outside. Run over.'}
      </span>
      <span className="outcome-detail">{hit ? `${points} is under the ${need} this round needed. Run over.` : `Missed by ${missBy}`}</span>
    </p>
  );
}
