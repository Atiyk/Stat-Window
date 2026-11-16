import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { inventoryDays, loadSlate } from './content/inventory';
import type { Slate } from './content/schema';
import { parseChallenge } from './engine/challenge';
import { addDays, puzzleDay, puzzleNumber } from './engine/daily';
import { gameReducer, initGame, ROUNDS, type GameAction, type GameState, type Mode } from './engine/game';
import { createSaveStore, type RunKind, type SaveStore, type StorageLike } from './engine/storage';
import { playerStats } from './engine/summary';
import { track, type PlayMode } from './lib/track';
import { formatDay } from './lib/format';
import { setSoundEnabled } from './ui/feedback';
import { Help } from './ui/Help';
import { Mark } from './ui/Mark';
import { Results } from './ui/Results';
import { Round } from './ui/Round';

function safeLocalStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = '__sw_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/**
 * What is on screen. `kind` says where the run is saved: today's puzzle (and any
 * earlier day the player already started as their daily) goes to the daily record;
 * any other earlier day is a separate practice run that never touches stats.
 * `viaLink` marks a run opened from a friend's same-puzzle link; `vs` is the score
 * that link claimed, shown for comparison only.
 */
type Session = { mode: Mode; kind: RunKind; day: string; slate: Slate; viaLink: boolean; vs: number | null };

/**
 * A tab opened before a deploy still holds the old list of day files. If one of
 * those files changed (a future day was regenerated), the new deploy no longer
 * serves its old name and the import fails. Reload once to pick up the new
 * version; the guard stops a reload loop if the file is missing for another reason.
 */
