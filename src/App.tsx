import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { isMixedSportDay } from './content/cutover';
import { inventoryDays, loadSlate } from './content/inventory';
import type { Slate } from './content/schema';
import { parseChallenge } from './engine/challenge';
import { addDays, puzzleDay, puzzleNumber } from './engine/daily';
import { currentSeason, inSeason, publicNumber, seasonConfigFrom, type SeasonConfig } from './engine/season';
import { isQa } from './lib/scores';
import { gameReducer, initGame, ROUNDS, type GameAction, type GameState, type Mode } from './engine/game';
import { createSaveStore, type RunKind, type SaveStore, type StorageLike } from './engine/storage';
import { playerStats } from './engine/summary';
import { analyticsEnabled, setCohort, track, trackOnce, type PlayMode, type ShareMethod } from './lib/track';
import { CTA_TEST, previewAsOf, SURVIVAL_FLAG, wantsSurvival } from './survival/flag';
import { armFor, exposedYesterday, markExposed, type Arm } from './survival/experiment';
import { formatDay } from './lib/format';
import { setSoundEnabled } from './ui/feedback';
import { Help } from './ui/Help';
import { PrivacyDialog } from './ui/Privacy';
import { Mark } from './ui/Mark';
import { Results } from './ui/Results';
import { Round } from './ui/Round';
import { Onboarding } from './ui/Onboarding';

// Survival is its own chunk, and is absent from the build while the flag is off.
// (The env comparison is spelled out here so the bundler can drop the chunk.)
const Survival =
  import.meta.env.VITE_SURVIVAL === 'on' || import.meta.env.VITE_SURVIVAL === 'preview' ? lazy(() => import('./ui/Survival')) : null;

/**
 * Whether Survival is open to play on this UTC day (public flag only), and this
 * browser's experiment arm. `cta` decides whether daily results offer it.
 */
type SurvivalOffer = { open: boolean; arm: Arm | null; cta: boolean };
const NO_OFFER: SurvivalOffer = { open: false, arm: null, cta: false };

