import { useEffect, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { canLock, currentQuestion, ROUNDS, totalPoints, type GameAction, type GameState } from '../engine/game';
import { potentialPoints } from '../engine/scoring';
import { formatValue, unitFor } from '../lib/format';
import { feedback } from './feedback';
import { Readout } from './Readout';
import { Ruler, type RulerReveal } from './Ruler';
import { usePrefersReducedMotion } from './hooks';
import { browserFunFactSeed, pickFunFact } from './fun-facts';

type Props = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  label: string;
  /** Difficulty of this round (Easy … Expert), when the slate has one. */
  level?: string | undefined;
  /** The day's theme title, when the slate has one. */
  theme?: string | undefined;
  showHint: boolean;
  /** Set when the run came from a friend's link: shown before the first round only. */
  challenge?: { vs: number | null } | null;
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

const FIRST_TRAVEL_MS = 1350;
const TRAVEL_MS = 1050;
const CLAMP_MS = 260;
const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;

function hitLine(points: number): string {
  if (points === 100) return 'Nailed to the notch.';
  if (points >= 85) return 'Bang on.';
  if (points >= 60) return 'Tight. Good.';
  if (points >= 30) return 'Caught it.';
  return 'Caught, but loose.';
}

export function Round({ state, dispatch, label, level, theme, showHint, challenge = null, onFirstTouch, survival }: Props) {
  const q = currentQuestion(state);
  const reduced = usePrefersReducedMotion();
  const [factSeed] = useState(browserFunFactSeed);
  const extra = pickFunFact(q, factSeed);
  const last = state.results[state.round];
  const [progress, setProgress] = useState(0);
  const [shownPoints, setShownPoints] = useState(0);
  const actionRef = useRef<HTMLButtonElement>(null);
  const skipRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const interactive = state.phase === 'ready' || state.phase === 'adjusting';
  const worth = potentialPoints(q, state.window);

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
        window.setTimeout(() => dispatch({ type: 'settle' }), 420);
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
      const t = Math.min(1, (now - start) / 520);
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
                  Round {i + 1}: {shown ? `${r.points} points` : i === state.round ? 'now playing' : 'to play'}
                </span>
                                <span className="ledger-num" aria-hidden="true">{shown ? r.points : i + 1}</span>
              </li>
            );
          })}
        </ol>}
        <p className="round-meta">
          <span>{label}</span>
          {level && (
            <span className="round-level">
              <span className="sr-only"> · </span>
              {level}
            </span>
          )}
          <span className="round-total">
            <span className="tabular">{runningTotal}</span> pts
          </span>
        </p>
      </div>

      <header className="question-block">
        {challenge && interactive && (
          <p className="challenge-note">
            {challenge.vs === null ? (
              'A friend sent you these five.'
            ) : (
              <>
                A friend scored <b className="tabular">{challenge.vs}</b> on these five.
              </>
            )}
          </p>
        )}
        {theme && <p className="theme-line">{theme}</p>}
        <p className="context">
          {q.sport} · {q.context}
        </p>
        <h1 className="question" ref={headingRef} tabIndex={-1}>
          {q.prompt}
        </h1>
      </header>
      </div>

      <section className="field" aria-label="Your window">
        <div className="field-inner">
          <Readout question={q} window={state.window} editable={interactive} onChange={(w, m) => dispatch({ type: 'setWindow', window: w, moving: m })} />

          <div className="verdict-line" aria-live="polite">
            {resolved && survival ? (
              <SurvivalOutcome points={last.points} hit={last.hit} need={survival.need} shown={shownPoints} missBy={`${formatValue(last.missBy, q.step)} ${unitFor(last.missBy, q.unit)}`} />
            ) : resolved ? (
              last.hit ? (
                <p className="outcome outcome-hit">
                  <span className="outcome-word">
                    <span className="outcome-glyph" aria-hidden="true">✓</span>
                    {hitLine(last.points)}
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
            ) : worth === 0 ? (
              <p className="worth">
                {showHint
                  ? 'Drag a bracket in. Tighter scores more, up to 100. A miss scores 0.'
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
            onChange={(w, m) => dispatch({ type: 'setWindow', window: w, ...(m ? { moving: m } : {}) })}
            onCommit={() => {
              if (!short) dispatch({ type: 'lock' });
            }}
            onFirstTouch={onFirstTouch}
          />
        </div>
      </section>

      {resolved && (
        <section className="story" aria-label="About this answer">
          <p className="story-answer">
            <span className="tabular">{formatValue(q.answer, q.step)}</span> {unitFor(q.answer, q.unit)}
          </p>
          <p className="story-note">{q.note}</p>
          {extra && (
            <aside className="story-extra" aria-label="Bonus sports fact">
              <p className="story-extra-title">One more thing</p>
              <p className="story-extra-text">{extra.text}</p>
              <a className="story-extra-source" href={extra.source.url} target="_blank" rel="noopener noreferrer">
                Source: {extra.source.name}
              </a>
            </aside>
          )}
          <p className="story-source">
            Source:{' '}
            <a href={q.source.url} target="_blank" rel="noopener noreferrer">
              {q.source.name.replace(/ \(CC BY-SA 4\.0\)$/, '')}
            </a>
            {/ \(CC BY-SA 4\.0\)$/.test(q.source.name) && (
              <>
                {' ('}
                <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">
                  CC BY-SA 4.0
                </a>
                {')'}
              </>
            )}
            {q.source.derivation ? ` (${q.source.derivation})` : ''}
          </p>
        </section>
      )}

      <div className="action-bar">
        {interactive ? (
          <button type="button" className="btn btn-primary" disabled={!lockable} onClick={() => dispatch({ type: 'lock' })}>
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