function reloadForNewVersion(): boolean {
  try {
    const key = 'stat-window:reloaded-at';
    const last = Number(window.sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 60_000) return false;
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

const daysBetween = (a: string, b: string) => puzzleNumber(b) - puzzleNumber(a);

/** A daily run that has started but not finished (or is mid-reveal) must not be swapped out under the player. */
function inProgress(store: SaveStore, day: string): boolean {
  const run = store.load().runs[day];
  if (!run) return false;
  return (run.results.length > 0 && run.results.length < ROUNDS) || run.advanced < run.results.length;
}

export function App() {
  const store = useMemo(() => createSaveStore(safeLocalStorage()), []);
  const [settings, setSettings] = useState(() => store.load().settings);
  const [today, setToday] = useState(() => puzzleDay(new Date()));
  const [session, setSession] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);

  const open = useCallback(
    async (day: string, link?: { vs: number | null }) => {
      let slate: Slate | null;
      try {
        slate = await loadSlate(day);
      } catch {
        if (reloadForNewVersion()) return;
        slate = null;
      }
      if (!slate) {
        setMissing(true);
        setSession(null);
        return;
      }
      const isToday = day === puzzleDay(new Date());
      const kind: RunKind = isToday || store.load().runs[day] ? 'runs' : 'practice';
      setMissing(false);
      setSession({
        mode: kind === 'runs' ? 'daily' : 'practice',
        kind,
        day,
        slate,
        viaLink: link !== undefined,
        vs: link?.vs ?? null,
      });
    },
    [store],
  );

  // First load: a same-puzzle link opens its day; anything else opens today.
  useEffect(() => {
    const prev = store.persistent ? store.recordVisit(today) : null;
    if (prev === undefined) track({ name: 'visit_new' });
    else if (prev && prev.last < today) {
      track({ name: 'visit_return', gap: daysBetween(prev.last, today), age: daysBetween(prev.first, today) });
    }
    const link = parseChallenge(window.location.search, today, inventoryDays);
    if (link.kind !== 'none') {
      track({
        name: 'challenge_open',
        kind: link.kind === 'day' ? (link.day === today ? 'today' : 'past') : link.kind,
        withScore: link.kind === 'day' && link.vs !== null,
      });
    }
    if (link.kind === 'day') void open(link.day, { vs: link.vs });
    else void open(today);
    // Mount only: later day changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new UTC day while the tab is open: move to the new puzzle, unless the player
  // is part-way through a run (theirs to finish; it keeps its own day) or practising.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const check = () => {
      const d = puzzleDay(new Date());
      if (d === today) return;
      setToday(d);
      const s = sessionRef.current;
      if (!s || (s.kind === 'runs' && !inProgress(store, s.day))) void open(d);
    };
    const id = window.setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [today, open, store]);

  const backToToday = () => {
    if (window.location.search) window.history.replaceState(null, '', '/');
    void open(puzzleDay(new Date()));
  };

  const updateSettings = (patch: Partial<typeof settings>) => {
    store.saveSettings(patch);
    setSettings((s) => ({ ...s, ...patch }));
  };

  const number = session ? puzzleNumber(session.day) : puzzleNumber(today);
  const archive = inventoryDays.filter((d) => d < today).reverse();

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Stat Window, today’s puzzle">
          <Mark />
          <span className="wordmark">Stat Window</span>
        </a>
        <div className="topbar-right">
          <span className="day-label">
            No. {number}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-pressed={settings.sound}
            aria-label={settings.sound ? 'Sound on' : 'Sound off'}
            onClick={() => updateSettings({ sound: !settings.sound })}
          >
            <SoundIcon on={settings.sound} />
          </button>
          <button type="button" className="icon-btn" aria-label="How to play" onClick={() => setHelpOpen(true)}>
            <span aria-hidden="true" className="icon-q">?</span>
          </button>
        </div>
      </header>

      <main className="main" id="main">
        {session ? (
          <Game
            key={`${session.kind}:${session.day}`}
            session={session}
            store={store}
            today={today}
            showHint={!settings.introSeen}
            onFirstTouch={() => !settings.introSeen && updateSettings({ introSeen: true })}
            archive={archive}
            onPractice={(d) => void open(d)}
            onBackToToday={backToToday}
          />
        ) : missing ? (
          <NoPuzzle today={today} archive={archive} onPractice={(d) => void open(d)} />
        ) : (
          <p className="loading" aria-live="polite">Loading today’s puzzle…</p>
        )}
      </main>

      {!store.persistent && (
        <p className="storage-note" role="note">
          This browser isn’t saving progress, so a refresh will start today over.
        </p>
      )}

      <Help open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function Game(props: {
  session: Session;
  store: SaveStore;
  today: string;
  showHint: boolean;
  onFirstTouch: () => void;
  archive: readonly string[];
  onPractice: (day: string) => void;
  onBackToToday: () => void;
}) {
  const { session, store, today } = props;
  const daily = session.mode === 'daily';
  const playMode: PlayMode = session.viaLink ? 'challenge' : session.mode;

  const [state, rawDispatch] = useReducer(gameReducer, undefined, (): GameState => {
    const saved = store.load()[session.kind]?.[session.day];
    return initGame(session.slate, session.mode, saved?.results ?? [], saved?.advanced ?? 0);
  });

  const dispatch = useCallback(
    (a: GameAction) => {
      if (a.type === 'next' && state.phase === 'resolved') track({ name: 'round_next', mode: playMode, round: state.round + 1 });
      if (a.type === 'setWindow' && state.round === 0 && state.phase === 'ready' && state.results.length === 0) {
        track({ name: 'first_touch', mode: playMode });
      }
      rawDispatch(a);
    },
    [state.phase, state.round, state.results.length, playMode],
  );

  // Persist every locked round immediately (before the reveal), so a refresh can't re-roll it.
  const advanced = state.phase === 'complete' ? state.results.length : state.round;
  useEffect(() => {
    store.saveRun(session.day, { results: state.results, advanced }, session.kind);
  }, [store, session.day, session.kind, state.results, advanced]);

  const n = puzzleNumber(session.day);
  useEffect(() => {
    if (state.results.length === 0) track({ name: 'run_start', mode: playMode });
    // Only on mount of a fresh run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastLocked = useRef(state.results.length);
  useEffect(() => {
    if (state.results.length > lastLocked.current) {
      const r = state.results.at(-1)!;
      track({ name: 'round_lock', mode: playMode, round: state.results.length, hit: r.hit });
      if (state.results.length === ROUNDS) {
        track({ name: 'run_complete', mode: playMode, total: state.results.reduce((s, x) => s + x.points, 0) });
      }
    }
    lastLocked.current = state.results.length;
  }, [state.results, playMode]);

  // Leaving with a run part-way done (best effort; see docs/MEASUREMENT.md).
  const exitRef = useRef({ started: false, round: 0 });
  exitRef.current = {
    started: state.phase !== 'complete' && (state.results.length > 0 || state.phase === 'adjusting'),
    round: state.round + 1,
  };
  useEffect(() => {
    const onHide = () => {
      if (exitRef.current.started) track({ name: 'run_exit', mode: playMode, round: exitRef.current.round });
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [playMode]);

  // Another tab finished rounds of the same day: adopt them unless we're mid-reveal.
  useEffect(() => {
    const onStorage = () => {
      const saved = store.load()[session.kind]?.[session.day];
      if (saved && saved.results.length > state.results.length && (state.phase === 'ready' || state.phase === 'adjusting')) {
        rawDispatch({ type: 'hydrate', state: initGame(session.slate, session.mode, saved.results, saved.advanced) });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  });

  if (state.phase === 'complete') {
    const stats = playerStats(store.load().runs, today);
    return (
      <Results
        slate={session.slate}
        number={n}
        mode={session.mode}
        playMode={playMode}
        isToday={session.day === today}
        vs={session.vs}
        results={state.results}
        stats={stats}
        archive={props.archive.filter((d) => d !== session.day)}
        onPractice={props.onPractice}
        onBackToToday={props.onBackToToday}
      />
    );
  }

  // Difficulty is a quiet hint under the round count, not a headline.
  const difficulty = session.slate.questions[state.round]?.difficulty;
  const level = difficulty ? `${difficulty[0]!.toUpperCase()}${difficulty.slice(1)}` : undefined;
  // The header already names the puzzle (No. N); this line only says what kind of run it is.
  const where = daily || session.viaLink ? '' : 'Practice · ';
  const label = `${where}Round ${state.round + 1} of 5`;

  return (
    <Round
      state={state}
      dispatch={dispatch}
      label={label}
      level={level}
      theme={session.slate.theme?.title}
      showHint={props.showHint && state.round === 0}
      challenge={session.viaLink && state.round === 0 && state.results.length === 0 ? { vs: session.vs } : null}
      onFirstTouch={props.onFirstTouch}
    />
  );
}

function NoPuzzle({ today, archive, onPractice }: { today: string; archive: readonly string[]; onPractice: (d: string) => void }) {
  const before = today < (inventoryDays[0] ?? today);
  return (
    <article className="results">
      <header className="results-head">
        <p className="context">{formatDay(today)}</p>
        <h1 className="results-title">{before ? 'Not open yet.' : 'Today’s puzzle is still being checked.'}</h1>
        <p className="archive-sub">
          {before
            ? `The first puzzle opens on ${formatDay(inventoryDays[0] ?? addDays(today, 1))}.`
            : 'Every number is checked against a source before it goes live. Try an earlier day while you wait.'}
        </p>
      </header>
      {archive.length > 0 && (
        <ul className="archive-list">
          {archive.map((day) => (
            <li key={day}>
              <button type="button" className="btn btn-quiet" onClick={() => onPractice(day)}>
                {formatDay(day)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {on ? (
        <path d="M16 8.5c1.2 1 1.8 2.2 1.8 3.5s-.6 2.5-1.8 3.5M18.5 6c2 1.6 3 3.6 3 6s-1 4.4-3 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}