function useSurvivalOffer(today: string, storage: StorageLike | null): SurvivalOffer {
  const [offer, setOffer] = useState<SurvivalOffer>(NO_OFFER);
  useEffect(() => {
    if (import.meta.env.VITE_SURVIVAL !== 'on') return;
    let live = true;
    void import('./survival/gate').then(async ({ loadPool }) => {
      const { supply } = await loadPool(today);
      if (!live) return;
      if (!supply.beta) return setOffer(NO_OFFER);
      // The experiment needs working analytics; without it everyone sees the button.
      const arm = armFor(storage, CTA_TEST && analyticsEnabled);
      setOffer({ open: true, arm, cta: arm === null ? !CTA_TEST : arm === 'cta' });
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [today, storage]);
  return offer;
}

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
type Session = { mode: Mode; kind: RunKind; day: string; slate: Slate; viaLink: boolean; vs: number | null; vsTime: number | null };

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

/** The current address without the named parameters; anything else (`qa`, a hash) stays. */
function withoutParams(loc: Pick<Location, 'pathname' | 'search' | 'hash'>, names: readonly string[]): string {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(loc.search);
  } catch {
    return loc.pathname;
  }
  for (const n of names) params.delete(n);
  const rest = params.toString();
  return `${loc.pathname}${rest ? `?${rest}` : ''}${loc.hash}`;
}

/** The current address without the challenge parameters (`day`, `vs`). */
const withoutChallenge = (loc: Pick<Location, 'pathname' | 'search' | 'hash'>) => withoutParams(loc, ['day', 'vs']);

const daysBetween = (a: string, b: string) => puzzleNumber(b) - puzzleNumber(a);

/**
 * Beta unless the build sets VITE_LAUNCH_DAY (docs/LAUNCH.md). Non-production builds with
 * VITE_LAUNCH_PREVIEW=1 can try a launch day with ?launch-preview=YYYY-MM-DD.
 */
const SEASON: SeasonConfig = seasonConfigFrom(
  { launchDay: import.meta.env.VITE_LAUNCH_DAY, preview: import.meta.env.VITE_LAUNCH_PREVIEW },
  typeof window === 'undefined' ? '' : window.location.search,
);
// Set before any component mounts, so even a child's first event carries the QA or season prefix.
if (typeof window !== 'undefined') setCohort(isQa() ? 'qa' : currentSeason(puzzleDay(new Date()), SEASON));

/** A daily run that has started but not finished (or is mid-reveal) must not be swapped out under the player. */
function inProgress(store: SaveStore, day: string): boolean {
  const run = store.load().runs[day];
  if (!run) return false;
  return (run.results.length > 0 && run.results.length < ROUNDS) || run.advanced < run.results.length;
}

export function App() {
  const storage = useMemo(() => safeLocalStorage(), []);
  const store = useMemo(() => createSaveStore(storage), [storage]);
  const [view, setView] = useState<'daily' | 'survival'>(() => (wantsSurvival(window.location.search) ? 'survival' : 'daily'));
  const [survivalSource, setSurvivalSource] = useState<'cta' | 'link'>('link');

  const [settings, setSettings] = useState(() => store.load().settings);
  const [today, setToday] = useState(() => puzzleDay(new Date()));
  const offer = useSurvivalOffer(today, storage);
  useEffect(() => setCohort(isQa() ? 'qa' : currentSeason(today, SEASON)), [today]);
  const [session, setSession] = useState<Session | null>(null);
  // Unlock bracket changes are not stored yet; protect the active run across UTC midnight.
  const activeWindowRef = useRef(false);
  const [missing, setMissing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(() => new URLSearchParams(window.location.search).has('privacy'));
  // A ?day= link that can't be honoured (future, malformed or unpublished): say so once, then today opens.
  const [badLink, setBadLink] = useState(false);

  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);

  const open = useCallback(
    async (day: string, link?: { vs: number | null; vsTime: number | null }) => {
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
      activeWindowRef.current = false;
      setSession({
        mode: kind === 'runs' ? 'daily' : 'practice',
        kind,
        day,
        slate,
        viaLink: link !== undefined,
        vs: link?.vs ?? null,
        vsTime: link?.vsTime ?? null,
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
    // Opened from the calendar reminder's link: count it once a day, then drop only that parameter.
    if (new URLSearchParams(window.location.search).get('from') === 'calendar') {
      trackOnce(`remind-open:${today}`, today, { name: 'remind_open' });
      window.history.replaceState(null, '', withoutParams(window.location, ['from']));
    }
    const link = parseChallenge(window.location.search, today, inventoryDays);
    if (link.kind !== 'none') {
      track({
        name: 'challenge_open',
        kind: link.kind === 'day' ? (link.day === today ? 'today' : 'past') : link.kind,
        withScore: link.kind === 'day' && link.vs !== null,
      });
    }
    if (link.kind === 'invalid' || link.kind === 'future') {
      setBadLink(true);
      window.history.replaceState(null, '', withoutChallenge(window.location));
    }
    if (link.kind === 'day') void open(link.day, { vs: link.vs, vsTime: link.vsTime });
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
      if (!s || (s.kind === 'runs' && !activeWindowRef.current && !inProgress(store, s.day))) void open(d);
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
    setView('daily');
    void open(puzzleDay(new Date()));
  };

  const openSurvival = () => {
    if (offer.arm) trackOnce(`x:sv-cta:click:${today}`, today, { name: 'experiment', arm: offer.arm, step: 'click' });
    setSurvivalSource('cta');
    window.history.replaceState(null, '', '/?survival');
    setView('survival');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const updateSettings = (patch: Partial<typeof settings>) => {
    store.saveSettings(patch);
    setSettings((s) => ({ ...s, ...patch }));
  };

  const number = publicNumber(session ? session.day : today, SEASON).label;
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
            {view === 'survival' ? 'Survival' : number}
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
        {badLink && view === 'daily' && (
          <p className="link-note" role="status">
            <span>That link’s puzzle isn’t available, so here’s today’s.</span>
            <button type="button" className="btn-link" onClick={() => setBadLink(false)}>
              Dismiss
            </button>
          </p>
        )}
        {view === 'survival' && Survival ? (
          <Suspense fallback={<p className="loading" aria-live="polite">Loading Survival…</p>}>
            <Survival
              today={today}
              asOf={previewAsOf(window.location.search)}
              source={survivalSource}
              requireBeta={SURVIVAL_FLAG === 'on'}
              storage={storage}
              onBackToDaily={backToToday}
            />
          </Suspense>
        ) : session ? (
          <Game
            key={`${session.kind}:${session.day}`}
            session={session}
            store={store}
            today={today}
            showHint={!settings.introSeen}
            onFirstTouch={() => undefined}
            onTutorialDone={() => !settings.introSeen && updateSettings({ introSeen: true })}
            onWindowActive={() => { activeWindowRef.current = true; }}
            onRunComplete={() => { activeWindowRef.current = false; }}
            archive={archive}
            onPractice={(d) => void open(d)}
            onBackToToday={backToToday}
            offer={offer}
            storage={storage}
            onSurvival={openSurvival}
            onPrivacy={() => setPrivacyOpen(true)}
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

      <Help open={helpOpen} onClose={() => setHelpOpen(false)} onPrivacy={() => { setHelpOpen(false); setPrivacyOpen(true); }} />
      <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}

function Game(props: {
  session: Session;
  store: SaveStore;
  today: string;
  showHint: boolean;
  onFirstTouch: () => void;
  onTutorialDone: () => void;
  onWindowActive: () => void;
  onRunComplete: () => void;
  archive: readonly string[];
  onPractice: (day: string) => void;
  onBackToToday: () => void;
  offer: SurvivalOffer;
  storage: StorageLike | null;
  onSurvival: () => void;
  onPrivacy: () => void;
}) {
  const { session, store, today, offer } = props;
  const daily = session.mode === 'daily';
  const playMode: PlayMode = session.viaLink ? 'challenge' : session.mode;

  const [state, rawDispatch] = useReducer(gameReducer, undefined, (): GameState => {
    const saved = store.load()[session.kind]?.[session.day];
    return initGame(session.slate, session.mode, saved?.results ?? [], saved?.advanced ?? 0);
  });

  const firstShotKey = `stat-window:shot:v1:${session.slate.questions[0]?.id ?? ''}`;
  const [started, setStarted] = useState(() => {
    if ((store.load()[session.kind]?.[session.day]?.results.length ?? 0) > 0) return true;
    try { return window.sessionStorage.getItem(firstShotKey) !== null; } catch { return false; }
  });
  const start = () => {
    // Persist before mounting Q1 so an immediate refresh cannot grant fresh time.
    try { if (!window.sessionStorage.getItem(firstShotKey)) window.sessionStorage.setItem(firstShotKey, String(Date.now())); } catch { /* private mode fallback */ }
    trackOnce(`start:${playMode}:${session.kind}:${session.day}`, today, { name: 'run_start', mode: playMode });
    props.onWindowActive(); setStarted(true);
  };

  const dispatch = useCallback(
    (a: GameAction) => {
      if (a.type === 'setWindow') props.onWindowActive();
      if (a.type === 'next' && state.phase === 'resolved') track({ name: 'round_next', mode: playMode, round: state.round + 1 });
      if (a.type === 'setWindow' && state.round === 0 && state.phase === 'ready' && state.results.length === 0) {
        trackOnce(`touch:${playMode}:${session.kind}:${session.day}`, today, { name: 'first_touch', mode: playMode });
      }
      rawDispatch(a);
    },
    [state.phase, state.round, state.results.length, playMode, session.kind, session.day, today, props.onWindowActive],
  );

  // Persist every locked round immediately (before the reveal), so a refresh can't re-roll it.
  const advanced = state.phase === 'complete' ? state.results.length : state.round;
  useEffect(() => {
    store.saveRun(session.day, { results: state.results, advanced }, session.kind);
  }, [store, session.day, session.kind, state.results, advanced]);

  const pub = publicNumber(session.day, SEASON);
  useEffect(() => {
    if (state.phase === 'complete') props.onRunComplete();
  }, [state.phase, props.onRunComplete]);
  const lastLocked = useRef(state.results.length);
  useEffect(() => {
    if (state.results.length > lastLocked.current) {
      const r = state.results.at(-1)!;
      track({ name: 'round_lock', mode: playMode, round: state.results.length, hit: r.hit });
      if (state.results.length === ROUNDS) {
        track({ name: 'run_complete', mode: playMode, total: state.results.reduce((s, x) => s + x.points, 0) });
        // Once per completed daily (the daily record, even when opened from a same-day link): the streak
        // that ends on the day just finished. The run was saved by the effect above, so it is included.
        if (session.kind === 'runs') {
          const streak = playerStats(inSeason(store.load().runs, currentSeason(today, SEASON), SEASON), session.day).streak;
          trackOnce(`streak:${session.day}`, today, { name: 'streak', days: Math.max(1, streak) });
        }
      }
    }
    lastLocked.current = state.results.length;
  }, [state.results, playMode, session.kind, session.day, store, today]);

  // Leaving with a run part-way done (best effort; see docs/MEASUREMENT.md).
  const exitRef = useRef({ started: false, round: 0 });
  exitRef.current = {
    // Pressing Start counts as an active run even if a player closes without
    // moving a bracket; otherwise onboarding drop-off is undercounted.
    started: started && state.phase !== 'complete',
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
        // Those rounds were counted by the tab that locked them.
        lastLocked.current = saved.results.length;
        rawDispatch({ type: 'hydrate', state: initGame(session.slate, session.mode, saved.results, saved.advanced) });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  });

  const officialToday = playMode === 'daily' && session.day === today;
  const complete = state.phase === 'complete';
  // Experiment outcome: today's official daily was started. The arm arrives after the pool
  // check resolves, so this waits for it and has its own once-keys (not the run_start one).
  const startedHere = useRef(state.results.length === 0);
  useEffect(() => {
    // The daily-start experiment must be recorded only after the deliberate
    // Start gate, never from a tutorial/ready-screen impression.
    if (!started || !offer.arm || !officialToday || !startedHere.current) return;
    trackOnce(`x:sv-cta:start:${today}`, today, { name: 'experiment', arm: offer.arm, step: 'daily-start' });
    if (exposedYesterday(props.storage, today)) {
      trackOnce(`x:sv-cta:next:${today}`, today, { name: 'experiment', arm: offer.arm, step: 'next-day-start' });
    }
  }, [started, offer.arm, officialToday, props.storage, today]);
  // Experiment exposure: once per day, when today's official results are on screen (both arms).
  useEffect(() => {
    if (complete && officialToday && offer.arm && markExposed(props.storage, today)) {
      track({ name: 'experiment', arm: offer.arm, step: 'exposed' });
      // Once per browser ever: the unit for the stop rule (200 browsers per arm).
      trackOnce('x:sv-cta:first-exposure', today, { name: 'experiment', arm: offer.arm, step: 'first-exposure' });
    }
  }, [complete, officialToday, offer.arm, props.storage, today]);

  if (state.phase === 'complete') {
    // Only the current season's runs count, so beta history never inflates an official launch.
    const season = currentSeason(today, SEASON);
    const stats = playerStats(inSeason(store.load().runs, season, SEASON), today);
    // The comparison takes only the first completed run of today's official puzzle
    // (or yesterday's, finished just after midnight). The server re-checks all of it.
    const eligible = session.kind === 'runs' && (session.day === today || session.day === addDays(today, -1));
    return (
      <Results
        slate={session.slate}
        label={pub.label}
        eligible={eligible}
        onPrivacy={props.onPrivacy}
        mode={session.mode}
        playMode={playMode}
        isToday={session.day === today}
        vs={session.vs}
        vsTime={session.vsTime}
        results={state.results}
        stats={stats}
        archive={props.archive.filter((d) => d !== session.day)}
        onPractice={props.onPractice}
        onBackToToday={props.onBackToToday}
        onShared={(m: ShareMethod) => {
          if (offer.arm && officialToday && (m === 'native' || m === 'clipboard')) track({ name: 'experiment', arm: offer.arm, step: 'daily-share' });
        }}
        survivalCta={offer.open && offer.cta && officialToday ? props.onSurvival : null}
      />
    );
  }

  if (!started && state.results.length === 0) {
    return props.showHint ? <Onboarding onDone={() => { props.onTutorialDone(); start(); }} /> : (
      <article className="onboarding ready-card">
        <p className="context">{session.mode === 'practice' ? 'PRACTICE' : 'DAILY FIVE'}</p>
        <h1>Ready for five?</h1>
        <p>Find the number in each question. Five windows, 24 seconds each. The clock starts when each question appears.</p>
        <button type="button" className="btn btn-primary" onClick={start}>Start today's five</button>
      </article>
    );
  }

  // Difficulty and the day's theme stay in the content for editors and validators; players
  // see a plain count. The header already names the puzzle; this only says what kind of run it is.
  const where = daily || session.viaLink ? '' : 'Practice · ';
  const label = `${where}Question\u00a0${state.round + 1} of\u00a0${ROUNDS}`;

  return (
    <Round
      state={state}
      dispatch={dispatch}
      label={label}
      showHint={false}
      theme={session.slate.theme}
      challenge={session.viaLink && state.round === 0 && state.results.length === 0 ? { vs: session.vs, vsTime: session.vsTime } : null}
      onFirstTouch={() => { props.onWindowActive(); props.onFirstTouch(); }}
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
                {isMixedSportDay(day) && <span className="archive-tag"> · mixed sports</span>}
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
