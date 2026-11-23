import { useEffect, useRef, useState } from 'react';
import type { Question } from '../content/schema';
import { normalizeWindow } from '../engine/game';
import { potentialPoints, scoreWindow, type RoundScore, type Window } from '../engine/scoring';
import { unitFor } from '../lib/format';
import { usePrefersReducedMotion } from './hooks';
import { Readout } from './Readout';
import { Ruler, type RulerReveal } from './Ruler';

/**
 * A real, easy NBA-history warm-up using the same Readout, Ruler, scoring,
 * and reveal as daily play. It never loads or saves a scored daily slate.
 * In particular, the 24-second shot clock is not mounted until onDone().
 */
const PRACTICE: Pick<Question, 'min' | 'max' | 'step' | 'answer' | 'unit'> = {
  min: 0,
  max: 82,
  step: 1,
  answer: 73,
  unit: { singular: 'win', plural: 'wins' },
};

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [window, setWindow] = useState<Window>({ lo: PRACTICE.min, hi: PRACTICE.max });
  const [score, setScore] = useState<RoundScore | null>(null);
  const [progress, setProgress] = useState(0);
  const [landed, setLanded] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const answerRef = useRef<HTMLElement>(null);

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (!score) return;
    if (reducedMotion) { setProgress(1); setLanded(true); return; }
    let frame = 0;
    const started = performance.now();
    const animate = (now: number) => {
      const t = Math.min(1, (now - started) / 650);
      setProgress(1 - (1 - t) ** 5);
      if (t < 1) frame = requestAnimationFrame(animate);
      else setLanded(true);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [score, reducedMotion]);
  useEffect(() => {
    if (landed) answerRef.current?.focus({ preventScroll: true });
  }, [landed]);

  const editable = score === null;
  const moved = window.lo > PRACTICE.min || window.hi < PRACTICE.max;
  const worth = potentialPoints(PRACTICE, window);
  const reveal: RulerReveal | null = score
    ? { progress, hit: score.hit, from: PRACTICE.min, zero: score.hit && score.points === 0, missBy: score.missBy }
    : null;
  const outcome = score?.hit ? (score.points === 0 ? 'Inside, but too wide to score.' : 'Inside.') : 'Outside.';
  const announcement = !score ? '' : landed ? `${outcome} ${score.points} points. Answer: ${PRACTICE.answer} wins.` : 'Window locked.';
  const change = (next: Window, moving?: 'lo' | 'hi') => {
    if (editable) setWindow(normalizeWindow(PRACTICE, next, moving));
  };
  const lock = () => {
    if (editable && moved) {
      setProgress(0);
      setLanded(false);
      setScore(scoreWindow(PRACTICE, window));
    }
  };
  const replay = () => {
    setScore(null);
    setLanded(false);
    setProgress(0);
    setWindow({ lo: PRACTICE.min, hi: PRACTICE.max });
    titleRef.current?.focus({ preventScroll: true });
  };

  return (
    <article className="round onboarding-play" aria-label="First-play tutorial" data-phase={landed ? 'resolved' : editable ? 'ready' : 'revealing'}>
      <div className="round-head">
        <header className="question-block">
          <p className="context onboarding-status">Practice · <span className="shot-clock">No timer</span></p>
          <h1 className="onboarding-practice-title" ref={titleRef} tabIndex={-1}>How many regular-season games did the 2015–16 Golden State Warriors win?</h1>
        </header>
      </div>

      <section className="field" aria-label="Your practice window">
        <div className="field-inner">
          {editable && <p className="onboarding-coach">Drag a bracket or tap a number. Tighter windows score more if they catch the answer.</p>}
          <Readout question={PRACTICE} window={window} editable={editable} onChange={change} />
          <div className="sr-only" role="status">{announcement}</div>
          <div className="verdict-line">
            {landed && score ? score.hit ? (
              <p className="outcome outcome-hit" data-zero={score.points === 0 || undefined}>
                <span className="outcome-word">
                  <span className="outcome-glyph" aria-hidden="true">✓</span>
                  {outcome}
                </span>
                <span className="outcome-points tabular">+{score.points}</span>
              </p>
            ) : (
              <p className="outcome outcome-miss">
                <span className="outcome-word"><span className="outcome-glyph" aria-hidden="true">✕</span>{outcome}</span>
                <span className="outcome-detail">Missed by {score.missBy} {unitFor(score.missBy, PRACTICE.unit)}.</span>
              </p>
            ) : score ? (
              <p className="worth worth-locked">Window locked. Revealing the answer…</p>
            ) : (
              <p className="worth" data-zero={moved && worth === 0 || undefined}>
                {worth > 0 ? <>Worth <b className="tabular">{worth}</b> if it’s inside.</> : moved
                  ? <>Worth <b className="tabular">0</b> even if it’s inside. Pull in further.</>
                  : 'Pull the brackets in to start scoring.'}
              </p>
            )}
          </div>
          <Ruler question={PRACTICE} window={window} interactive={editable} reveal={reveal}
            onChange={change} onCommit={lock} onFirstTouch={() => undefined} />
        </div>
      </section>

      {landed && score && (
        <section className="story" aria-label="Practice answer" ref={answerRef} tabIndex={-1}>
          <p className="story-answer"><span className="tabular">{PRACTICE.answer}</span> wins</p>
          <p className="story-note">The Warriors finished 73–9, setting the NBA record for regular-season wins.</p>
        </section>
      )}

      <div className="action-bar onboarding-actions">
        {editable ? (
          <button type="button" className="btn btn-primary" disabled={!moved} onClick={lock}>
            {moved ? 'Lock the window' : 'Pull the brackets in first'}
          </button>
        ) : landed ? (
          <button type="button" className="btn btn-primary" onClick={onDone}>Start today's five</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled>Revealing…</button>
        )}
        {landed && <button type="button" className="btn btn-quiet" onClick={replay}>Try another window</button>}
        {editable && <button type="button" className="btn btn-quiet" onClick={onDone}>Skip tutorial and start</button>}
        {landed && <p className="onboarding-footnote">Five questions, 24 seconds each. Press Start to begin the first clock.</p>}
      </div>
    </article>
  );
}
