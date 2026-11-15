import { useEffect, useRef, useState, type Dispatch } from 'react';
import { currentQuestion, ROUNDS, totalPoints, type GameAction, type GameState } from '../engine/game';
import { potentialPoints } from '../engine/scoring';
import { formatValue, unitFor } from '../lib/format';
import { feedback } from './feedback';
import { Readout } from './Readout';
import { Ruler, type RulerReveal } from './Ruler';
import { usePrefersReducedMotion } from './hooks';

type Props = {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  label: string;
  showHint: boolean;
  onFirstTouch: () => void;
};

const TRAVEL_MS = 1350;
const CLAMP_MS = 260;
const easeOutQuint = (t: number) => 1 - (1 - t) ** 5;

export function Round({ state, dispatch, label, showHint, onFirstTouch }: Props) {
  const q = currentQuestion(state);
  const reduced = usePrefersReducedMotion();
  const last = state.results[state.round];
  const [progress, setProgress] = useState(0);
  const [shownPoints, setShownPoints] = useState(0);
  const actionRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const interactive = state.phase === 'ready' || state.phase === 'adjusting';
  const worth = potentialPoints(q, state.window);

  // New round: reset the reveal and move focus to the question for screen readers.
  useEffect(() => {
    setProgress(0);
    setShownPoints(0);
    if (state.round > 0 || state.results.length > 0) headingRef.current?.focus({ preventScroll: true });
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
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TRAVEL_MS);
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
  }, [state.phase, last, dispatch]);

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
  const reveal: RulerReveal | null = revealing && last ? { progress: state.phase === 'resolved' ? 1 : progress, hit: last.hit } : null;
  const resolved = state.phase === 'resolved' && last;
  // Don't leak the outcome before the answer lands.
  const runningTotal = totalPoints(state.phase === 'resolved' ? state.results : state.results.slice(0, state.round));
  const isLast = state.round >= ROUNDS - 1;

  return (
    <article className="round" data-phase={state.phase}>
      <div className="round-head">
      <div className="round-top">
        <ol className="ledger" aria-label="Rounds">
          {Array.from({ length: ROUNDS }, (_, i) => {
            const r = state.results[i];
            const shown = r && (i < state.round || state.phase === 'resolved' || state.phase === 'complete');
            const status = shown ? (r.hit ? 'hit' : 'miss') : i === state.round ? 'current' : 'todo';
            return (
              <li key={i} className="ledger-cell" data-status={status}>
                <span className="sr-only">
                  Round {i + 1}: {shown ? `${r.points} points` : i === state.round ? 'now playing' : 'to play'}
                </span>
                <span className="ledger-fill" style={{ transform: `scaleY(${shown ? Math.max(0.08, r.points / 100) : 0})` }} aria-hidden="true" />
                <span className="ledger-num" aria-hidden="true">{shown ? r.points : i + 1}</span>
              </li>
            );
          })}
        </ol>
        <p className="round-meta">
          <span>{label}</span>
          <span className="round-total">
            <span className="tabular">{runningTotal}</span> pts
          </span>
        </p>
      </div>

      <header className="question-block">
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
            {resolved ? (
              last.hit ? (
                <p className="outcome outcome-hit">
                  <span className="outcome-word">{last.points >= 90 ? 'Pinpoint.' : last.points >= 60 ? 'In, and tight.' : 'In.'}</span>
                  <span className="outcome-points tabular">+{shownPoints}</span>
                </p>
              ) : (
                <p className="outcome outcome-miss">
                  <span className="outcome-word">Outside.</span>
                  <span className="outcome-detail">
                    Missed by {formatValue(last.missBy, q.step)} {unitFor(last.missBy, q.unit)}
                  </span>
                </p>
              )
            ) : state.phase === 'locked' || state.phase === 'revealing' ? (
              <p className="worth worth-locked">Locked at {worth} points. Here it comes…</p>
            ) : (
              <p className="worth">
                Worth <b className="tabular">{worth}</b> if it’s inside. Miss and it’s 0.
              </p>
            )}
          </div>

          <Ruler
            question={q}
            window={state.window}
            interactive={interactive}
            reveal={reveal}
            onChange={(w, m) => dispatch({ type: 'setWindow', window: w, ...(m ? { moving: m } : {}) })}
            onCommit={() => dispatch({ type: 'lock' })}
            onFirstTouch={onFirstTouch}
          />
          <p className="hint" data-visible={showHint && interactive && state.phase === 'ready'} aria-hidden={!showHint}>
            Drag the brackets in. The tighter the window, the more it pays.
          </p>
        </div>
      </section>

      {resolved && (
        <section className="story" aria-label="About this answer">
          <p className="story-answer">
            <span className="tabular">{formatValue(q.answer, q.step)}</span> {unitFor(q.answer, q.unit)}
          </p>
          <p className="story-note">{q.note}</p>
          <p className="story-source">
            Source:{' '}
            <a href={q.source.url} target="_blank" rel="noopener noreferrer">
              {q.source.name}
            </a>
            {q.source.derivation ? ` (${q.source.derivation})` : ''}
          </p>
        </section>
      )}

      <div className="action-bar">
        {interactive ? (
          <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'lock' })}>
            Lock it in
          </button>
        ) : (
          <button
            ref={actionRef}
            type="button"
            className="btn btn-primary"
            disabled={state.phase !== 'resolved'}
            onClick={() => dispatch({ type: 'next' })}
          >
            {state.phase !== 'resolved' ? 'Revealing…' : isLast ? 'See your day' : 'Next question'}
          </button>
        )}
      </div>
    </article>
  );
}
