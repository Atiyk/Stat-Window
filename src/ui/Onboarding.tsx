import { useEffect, useRef, useState } from 'react';
import type { Question } from '../content/schema';
import { normalizeWindow } from '../engine/game';
import { potentialPoints, scoreWindow, type RoundScore, type Window } from '../engine/scoring';
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
    ? { progress, hit: score.hit, from: PRACTICE.max }
    : null;
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
        <div className="round-top">
          <ol className="ledger" aria-label="Five rounds in a real game">
            {Array.from({ length: 5 }, (_, i) => (
              <li className="ledger-cell" data-status={i === 0 ? landed ? score?.hit ? 'hit' : 'miss' : 'current' : 'todo'} key={i}>
                <span className="ledger-num" aria-hidden="true">{i === 0 ? 'P' : i + 1}</span>
              </li>
            ))}
          </ol>
          <p className="round-meta">
            <span className="round-label">Practice · not counted</span>
            <span className="shot-clock" aria-label="The practice clock is off">No timer</span>
          </p>
        </div>
        <header className="question-block">
          <p className="context">PRACTICE · CATCH THE NUMBER</p>
          <h1 className="onboarding-practice-title" ref={titleRef} tabIndex={-1}>How many regular-season games did the 2015–16 Golden State Warriors win?</h1>
          <p className="context onboarding-example-note">Real NBA history · No timer · Practice only</p>
        </header>
      </div>

      <section className="field" aria-label="Your practice window">
        <div className="field-inner">
          <p className="onboarding-coach">
            {editable
              ? 'Drag the two brackets around your guess, or tap either big number to type. Tighter means more points if you catch the answer.'
              : 'Your window is locked. Watch where the answer lands.'}
          </p>
          <Readout question={PRACTICE} window={window} editable={editable} onChange={change} />
          <div className="verdict-line" aria-live="polite">
            {landed && score ? score.hit ? (
              <p className="outcome outcome-hit">
                <span className="outcome-word">Inside.</span>
                <span className="outcome-points tabular">+{score.points}</span>
              </p>
            ) : (
              <p className="outcome outcome-miss">
                <span className="outcome-word">Outside.</span>
                <span className="outcome-detail">A miss earns zero.</span>
              </p>
            ) : score ? (
              <p className="worth worth-locked">Locked at {worth} points. Here it comes…</p>
            ) : (
              <p className="worth">
                {worth === 0 ? 'Pull the brackets in to start scoring.' : <>Worth <b className="tabular">{worth}</b> if it's inside, 0 if not.</>}
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
          <p className="story-note">{score.hit
            ? score.points === 0 ? 'You caught 73, but the window was too wide to earn points.' : 'You caught 73! A smaller window earns more when the answer is inside.'
            : '73 fell outside your window. Try again to find a safer range.'}</p>
          <p className="context">The Warriors finished 73–9, setting the NBA record for regular-season wins. Practice only; no score was saved. <a href="https://en.wikipedia.org/wiki/2015%E2%80%9316_Golden_State_Warriors_season" target="_blank" rel="noopener noreferrer">Source: Wikipedia contributors (CC BY-SA 4.0)</a></p>
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
        <p className="onboarding-footnote">Real game: five questions, 24 seconds each. Your first clock starts only when you press Start.</p>
      </div>
    </article>
  );
}
