import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { isMixedSportDay } from './content/cutover';
import { inventoryDays, loadSlate } from './content/inventory';
import type { Slate } from './content/schema';
import { parseChallenge } from './engine/challenge';
import { addDays, puzzleDay, puzzleNumber } from './engine/daily';
import { verifiedDailyRounds, verifiedPreviousBest } from './engine/final-shot';
import { LAUNCH_DAY } from './engine/launch-config';
import { currentSeason, inSeason, isRetiredDay, playableDays, publicNumber, seasonConfigFrom, type SeasonConfig } from './engine/season';
import { isQa } from './lib/scores';
import { gameReducer, initGame, ROUNDS, totalPoints, type GameAction, type GameState, type Mode, type PracticeTiming, type RoundRecord } from './engine/game';
import { createSaveStore, SAVE_KEY, UNTIMED_PRACTICE_KEY, type RunKind, type SavedRun, type SaveStore, type StorageLike } from './engine/storage';
import { MAX_TOTAL, playerStats, streakMilestone } from './engine/summary';
import { analyticsEnabled, setCohort, track, trackOnce, type PlayMode, type ShareMethod } from './lib/track';
import { CTA_TEST, previewAsOf, SURVIVAL_FLAG, wantsSurvival } from './survival/flag';
import { armFor, exposedYesterday, markExposed, type Arm } from './survival/experiment';
import { formatDay } from './lib/format';
import { setSoundEnabled } from './ui/feedback';
import { GuideLink, Help, type GuideView } from './ui/Help';
import type { PlayerFormat } from './content/formats';
import { PrivacyDialog } from './ui/Privacy';
import { Mark } from './ui/Mark';
import { Results } from './ui/Results';
import { Round } from './ui/Round';
import { Onboarding } from './ui/Onboarding';
import { PracticeTimingChoice } from './ui/PracticeTimingChoice';
import { Home } from './ui/Home';
import { Scouting } from './ui/Scouting';
import { Weekly, WeekGlance } from './ui/Weekly';
import { hasFinishedOfficialRun } from './ui/use-history';

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

type View = 'daily' | 'survival' | 'scouting' | 'weekly';
/** `?survival` (existing), `?scouting` and `?weekly` open those screens; anything else is the daily game. */
function viewFromSearch(search: string): View {
  if (wantsSurvival(search)) return 'survival';
  const params = new URLSearchParams(search);
  return params.has('scouting') ? 'scouting' : params.has('weekly') ? 'weekly' : 'daily';
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
 * earlier day the player already started as their daily) goes to the daily record.
 * Timed and untimed practice have separate records outside the daily stats.
 * `viaLink` marks a run opened from a friend's same-puzzle link; `vs` is the score
 * that link claimed, shown for comparison only.
 */
type Session = { mode: Mode; kind: RunKind; timing: PracticeTiming; day: string; slate: Slate; viaLink: boolean; vs: number | null; vsTime: number | null; vsRounds: readonly number[] | null };

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

const gameParams = ['day', 'vs', 'time', 'v', 'r', 'practice'] as const;
const withoutGameLink = (loc: Pick<Location, 'pathname' | 'search' | 'hash'>) => withoutParams(loc, gameParams);

const daysBetween = (a: string, b: string) => puzzleNumber(b) - puzzleNumber(a);

/**
 * Beta unless src/engine/launch-config.ts commits a LAUNCH_DAY (docs/LAUNCH.md). Non-production builds with
 * VITE_LAUNCH_PREVIEW=1 can try a launch day with ?launch-preview=YYYY-MM-DD.
 */
