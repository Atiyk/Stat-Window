import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { canLock, currentQuestion, ROUNDS, totalPoints, type GameAction, type GameState } from '../engine/game';
import type { Theme } from '../content/schema';
import { potentialPoints } from '../engine/scoring';
import { formatValue, unitFor } from '../lib/format';
import { feedback } from './feedback';
import { Readout } from './Readout';
import { Ruler, type RulerReveal } from './Ruler';
import { usePrefersReducedMotion } from './hooks';
import { browserFunFactSeed, pickFunFact } from './fun-facts';
import { pickReactions } from './reactions';
import { SourcesDisclosure } from './Sources';

type Props = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  /** Plain question index; difficulty remains an internal editorial label. */
  label: string;
  showHint: boolean;
  theme?: Theme | undefined;
  /** Set when the run came from a friend's link: shown before the first round only. */
  challenge?: { vs: number | null; vsTime: number | null } | null;
  onFirstTouch: () => void;
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

const FIRST_TRAVEL_MS = 1000;
const TRAVEL_MS = 650;
const CLAMP_MS = 150;
const SHOT_CLOCK_MS = 24_000;
const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;

export function Round({ state, dispatch, label, showHint, theme, challenge = null, onFirstTouch, survival }: Props) {
  const q = currentQuestion(state);
  const reduced = usePrefersReducedMotion();
  const [factSeed] = useState(browserFunFactSeed);
  const extra = pickFunFact(q, factSeed);
  const last = state.results[state.round];
  // One short reaction per reveal, stable across refreshes and not repeated within a run.
  const reaction = last && !last.timedOut
    ? pickReactions(
        state.results.slice(0, state.round + 1).map((r, i) => {
          const rq = state.slate.questions[i] ?? q;
          return { questionId: r.questionId, input: { ...r, min: rq.min, max: rq.max, step: rq.step, round: i, rounds: ROUNDS } };
        }),
        factSeed,
      ).at(-1)?.text
    : undefined;
  const [progress, setProgress] = useState(0);
  const [shownPoints, setShownPoints] = useState(0);
  const actionRef = useRef<HTMLButtonElement>(null);
  const skipRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Restore the elapsed clock on the first render rather than briefly flashing
  // 24 seconds while React effects hydrate the saved deadline.
  const [secondsLeft, setSecondsLeft] = useState(() => {
    if (survival || typeof window === 'undefined') return 24;
    try {
      const startedAt = Number(window.sessionStorage.getItem(`stat-window:shot:v1:${q.id}`));
      if (!Number.isFinite(startedAt) || startedAt <= 0) return 24;
      return Math.ceil(Math.max(0, SHOT_CLOCK_MS - (Date.now() - startedAt)) / 1000);
    } catch {
      return 24;
    }
  });
  const shot = useRef<{ startedAt: number | null; stopped: boolean }>({ startedAt: null, stopped: false });
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const timed = survival === undefined;
  const shotKey = `stat-window:shot:v1:${q.id}`;
  // The browser-local timestamp prevents free time from refreshing or switching tabs.
  // It is never sent to the server or analytics; it cannot provide cheat-proof ranking.
  const rememberStart = (at: number) => {
    try { window.sessionStorage.setItem(shotKey, String(at)); } catch { /* storage blocked: memory timer still works */ }
  };
  const elapsed = () =>
    shot.current.startedAt === null ? 0 : Math.max(0, Math.min(SHOT_CLOCK_MS, Date.now() - shot.current.startedAt));
  const startShot = () => {
    if (!timed || shot.current.startedAt !== null || shot.current.stopped) return;
    shot.current.startedAt = Date.now();
    rememberStart(shot.current.startedAt);
  };
  const stopShot = () => {
    const spent = Math.round(elapsed());
    shot.current.stopped = true;
    // After a locked answer, no deadline remains to restore. Keeping one
    // could instantly expire a fresh replay if a player resets their save.
    try { window.sessionStorage.removeItem(shotKey); } catch { /* blocked storage */ }
    return spent;
  };
  const lockShot = () => {
    if (!canLock(state) || (survival && worth < survival.need)) return;
    if (survival) { dispatch({ type: 'lock' }); return; }
    startShot();
    const spent = stopShot();
    if (spent >= SHOT_CLOCK_MS) dispatch({ type: 'timeout', elapsedMs: SHOT_CLOCK_MS });
    else dispatch({ type: 'lock', elapsedMs: spent });
  };
  useEffect(() => {
    let startedAt: number | null = null;
    // Restoring a saved reveal must not create a new clock for a question
    // that is already locked. Doing so leaves a stale timestamp behind
    // and can instantly expire a later fresh replay of this puzzle.
    const needsClock = timed && (state.phase === 'ready' || state.phase === 'adjusting');
    if (needsClock) {
      try {
        const raw = window.sessionStorage.getItem(shotKey);
        const value = raw === null ? NaN : Number(raw);
        if (Number.isFinite(value) && value > 0) startedAt = value;
      } catch { /* storage may be blocked */ }
      // Question is only mounted after Start, so the deadline begins at appearance.
      if (startedAt === null) {
        startedAt = Date.now();
        rememberStart(startedAt);
      }
    }
    shot.current = { startedAt, stopped: !needsClock };
    setSecondsLeft(startedAt === null ? 24 : Math.ceil(Math.max(0, SHOT_CLOCK_MS - (Date.now() - startedAt)) / 1000));
    // A changed first-touch hint must never restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.round, q.id]);

  const interactive = state.phase === 'ready' || state.phase === 'adjusting';
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
        dispatchRef.current({ type: 'timeout', elapsedMs: SHOT_CLOCK_MS });
      }
    };
    // Browser intervals may be throttled in background tabs. The authoritative
    // deadline uses Date.now, and is rechecked immediately when the tab returns.
    const id = window.setInterval(tick, 100);
    document.addEventListener('visibilitychange', tick);
    tick();
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [timed, interactive, state.round]);

  // New round: reset the reveal and move focus to the question for screen readers.
  useEffect(() => {
    setProgress(0);
    setShownPoints(0);
    if (state.round > 0 || state.results.length > 0) {
      headingRef.current?.focus({ preventScroll: true });
      // The previous round may have left the page scrolled down to its fact; start the new one at the top.
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [state.round]);

  // locked → (brief clamp) → revealing
  useEffect(() => {
    if (state.phase !== 'locked') return;
    feedback.lock();
    const t = window.setTimeout(() => dispatch({ type: reduced ? 'settle' : 'reveal' }), reduced ? 0 : CLAMP_MS);
    return () => window.clearTimeout(t);
  }, [state.phase, reduced, dispatch]);

  // revealing: the answer travels along the ruler from the low end and lands.
  useEffect(() => {
    if (state.phase !== 'revealing' || !last) return;
    let raf = 0;
    let lastTickAt = 0;
    const start = performance.now();
    const duration = state.round === 0 ? FIRST_TRAVEL_MS : TRAVEL_MS;
    skipRef.current = false;
    const step = (now: number) => {
      const t = skipRef.current ? 1 : Math.min(1, (now - start) / duration);
      setProgress(easeOutQuint(t));
      if (now - lastTickAt > 70 + t * 160 && t < 0.92) {
        feedback.roll();
        lastTickAt = now;
      }
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        if (last.hit) feedback.hit(last.points);
        else feedback.miss();
        window.setTimeout(() => dispatch({ type: 'settle' }), 220);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [state.phase, state.round, last, dispatch]);

  // resolved: count the points up, then put focus on the next action.
  useEffect(() => {
    if (state.phase !== 'resolved' || !last) return;
    setProgress(1);
    actionRef.current?.focus({ preventScroll: true });
    if (reduced || last.points === 0) {
      setShownPoints(last.points);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 350);
      setShownPoints(Math.round(last.points * easeOutQuint(t)));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [state.phase, last, reduced]);

  const revealing = state.phase === 'revealing' || state.phase === 'resolved';
  // The flag sets off from whichever end of the ruler is farther from the answer, so it always has to cross ground.
  const from = q.answer - q.min > q.max - q.answer ? q.min : q.max;
  const reveal: RulerReveal | null = revealing && last ? { progress: state.phase === 'resolved' ? 1 : progress, hit: last.hit, from } : null;
  const resolved = state.phase === 'resolved' && last;
  // Don't leak the outcome before the answer lands.
  const runningTotal = survival ? survival.total : totalPoints(state.phase === 'resolved' ? state.results : state.results.slice(0, state.round));
  const short = survival !== undefined && worth < survival.need;
  const lockable = canLock(state) && !short;
  const isLast = state.round >= ROUNDS - 1;

  return (
    <article className="round" data-phase={state.phase} data-first-play={showHint || undefined}>
      <div className="round-head">
      <div className="round-top">
        {survival ? survival.ledger : <ol className="ledger" aria-label="Rounds">
          {Array.from({ length: ROUNDS }, (_, i) => {
            const r = state.results[i];
            const shown = r && (i < state.round || state.phase === 'resolved' || state.phase === 'complete');
            const status = shown ? (!r.hit ? 'miss' : r.points > 0 ? 'hit' : 'zero') : i === state.round ? 'current' : 'todo';
            return (
              <li key={i} className="ledger-cell" data-status={status}>
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
          <span className="round-total">
            <span className="tabular">{runningTotal}</span> pts
          </span>
          {timed && <span className="shot-clock" data-urgent={interactive && secondsLeft <= 5 || undefined} role="timer"
            aria-label={interactive ? `Shot clock: ${secondsLeft} seconds left` : 'Shot clock stopped'}>
            {!interactive && last?.elapsedMs !== undefined
              ? `${Math.ceil(Math.max(0, SHOT_CLOCK_MS - last.elapsedMs) / 1000)}s`
              : shot.current.startedAt === null && interactive ? '24s · ready' : `${secondsLeft}s`}
          </span>}
        </p>
      </div>

      <header className="question-block">
        {showHint && timed && interactive && (
          <p className="first-play-guide"><strong>First window:</strong> Drag both brackets around your best guess.
            Narrower = more points. Lock before the buzzer. Your 24 seconds start when the question appears.</p>
        )}
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
        <p className="context">
          {q.sport} · {theme && state.round === 0 && !survival ? (
            <><span className="puzzle-theme"><strong>{theme.title}</strong></span><span className="theme-subtitle"> · {theme.subtitle}</span></>
          ) : q.context}
        </p>
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

          <div className="verdict-line" aria-live="polite">
            {resolved && last.timedOut ? (
              <p className="outcome outcome-miss"><span className="outcome-word">Shot clock violation.</span>
                <span className="outcome-detail">Buzzer. +0. The answer is below.</span></p>
            ) : resolved && survival ? (
              <SurvivalOutcome points={last.points} hit={last.hit} need={survival.need} shown={shownPoints} missBy={`${formatValue(last.missBy, q.step)} ${unitFor(last.missBy, q.unit)}`} />
            ) : resolved ? (
              last.hit ? (
                <p className="outcome outcome-hit" data-zero={last.points === 0 || undefined}>
                  <span className="outcome-word">
                    <span className="outcome-glyph" aria-hidden="true">✓</span>
                    {last.points === 0 ? 'Inside, but too wide to score.' : 'Inside.'}
                  </span>
                  <span className="outcome-points tabular">+{shownPoints}</span>
                </p>
              ) : (
                <p className="outcome outcome-miss">
                  <span className="outcome-word">
                    <span className="outcome-glyph" aria-hidden="true">✕</span>
                    Outside.
                  </span>
                  <span className="outcome-detail">
                    Missed by {formatValue(last.missBy, q.step)} {unitFor(last.missBy, q.unit)}
                  </span>
                </p>
              )
            ) : state.phase === 'locked' || state.phase === 'revealing' ? (
              <p className="worth worth-locked">Locked at {worth} points. Here it comes…</p>
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
                {showHint
                  ? 'Drag brackets in. Your 24s started when this question appeared. Tighter scores more.'
                  : 'Pull the brackets in to start scoring.'}
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
              <p className="story-extra-title">One more thing</p>
              <p className="story-extra-text">{extra.text}</p>
            </aside>
          )}
          <SourcesDisclosure question={q} extra={extra} />
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

function SurvivalOutcome({ hit, points, need, shown, missBy }: { hit: boolean; points: number; need: number; shown: number; missBy: string }) {
  if (hit && points >= need) {
    return (
      <p className="outcome outcome-hit">
        <span className="outcome-word">
          <span className="outcome-glyph" aria-hidden="true">✓</span>
          Survived.
        </span>
        <span className="outcome-points tabular">+{shown}</span>
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
