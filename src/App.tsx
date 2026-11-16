import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { inventoryDays, loadSlate } from './content/inventory';
import type { Slate } from './content/schema';
import { addDays, puzzleDay, puzzleNumber } from './engine/daily';
import { gameReducer, initGame, type GameState, type Mode } from './engine/game';
import { createSaveStore, type StorageLike } from './engine/storage';
import { playerStats } from './engine/summary';
import { track } from './lib/track';
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

type Session = { mode: Mode; day: string; slate: Slate };

export function App() {
  const store = useMemo(() => createSaveStore(safeLocalStorage()), []);
  const [settings, setSettings] = useState(() => store.load().settings);
  const [today, setToday] = useState(() => puzzleDay(new Date()));
  const [session, setSession] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);

  const open = useCallback(
    async (mode: Mode, day: string) => {
      const slate = await loadSlate(day);
      if (!slate) {
        setMissing(true);
        setSession(null);
        return;
      }
      setMissing(false);
      setSession({ mode, day, slate });
      if (mode === 'practice') track({ name: 'practice_start', day });
    },
    [],
  );

  useEffect(() => {
    void open('daily', today);
  }, [open, today]);

  // A new UTC day while the tab is open: today's puzzle switches over. A run in
  // progress keeps its own key, so yesterday's saved rounds are never lost.
  useEffect(() => {
    const check = () => {
      const d = puzzleDay(new Date());
      if (d !== today) setToday(d);
    };
    const id = window.setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [today]);

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
            {session?.mode === 'practice' ? 'Practice' : `No. ${number}`}
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
            key={`${session.mode}:${session.day}`}
            session={session}
            store={store}
            today={today}
            showHint={!settings.introSeen}
            onFirstTouch={() => !settings.introSeen && updateSettings({ introSeen: true })}
            archive={archive}
            onPractice={(d) => void open('practice', d)}
            onBackToToday={() => void open('daily', today)}
          />
        ) : missing ? (
          <NoPuzzle today={today} archive={archive} onPractice={(d) => void open('practice', d)} />
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
  store: ReturnType<typeof createSaveStore>;
  today: string;
  showHint: boolean;
  onFirstTouch: () => void;
  archive: readonly string[];
  onPractice: (day: string) => void;
  onBackToToday: () => void;
}) {
  const { session, store, today } = props;
  const daily = session.mode === 'daily';

  const [state, dispatch] = useReducer(gameReducer, undefined, (): GameState => {
    const saved = daily ? store.load().runs[session.day] : undefined;
    return initGame(session.slate, session.mode, saved?.results ?? [], saved?.advanced ?? 0);
  });

  // Persist every locked round immediately (before the reveal), so a refresh can't re-roll it.
  const advanced = state.phase === 'complete' ? state.results.length : state.round;
  useEffect(() => {
    if (!daily) return;
    store.saveRun(session.day, { results: state.results, advanced });
  }, [daily, store, session.day, state.results, advanced]);

  // Analytics hooks (no-op sink today).
  const n = puzzleNumber(session.day);
  useEffect(() => {
    if (daily && state.results.length === 0) track({ name: 'daily_start', number: n });
    // Only on mount of a fresh run.
  }, []);
  const lastLocked = useRef(state.results.length);
  useEffect(() => {
    if (state.results.length > lastLocked.current) {
      const r = state.results.at(-1)!;
      track({ name: 'round_lock', number: n, round: state.results.length, points: r.points, hit: r.hit });
      if (state.results.length === 5 && daily) {
        track({ name: 'daily_complete', number: n, total: state.results.reduce((s, x) => s + x.points, 0) });
      }
    }
    lastLocked.current = state.results.length;
  }, [state.results, n, daily]);

  // Another tab finished rounds of the same day: adopt them unless we're mid-reveal.
  useEffect(() => {
    if (!daily) return;
    const onStorage = () => {
      const saved = store.load().runs[session.day];
      if (saved && saved.results.length > state.results.length && (state.phase === 'ready' || state.phase === 'adjusting')) {
        dispatch({ type: 'hydrate', state: initGame(session.slate, session.mode, saved.results, saved.advanced) });
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
  const label = daily
    ? `Round ${state.round + 1} of 5`
    : `Practice · ${formatDay(session.day)} · round ${state.round + 1} of 5`;

  return (
    <Round
      state={state}
      dispatch={dispatch}
      label={label}
      level={level}
      theme={session.slate.theme?.title}
      showHint={props.showHint && state.round === 0}
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