const SEASON: SeasonConfig = seasonConfigFrom(
  { launchDay: LAUNCH_DAY ?? undefined, preview: import.meta.env.VITE_LAUNCH_PREVIEW },
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

function hasConflictingLock(saved: SavedRun, current: readonly RoundRecord[]): boolean {
  return saved.results.some((record, index) => {
    const local = current[index];
    return local && (record.questionId !== local.questionId || record.lo !== local.lo || record.hi !== local.hi);
  });
}

export function App() {
  const storage = useMemo(() => safeLocalStorage(), []);
  const store = useMemo(() => createSaveStore(storage), [storage]);
  const untimedStore = useMemo(() => createSaveStore(storage, UNTIMED_PRACTICE_KEY), [storage]);
  const [view, setView] = useState<View>(() => viewFromSearch(window.location.search));
  const [survivalSource, setSurvivalSource] = useState<'cta' | 'link'>('link');

  const [settings, setSettings] = useState(() => store.load().settings);
  const [today, setToday] = useState(() => puzzleDay(new Date()));
  const offer = useSurvivalOffer(today, storage);
  useEffect(() => setCohort(isQa() ? 'qa' : currentSeason(today, SEASON)), [today]);
  const [session, setSession] = useState<Session | null>(null);
  const openRequest = useRef(0);
  // Protect an active window across Eastern midnight.
  const activeWindowRef = useRef(false);
  const [missing, setMissing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Where the How to play guide opens, and whether a timed question's clock is live under it.
  const [guideView, setGuideView] = useState<GuideView>('list');
  const [clockLive, setClockLive] = useState(false);
  const openGuide = useCallback((at: GuideView = 'list') => { setGuideView(at); setHelpOpen(true); }, []);
  const [privacyOpen, setPrivacyOpen] = useState(() => new URLSearchParams(window.location.search).has('privacy'));
  // A ?day= link that can't be honoured (future, malformed or unpublished): say so once, then today opens.
  const [badLink, setBadLink] = useState(false);
  const [retiredLink, setRetiredLink] = useState(false);

  useEffect(() => setSoundEnabled(settings.sound), [settings.sound]);

  const open = useCallback(
    async (day: string, options: { link?: { vs: number | null; vsTime: number | null; rounds?: readonly number[] | undefined }; timing?: PracticeTiming } = {}) => {
      const request = ++openRequest.current;
      let { link, timing = 'timed' } = options;
      // Never load retired beta content, even through stale UI callbacks.
      if (isRetiredDay(day, puzzleDay(new Date()), SEASON)) {
        setRetiredLink(true);
        window.history.replaceState(null, '', withoutGameLink(window.location));
        day = puzzleDay(new Date());
        link = undefined;
        timing = 'timed';
      }
      let slate: Slate | null;
      try {
        slate = await loadSlate(day);
      } catch {
        if (request !== openRequest.current) return;
        if (reloadForNewVersion()) return;
        slate = null;
      }
      if (request !== openRequest.current) return;
      if (!slate) {
        setMissing(true);
        setSession(null);
        return;
      }
      const isToday = day === puzzleDay(new Date());
      const kind: RunKind = timing === 'timed' && (isToday || store.load().runs[day]) ? 'runs' : 'practice';
      setMissing(false);
      activeWindowRef.current = false;
      setSession({
        mode: kind === 'runs' ? 'daily' : 'practice',
        kind,
        timing,
        day,
        slate,
        viaLink: link !== undefined,
        vs: link?.vs ?? null,
        vsTime: link?.vsTime ?? null,
        vsRounds: link?.rounds ?? null,
      });
    },
    [store],
  );

  const openAddress = useCallback((dayNow: string) => {
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const playable = playableDays(inventoryDays, dayNow, SEASON);
    const link = parseChallenge(search, dayNow, playable);
    const practice = params.get('practice');
    setBadLink(false);
    setRetiredLink(false);
    if (link.kind !== 'none') {
      track({
        name: 'challenge_open',
        kind: link.kind === 'day' ? (link.day === dayNow ? 'today' : 'past') : link.kind,
        withScore: link.kind === 'day' && link.vs !== null,
        withRounds: link.kind === 'day' && link.rounds !== undefined,
      });
    }
    if (link.kind === 'day') {
      // A legacy challenge link always retains its timed rules.
      if (practice !== null) window.history.replaceState(null, '', withoutParams(window.location, ['practice']));
      void open(link.day, { link: { vs: link.vs, vsTime: link.vsTime, rounds: link.rounds } });
      return;
    }
    if (link.kind === 'none' && practice !== null && practice < dayNow && playable.includes(practice)) {
      void open(practice, { timing: 'untimed' });
      return;
    }
    if (link.kind !== 'none' || practice !== null) {
      const requestedDay = params.get('day') ?? practice;
      if (requestedDay !== null && isRetiredDay(requestedDay, dayNow, SEASON)) setRetiredLink(true);
      else setBadLink(true);
      window.history.replaceState(null, '', withoutGameLink(window.location));
    }
    void open(dayNow);
  }, [open]);

  // First load: restore an untimed practice route or honour a same-puzzle link.
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
    openAddress(today);
    // Mount only: later day changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const navigate = () => {
      const dayNow = puzzleDay(new Date());
      setToday(dayNow);
      setView(viewFromSearch(window.location.search));
      openAddress(dayNow);
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, [openAddress]);

  // A new Eastern day while the tab is open: move to the new puzzle, unless the player
  // is part-way through a run (theirs to finish; it keeps its own day) or practising.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    const check = () => {
      const d = puzzleDay(new Date());
      if (d === today) return;
      setToday(d);
      const s = sessionRef.current;
      if (!s || (s.kind === 'runs' && !activeWindowRef.current && !inProgress(store, s.day))) void moveToNewDay(d);
    };
    // A tab opened before the deploy that scheduled (or cancelled) the season still has
    // the old launch day in its bundle. Check the deployed one before opening the new day
    // and reload if it differs, so numbering, stats and analytics follow the server.
    const moveToNewDay = async (d: string) => {
      try {
        const res = await fetch('/launch.json', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
        if (res.ok) {
          const deployed = ((await res.json()) as { launchDay?: unknown }).launchDay;
          if ((deployed === null || typeof deployed === 'string') && deployed !== LAUNCH_DAY) {
            // Reload onto the new day, not back onto an old ?day= link.
            window.history.replaceState(null, '', withoutGameLink(window.location));
            if (reloadForNewVersion()) return;
          }
        }
      } catch {
        // Offline or no manifest (dev server): keep this bundle's launch day.
      }
      void open(d);
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

  const openPractice = (day: string, timing: PracticeTiming = 'timed') => {
    const loc = window.location;
    if (timing === 'untimed') {
      const dayNow = puzzleDay(new Date());
      if (day >= dayNow || !playableDays(inventoryDays, dayNow, SEASON).includes(day)) return;
      const url = new URL(withoutGameLink(loc), loc.origin);
      url.searchParams.set('practice', day);
      window.history.pushState(null, '', url);
      void open(day, { timing });
    } else {
      // Leaving a friend's link for practice: a reload must reopen the practice, not the link.
      const params = new URLSearchParams(loc.search);
      if (gameParams.some((n) => params.has(n))) window.history.replaceState(null, '', withoutGameLink(loc));
      void open(day);
    }
  };

  const openSurvival = () => {
    if (offer.arm) trackOnce(`x:sv-cta:click:${today}`, today, { name: 'experiment', arm: offer.arm, step: 'click' });
    setSurvivalSource('cta');
    window.history.replaceState(null, '', '/?survival');
    setView('survival');
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const openView = (next: 'scouting' | 'weekly') => {
    window.history.pushState(null, '', `/?${next}`);
    setView(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const nav = {
    scouting: () => openView('scouting'),
    weekly: () => openView('weekly'),
    howToPlay: () => openGuide('list'),
  };

  const updateSettings = (patch: Partial<typeof settings>) => {
    store.saveSettings(patch);
    setSettings((s) => ({ ...s, ...patch }));
  };

  const number = publicNumber(session ? session.day : today, SEASON, today).display;
  const archive = playableDays(inventoryDays, today, SEASON).filter((d) => d < today).reverse();

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Stat Window, today’s puzzle">
          <Mark />
          <span className="wordmark">Stat Window</span>
        </a>
        <div className="topbar-right">
          <span className="day-label">
            {view === 'survival' ? 'Survival' : view === 'scouting' ? 'Scouting' : view === 'weekly' ? 'Weekly' : number}
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
          <button type="button" className="icon-btn" aria-label="How to play" onClick={() => openGuide()}>
            <span aria-hidden="true" className="icon-q">?</span>
          </button>
        </div>
      </header>

      <main className="main" id="main">
        {retiredLink && view === 'daily' && (
          <p className="link-note" role="status">
            <span>That beta puzzle was retired for the new season. Here’s today’s game instead.</span>
            <button type="button" className="btn-link" onClick={() => setRetiredLink(false)}>Dismiss</button>
          </p>
        )}
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
        ) : view === 'scouting' ? (
          <Scouting store={store} today={today} config={SEASON} onBack={backToToday} onWeekly={() => { track({ name: 'weekly_open', source: 'scouting' }); nav.weekly(); }} />
        ) : view === 'weekly' ? (
          <Weekly store={store} today={today} config={SEASON} onBack={backToToday} />
        ) : session ? (
          <Game
            key={`${session.kind}:${session.timing}:${session.day}`}
            session={session}
            store={session.timing === 'untimed' ? untimedStore : store}
            today={today}
            showHint={!settings.introSeen}
            onFirstTouch={() => undefined}
            onTutorialDone={() => !settings.introSeen && updateSettings({ introSeen: true })}
            onWindowActive={() => { activeWindowRef.current = true; }}
            onRunComplete={() => { activeWindowRef.current = false; }}
            archive={archive}
            onPractice={openPractice}
            onBackToToday={backToToday}
            offer={offer}
            storage={storage}
            onSurvival={openSurvival}
            onPrivacy={() => setPrivacyOpen(true)}
            nav={nav}
            onGuide={openGuide}
            onClockLive={setClockLive}
          />
        ) : missing ? (
          <NoPuzzle today={today} archive={archive} onPractice={openPractice} store={store} nav={nav} />
        ) : (
          <p className="loading" aria-live="polite">Loading today’s puzzle…</p>
        )}
      </main>

      {!store.persistent && (
        <p className="storage-note" role="note">
          This browser isn’t saving progress, so a refresh will start today over.
        </p>
      )}

      <Help open={helpOpen} view={guideView} clockLive={clockLive && view === 'daily'} onClose={() => setHelpOpen(false)} onPrivacy={() => { setHelpOpen(false); setPrivacyOpen(true); }} />
      <PrivacyDialog open={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </div>
  );
}

/** Entry points to the secondary screens, and the home's "How to play" slot. */
type Nav = { scouting: () => void; weekly: () => void; howToPlay: () => void };

function PreviousDailyScore({ today, store }: { today: string; store: SaveStore }) {
  const yesterday = addDays(today, -1);
  const [previous, setPrevious] = useState<{ day: string; score: number } | null>(null);

  useEffect(() => {
    if (!store.persistent || currentSeason(yesterday, SEASON) !== currentSeason(today, SEASON)) return;
    const run = store.load().runs[yesterday];
    if (!run || run.advanced !== ROUNDS || run.results.length !== ROUNDS) return;

    // Match the saved answers and points against the published slate before showing a score.
    let active = true;
    void loadSlate(yesterday).then((slate) => {
      if (!active || !slate) return;
      const game = initGame(slate, 'daily', run.results, run.advanced);
      if (game.phase !== 'complete') return;
      if (verifiedDailyRounds(slate, game.results)) setPrevious({ day: yesterday, score: totalPoints(game.results) });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [store, today, yesterday]);

  return previous?.day === yesterday ? (
    <p className="ready-previous">Yesterday: <strong className="tabular">{previous.score} / {MAX_TOTAL}</strong></p>
  ) : null;
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
  onPractice: (day: string, timing?: PracticeTiming) => void;
  onBackToToday: () => void;
  offer: SurvivalOffer;
  storage: StorageLike | null;
  onSurvival: () => void;
  onPrivacy: () => void;
  nav: Nav;
  onGuide: (at?: GuideView) => void;
  onClockLive: (live: boolean) => void;
}) {
  const { session, store, today, offer } = props;
  const daily = session.mode === 'daily';
  const untimedPractice = session.timing === 'untimed';
  const playMode: PlayMode = session.viaLink ? 'challenge' : session.mode;
  const eventRun = untimedPractice ? 'untimedPractice' : session.kind;
  const season = currentSeason(today, SEASON);
  const comparesPersonalBest = session.kind === 'runs' && playMode === 'daily'
    && currentSeason(session.day, SEASON) === season;
  const [previousBest, setPreviousBest] = useState<number | null>(null);
  useEffect(() => {
    if (!comparesPersonalBest || !store.persistent) return;
    let request = 0;
    const refreshBest = () => {
      const current = ++request;
      void verifiedPreviousBest(store.load().runs, session.day, SEASON, loadSlate)
        .catch(() => null)
        .then((best) => { if (current === request) setPreviousBest(best); });
    };
    const historyChanged = (event: StorageEvent) => {
      // Yesterday can become a completed historical run in another tab just after midnight.
      if (event.key === SAVE_KEY || event.key === null) refreshBest();
    };
    refreshBest();
    window.addEventListener('storage', historyChanged);
    return () => {
      request++;
      window.removeEventListener('storage', historyChanged);
    };
  }, [comparesPersonalBest, session.day, store]);

  const [state, rawDispatch] = useReducer(gameReducer, undefined, (): GameState => {
    const saved = store.load()[session.kind]?.[session.day];
    return initGame(session.slate, session.mode, saved?.results ?? [], saved?.advanced ?? 0);
  });

  const startKey = untimedPractice ? `stat-window:practice-start:v1:${session.day}`
    : `stat-window:shot:v1:${session.slate.questions[0]?.id ?? ''}`;
  const [started, setStarted] = useState(() => {
    if ((store.load()[session.kind]?.[session.day]?.results.length ?? 0) > 0) return true;
    try { return window.sessionStorage.getItem(startKey) !== null; } catch { return false; }
  });
  // A new player on the home chose to learn first: the untimed walkthrough, then the daily.
  const [learning, setLearning] = useState(false);
  const practiceHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (practiceHeading.current) {
      practiceHeading.current.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [started]);
  const start = () => {
    // Persist before mounting Q1. Timed rounds use this value as their deadline origin.
    try { if (!window.sessionStorage.getItem(startKey)) window.sessionStorage.setItem(startKey, String(Date.now())); } catch { /* private mode fallback */ }
    trackOnce(`start:${playMode}:${eventRun}:${session.day}`, today, { name: 'run_start', mode: playMode });
    props.onWindowActive(); setStarted(true);
  };

  const [freshCompletion, setFreshCompletion] = useState(false);
  const dispatch = useCallback(
    (a: GameAction) => {
      if (a.type === 'setWindow') props.onWindowActive();
      if (a.type === 'next' && state.phase === 'resolved') {
        track({ name: 'round_next', mode: playMode, round: state.round + 1 });
        if (state.results.length === ROUNDS) {
          setFreshCompletion((store.load()[session.kind]?.[session.day]?.advanced ?? 0) < ROUNDS);
        }
      }
      if (a.type === 'setWindow' && state.round === 0 && state.phase === 'ready' && state.results.length === 0) {
        trackOnce(`touch:${playMode}:${eventRun}:${session.day}`, today, { name: 'first_touch', mode: playMode });
      }
      rawDispatch(a);
    },
    [state.phase, state.round, state.results.length, playMode, eventRun, session.kind, session.day, store, today, props.onWindowActive],
  );

  const lastLocked = useRef(state.results.length);
  const adoptSave = useCallback((saved: SavedRun) => {
    // The tab that locked these rounds already reported them.
    lastLocked.current = saved.results.length;
    rawDispatch({ type: 'hydrate', state: initGame(session.slate, session.mode, saved.results, saved.advanced) });
  }, [session.slate, session.mode]);

  // Persist every locked round immediately (before the reveal), so a refresh can't re-roll it.
  const advanced = state.phase === 'complete' ? state.results.length : state.round;
  useEffect(() => {
    const saved = store.saveRun(session.day, { results: state.results, advanced }, session.kind);
    if (untimedPractice && state.results.length > 0) {
      try { window.sessionStorage.removeItem(startKey); } catch { /* storage blocked */ }
    }
    if ((daily || untimedPractice) && hasConflictingLock(saved, state.results)) adoptSave(saved);
  }, [store, session.day, session.kind, state.results, advanced, daily, untimedPractice, startKey, adoptSave]);

  const pub = publicNumber(session.day, SEASON, today);
  useEffect(() => {
    if (state.phase === 'complete') props.onRunComplete();
  }, [state.phase, props.onRunComplete]);
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

  // Adopt another tab's progress between rounds. Conflicting shared locks
  // always reconcile with the saved result, even during the local reveal.
  useEffect(() => {
    const onStorage = () => {
      const saved = store.load()[session.kind]?.[session.day];
      if (!saved) return;
      const interactive = state.phase === 'ready' || state.phase === 'adjusting';
      if ((interactive && saved.results.length > state.results.length) ||
          ((daily || untimedPractice) && hasConflictingLock(saved, state.results))) {
        adoptSave(saved);
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

  // The guide needs to know when a timed clock is running under it (it never pauses it).
  const clockLive = started && session.timing === 'timed' && (state.phase === 'ready' || state.phase === 'adjusting');
  const { onClockLive } = props;
  useEffect(() => {
    onClockLive(clockLive);
    return () => onClockLive(false);
  }, [clockLive, onClockLive]);

  if (state.phase === 'complete') {
    // Only the current season's runs count, so beta history never inflates an official launch.
    const history = inSeason(store.load().runs, season, SEASON);
    const stats = playerStats(history, today);
    const officialHighlight = freshCompletion && comparesPersonalBest;
    const milestone = officialHighlight
      ? streakMilestone(playerStats(history, session.day).streak)
      : null;
    // The comparison takes only the first completed run of today's official puzzle
    // (or yesterday's, finished just after midnight). The server re-checks all of it.
    const eligible = session.kind === 'runs' && (session.day === today || session.day === addDays(today, -1));
    return (
      <Results
        slate={session.slate}
        label={pub.label}
        screenLabel={pub.display}
        eligible={eligible}
        onPrivacy={props.onPrivacy}
        mode={session.mode}
        playMode={playMode}
        untimedPractice={untimedPractice}
        isToday={session.day === today}
        vs={session.vs}
        vsTime={session.vsTime}
        vsRounds={session.vsRounds}
        results={state.results}
        stats={stats}
        officialHighlight={officialHighlight ? {
          lastBest: verifiedDailyRounds(session.slate, state.results) ? previousBest : null,
          milestone,
        } : undefined}
        animateScorecard={freshCompletion}
        archive={props.archive.filter((d) => d !== session.day)}
        onPractice={props.onPractice}
        onBackToToday={props.onBackToToday}
        onShared={(m: ShareMethod) => {
          if (offer.arm && officialToday && (m === 'native' || m === 'clipboard')) track({ name: 'experiment', arm: offer.arm, step: 'daily-share' });
        }}
        survivalCta={offer.open && offer.cta && officialToday ? props.onSurvival : null}
        weekly={<WeekGlance store={store} today={today} config={SEASON} onOpen={() => { track({ name: 'weekly_open', source: 'results' }); props.nav.weekly(); }} link={false} />}
        onWeekly={() => { track({ name: 'weekly_open', source: 'results' }); props.nav.weekly(); }}
        onScouting={() => { track({ name: 'scouting_open', source: 'results' }); props.nav.scouting(); }}
      />
    );
  }

  if (!started && state.results.length === 0) {
    const ownDaily = playMode === 'daily' && session.kind === 'runs' && session.day === today && !session.viaLink;
    const finishTutorial = () => { props.onTutorialDone(); start(); };
    // The walkthrough: chosen from the home by a new player, or first on a new player's timed
    // practice. A friend's challenge link goes straight to its Start gate: no walkthrough in the way.
    if (learning || (props.showHint && !ownDaily && !untimedPractice && !session.viaLink)) {
      return <Onboarding playLabel={ownDaily ? `Play Game ${pub.number}` : 'Start practice'} onDone={finishTutorial} onGuide={() => props.onGuide()} />;
    }
    // A friend's link, practice and untimed practice go straight to their own start gate; only the
    // player's own official daily gets the home, which teaches new players at a glance.
    if (ownDaily) {
      return (
        <Home
          isNew={props.showHint}
          gameNumber={pub.number}
          onLearn={() => setLearning(true)}
          store={store}
          today={today}
          config={SEASON}
          onStart={props.showHint ? finishTutorial : start}
          previous={<PreviousDailyScore today={today} store={store} />}
          archive={props.archive}
          onPractice={props.onPractice}
          onScouting={() => props.nav.scouting()}
          onWeekly={() => props.nav.weekly()}
          onSurvival={offer.open && offer.cta ? props.onSurvival : null}
          onHowToPlay={props.nav.howToPlay}
        />
      );
    }
    // The gate names where the player is going: their official daily, a friend's
    // challenge (with the date and the score to beat, before any clock starts), or practice.
    const isToday = session.day === today;
    const puzzle = isToday ? 'today’s puzzle' : `${formatDay(session.day)} puzzle`;
    const gate = untimedPractice
      ? { context: 'Untimed practice', title: 'Ready for five?', body: 'Take your time on all five questions. Not counted in your stats.', cta: 'Start practice' }
      : session.viaLink
        ? {
          context: `Challenge · ${puzzle}`,
          title: session.vs !== null && session.vs > 0 ? `Beat ${session.vs} ${session.vs === 1 ? 'point' : 'points'}` : 'Ready for five?',
          body: `${session.vs !== null ? `Your friend scored ${session.vs}. ` : ''}The same five questions, 24 seconds each.${daily ? ' This counts as your daily.' : ' Not counted in your stats.'}`,
          cta: 'Start the challenge',
        }
        : daily
          ? { context: 'Daily puzzle', title: 'How well do you know ball?', body: 'Five NBA questions, 24 seconds each. Frame each answer between two brackets.', cta: `Play Game ${pub.number}` }
          : { context: `Practice · ${puzzle}`, title: 'Ready for five?', body: '24 seconds per question. Not counted in your stats.', cta: 'Start practice' };
    return (
      <article className="ready-card">
        <p className="context">{gate.context}</p>
        <h1 ref={untimedPractice ? practiceHeading : undefined} tabIndex={untimedPractice ? -1 : undefined}>{gate.title}</h1>
        <p>{gate.body}</p>
        <button type="button" className="btn btn-primary" onClick={start}>{gate.cta}</button>
        <GuideLink onOpen={() => props.onGuide()} />
      </article>
    );
  }

  // Difficulty and daily theme metadata stay internal; every round displays its own category.
  const where = untimedPractice ? 'Untimed practice · ' : daily || session.viaLink ? '' : 'Practice · ';
  const label = state.round === ROUNDS - 1
    ? `Final\u00a0window · ${ROUNDS}\u00a0of\u00a0${ROUNDS}`
    : `${where}Question\u00a0${state.round + 1} of\u00a0${ROUNDS}`;

  return (
    <Round
      state={state}
      dispatch={dispatch}
      label={label}
      timing={session.timing}
      courtRun={daily || session.vsRounds !== null}
      race={session.vsRounds}
      previousBest={comparesPersonalBest ? previousBest : null}
      challenge={session.viaLink && state.round === 0 && state.results.length === 0 ? { vs: session.vs, vsTime: session.vsTime, race: session.vsRounds !== null } : null}
      onFirstTouch={() => { props.onWindowActive(); props.onFirstTouch(); }}
      onGuide={(f: PlayerFormat) => props.onGuide(f)}
    />
  );
}

function NoPuzzle({ today, archive, onPractice, store, nav }: { today: string; archive: readonly string[]; onPractice: (day: string, timing?: PracticeTiming) => void; store: SaveStore; nav: Nav }) {
  const before = today < (inventoryDays[0] ?? today);
  const [timing, setTiming] = useState<PracticeTiming>('timed');
  return (
    <article className="results">
      <header className="results-head">
        <p className="context">{formatDay(today)}</p>
        <h1 className="results-title">{before ? 'Not open yet.' : 'Today’s puzzle is still being checked.'}</h1>
        <p className="archive-sub">
          {before
            ? `The first puzzle opens on ${formatDay(inventoryDays[0] ?? addDays(today, 1))}.`
            : 'Today’s game isn’t ready. Try an earlier day.'}
        </p>
      </header>
      {hasFinishedOfficialRun(store, today, SEASON) && (
        <p className="home-links">
          <button type="button" className="btn-link" onClick={() => { track({ name: 'scouting_open', source: 'home' }); nav.scouting(); }}>Scouting Report</button>
          <button type="button" className="btn-link" onClick={() => { track({ name: 'weekly_open', source: 'home' }); nav.weekly(); }}>Weekly Scoreboard</button>
        </p>
      )}
      {archive.length > 0 && (
        <>
          <PracticeTimingChoice timing={timing} onChange={setTiming} />
          <ul className="archive-list">
            {archive.map((day) => (
              <li key={day}>
                <button type="button" className="btn btn-quiet" onClick={() => onPractice(day, timing)}>
                  {formatDay(day)}
                  {isMixedSportDay(day) && <span className="archive-tag"> · mixed sports</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
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
