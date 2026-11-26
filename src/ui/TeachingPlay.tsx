import { useEffect, useRef, useState, type ReactNode } from 'react';
import { normalizeWindow } from '../engine/game';
import { potentialPoints, scoreWindow, type RoundScore, type Window } from '../engine/scoring';
import { contextLabel } from '../content/category';
import { explainWindow, type TeachingExample } from '../content/teaching';
import { formatValue, unitFor } from '../lib/format';
import { LiveCourtRun } from './CourtRun';
import { usePrefersReducedMotion } from './hooks';
import { QuestionChart } from './QuestionChart';
import { Readout } from './Readout';
import { Ruler, type RulerReveal } from './Ruler';
import './teaching.css';

export type TeachingPhase = 'ready' | 'revealing' | 'resolved';

export type TeachingControls = {
  phase: TeachingPhase;
  moved: boolean;
  score: RoundScore | null;
  lock: () => void;
  replay: () => void;
};

/**
 * One untimed teaching question, played with the real Readout, Ruler, QuestionChart
 * and scoring formula. It owns no store and sends no analytics: nothing here can reach
 * a daily, practice or Survival save, a streak, a PB or an official event. The 24-second
 * shot clock is never mounted.
 */
export function TeachingPlay({
  example,
  titleAs: Title = 'h1',
  titleClassName,
  titleId,
  focusTitle = true,
  coach = false,
  courtRun = false,
  status,
  actions,
  className = '',
  label,
}: {
  example: TeachingExample;
  titleAs?: 'h1' | 'h3';
  titleClassName?: string;
  titleId?: string;
  focusTitle?: boolean;
  /** First-play coaching that changes as the player drags, locks and sees the result. */
  coach?: boolean;
  /** Show the Live Court Run strip: points move the ball toward the hoop. */
  courtRun?: boolean;
  /** The top row above the prompt; a function receives the phase. */
  status?: ReactNode | ((phase: TeachingPhase) => ReactNode);
  actions: (c: TeachingControls) => ReactNode;
  className?: string;
  label: string;
}) {
  const q = example.question;
  const [window, setWindow] = useState<Window>({ lo: q.min, hi: q.max });
  const [score, setScore] = useState<RoundScore | null>(null);
  const [progress, setProgress] = useState(0);
  const [landed, setLanded] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const answerRef = useRef<HTMLElement>(null);

  useEffect(() => { if (focusTitle) titleRef.current?.focus({ preventScroll: true }); }, [focusTitle]);
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
  const moved = window.lo > q.min || window.hi < q.max;
  const worth = potentialPoints(q, window);
  const phase: TeachingPhase = landed ? 'resolved' : editable ? 'ready' : 'revealing';
  const reveal: RulerReveal | null = score
    ? { progress, hit: score.hit, from: q.answer - q.min > q.max - q.answer ? q.min : q.max, zero: score.hit && score.points === 0, missBy: score.missBy }
    : null;
  const feedback = score && landed ? explainWindow(q, window, score) : null;
  const outcome = score?.hit ? (score.points === 0 ? 'Inside, but too wide to score.' : 'Inside.') : 'Outside.';
  const answerText = `${formatValue(q.answer, q.step)} ${unitFor(q.answer, q.unit)}`;
  const announcement = !score ? '' : landed ? `Answer: ${answerText}. ${outcome} ${score.points} points.` : 'Window locked.';
  const change = (next: Window, moving?: 'lo' | 'hi') => {
    if (editable) setWindow(normalizeWindow(q, next, moving));
  };
  const lock = () => {
    if (editable && moved) {
      setProgress(0);
      setLanded(false);
      setScore(scoreWindow(q, window));
    }
  };
  const replay = () => {
    setScore(null);
    setLanded(false);
    setProgress(0);
    setWindow({ lo: q.min, hi: q.max });
    titleRef.current?.focus({ preventScroll: true });
  };
  const coachLine = !coach || !editable ? null : !moved
    ? 'Drag either bracket, or tap a big number to type it.'
    : worth === 0
      ? 'Still worth 0: a window this wide is a free catch, so it scores nothing. Keep pulling in.'
      : 'Tighter is worth more, but only if it still catches the answer. Edges count. Lock when you’re happy.';

  const verdictLine = (
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
          <span className="outcome-detail">Missed by {formatValue(score.missBy, q.step)} {unitFor(score.missBy, q.unit)}.</span>
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
  );

  return (
    <article className={`round teaching-play ${className}`} aria-label={label} data-phase={phase} data-example={example.id}>
      <div className="round-head">
        <header className="question-block">
          {typeof status === 'function' ? status(phase) : status}
          <Title className={titleClassName} id={titleId} ref={titleRef} tabIndex={-1}>{q.prompt}</Title>
          <p className="context">{contextLabel(q)}</p>
          {q.chart && (
            <QuestionChart question={q} window={window} reveal={reveal ? (landed ? 1 : reveal.progress) : null} />
          )}
        </header>
      </div>

      <section className="field" aria-label="Your practice window">
        <div className="field-inner">
          {coachLine && <p className="onboarding-coach" aria-live="polite">{coachLine}</p>}
          {landed && score && (
            <p className="reveal-answer"><span className="tabular">{formatValue(q.answer, q.step)}</span> {unitFor(q.answer, q.unit)}</p>
          )}
          {landed && verdictLine}
          <Readout question={q} window={window} editable={editable} caption={landed ? 'Your window' : undefined} onChange={change} />
          <div className="sr-only" role="status">{announcement}</div>
          {!landed && verdictLine}
          <Ruler question={q} window={window} interactive={editable} reveal={reveal}
            onChange={change} onCommit={lock} onFirstTouch={() => undefined} />
        </div>
      </section>

      <div className="teaching-after">
      {courtRun && (
        <div className="teaching-court">
          <LiveCourtRun earned={landed && score ? score.points : 0} potential={editable && worth > 0 ? worth : null} animate={landed} />
          <p className="teaching-court__caption">
            {landed && score ? (score.points > 0 ? `+${score.points} moves the ball up the court.` : 'No points, so the ball stays put.')
              : 'Points move the ball toward the hoop: five perfect windows, 500 points, reach the rim.'}
          </p>
        </div>
      )}

      {feedback && score && (
        <section className="story teaching-story" aria-label="Practice answer" ref={answerRef} tabIndex={-1} data-feedback={feedback.kind}>
          <p className="story-note">{q.note}</p>
          <p className="teaching-why"><strong>{feedback.headline}</strong> {feedback.detail}</p>
          {example.why !== q.note && <p className="teaching-why">{example.why}</p>}
        </section>
      )}
      </div>

      <div className="action-bar onboarding-actions">
        {actions({ phase, moved, score, lock, replay })}
      </div>
    </article>
  );
}
