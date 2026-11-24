import { useId, useLayoutEffect, useRef } from 'react';
import {
  COURT_HEIGHT, COURT_HOOP, COURT_LINES, COURT_START, COURT_WIDTH,
  courtCheckpointMarkerY, courtPosition, courtProgress, type CourtCheckpoint,
} from '../engine/court-run';
import { MAX_TOTAL } from '../engine/summary';
import { usePrefersReducedMotion } from './hooks';
import './court.css';

export function CourtOutline() {
  return <g className="court-outline">{COURT_LINES.map((path) => <path d={path} key={path} />)}</g>;
}

const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

export function CourtRun({ total, checkpoints, animate = false }: {
  total: number;
  checkpoints?: readonly CourtCheckpoint[];
  animate?: boolean;
}) {
  const headingId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const position = courtPosition(total);
  const markers = checkpoints?.map((checkpoint) => ({ ...checkpoint, markerY: courtCheckpointMarkerY(checkpoint) }));
  const previousX = useRef(position.x);
  const marker = useRef<SVGGElement>(null);

  useLayoutEffect(() => {
    const offset = previousX.current - position.x;
    previousX.current = position.x;
    const ball = marker.current;
    if (!animate || reducedMotion || offset >= 0 || !ball?.animate || document.hidden) return;

    // The outer group already sits at the actual result. Only this decorative offset moves.
    const travel = ball.animate([
      { transform: `translateX(${offset}px)`, easing: 'cubic-bezier(.42, 0, .28, 1)' },
      { transform: 'translateX(0) scale(1.1, .91)', offset: .82, easing: 'ease-out' },
      { transform: 'none' },
    ], { duration: 300 });
    const settle = () => { if (document.hidden) travel.cancel(); };
    document.addEventListener('visibilitychange', settle);
    return () => {
      travel.cancel();
      document.removeEventListener('visibilitychange', settle);
    };
  }, [animate, position.x, reducedMotion]);

  const graphic = (
    <svg className="court-run__graphic" viewBox={`0 0 ${COURT_WIDTH} ${COURT_HEIGHT}`} aria-hidden="true" focusable="false">
      <CourtOutline />
      <path className="court-run__route" d={`M${COURT_START.x} ${COURT_START.y}H${COURT_HOOP.x}`} />
      {checkpoints && <path className="court-run__earned" d={`M${COURT_START.x} ${COURT_START.y}H${position.x}`} />}
      {markers?.map(({ number, x, y, markerY }) => <path className="court-run__stem" key={`stem-${number}`} d={`M${x} ${y}V${markerY}`} />)}
      {/* Same score means same x. Vertical separation keeps every number legible. */}
      {markers?.map(({ number, x, markerY }) => (
        <g className="court-run__checkpoint" key={number}>
          <circle cx={x} cy={markerY} r="8.5" />
          <text x={x} y={markerY} dy=".34em">{number}</text>
        </g>
      ))}
      <g data-court-ball="" transform={`translate(${position.x} ${position.y})`}>
        <g data-court-marker="" ref={marker} className="court-run__ball">
          <circle r={checkpoints ? '9' : '12'} />
          {checkpoints && <path d="M-7.3 0H7.3M0 -7.3V7.3M-5.2 -5.2Q0 0 -5.2 5.2M5.2 -5.2Q0 0 5.2 5.2" />}
        </g>
      </g>
    </svg>
  );

  const score = <p className={`court-run__score${checkpoints ? '' : ' round-total'}`}><strong className="tabular">{total}</strong> of {MAX_TOTAL}</p>;

  if (!checkpoints) {
    return (
      <div className="court-run court-run--compact" data-total={total}>
        <p className="court-run__label">Half-court run</p>
        {graphic}
        {score}
      </div>
    );
  }

  return (
    <section className="court-run court-run--results" aria-labelledby={headingId} data-total={total}>
      <div className="court-run__head">
        <h2 id={headingId} className="court-run__label">Half-court run</h2>
        {score}
      </div>
      <p className="court-run__summary">{percent.format(courtProgress(total))} of the way to the hoop.</p>
      {graphic}
      <ol className="court-run__checkpoints" aria-label="Cumulative score by question" role="list">
        {checkpoints.map(({ number, total: cumulative }) => (
          <li key={number}>
            <span aria-hidden="true">Q{number}</span>
            <span className="sr-only">Question {number}, </span>
            <strong className="tabular">{cumulative}</strong><span className="sr-only"> points</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
