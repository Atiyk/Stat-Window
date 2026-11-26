import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { FULL_COURT_VIEW } from '../engine/court';
import {
  CHECKPOINT_RADIUS, COURT_END, COURT_START, courtCheckpointMarker, courtLandmarks, courtPosition, type CourtCheckpoint,
} from '../engine/court-run';
import { SHOT_MARKER_RADIUS, SHOT_OUTCOME_LABELS, SHOT_UNSUBMITTED_DIVIDER, SHOT_UNSUBMITTED_SPAN, type ShotAttempt } from '../engine/shot-chart';
import { Ball, CourtSvg } from './CourtRun';
import { plural } from '../lib/format';
import './performance-recap.css';

export function ShotMarker({ outcome, number }: { outcome: ShotAttempt['outcome']; number?: number }) {
  const r = SHOT_MARKER_RADIUS;
  return (
    <g className="shot-marker" data-outcome={outcome}>
      {outcome === 'timeout' || outcome === 'unavailable' ? (
        <rect className="shot-marker-shape" x={-r * .9} y={-r * .9} width={r * 1.8} height={r * 1.8} rx=".25" />
      ) : outcome === 'zero' ? (
        <path className="shot-marker-shape" d={`M0 ${-r * 1.2} ${r * 1.2} 0 0 ${r * 1.2} ${-r * 1.2} 0Z`} />
      ) : (
        <circle className="shot-marker-shape" r={r} />
      )}
      {number !== undefined && <text className="shot-marker-number" textAnchor="middle" dy=".36em">{number}</text>}
    </g>
  );
}

function ShotChartCourt({ attempts }: { attempts: readonly ShotAttempt[] }) {
  return (
    <CourtSvg view={FULL_COURT_VIEW} className="performance-court">
      {attempts.some(({ potential }) => potential === null) && (
        <path className="shot-chart-divider" d={`M${SHOT_UNSUBMITTED_DIVIDER} ${SHOT_UNSUBMITTED_SPAN[0]}V${SHOT_UNSUBMITTED_SPAN[1]}`} />
      )}
      {attempts.map(({ number, outcome, x, y }) => (
        <g key={number} transform={`translate(${x} ${y})`} data-shot={number}>
          <ShotMarker outcome={outcome} number={number} />
        </g>
      ))}
    </CourtSvg>
  );
}

function CourtRunCourt({ total, checkpoints }: { total: number; checkpoints: readonly CourtCheckpoint[] }) {
  const end = courtPosition(total);
  const start = COURT_START;
  return (
    <CourtSvg view={FULL_COURT_VIEW} className="performance-court">
      <path className="court-route" d={`M${start.x} ${start.y}H${COURT_END.x}`} />
      {total > 0 && <path className="court-trail" d={`M${start.x} ${start.y}H${end.x}`} />}
      {checkpoints.map((checkpoint) => {
        const label = courtCheckpointMarker(checkpoint);
        return <path key={checkpoint.number} className="court-checkpoint-stem" d={`M${checkpoint.x} ${checkpoint.y}L${label.x} ${label.y}`} />;
      })}
      {checkpoints.map((checkpoint) => {
        const label = courtCheckpointMarker(checkpoint);
        return (
          <g key={checkpoint.number} className="court-checkpoint" data-checkpoint={checkpoint.number}>
            <circle cx={label.x} cy={label.y} r={CHECKPOINT_RADIUS} />
            <text x={label.x} y={label.y} dy=".36em" textAnchor="middle">{checkpoint.number}</text>
          </g>
        );
      })}
      <g data-court-ball="" transform={`translate(${end.x} ${end.y})`}><Ball /></g>
    </CourtSvg>
  );
}

const toNext = (points: number, name: string) => `${plural(points, 'more point', 'more points')} ${points === 1 ? 'reaches' : 'reach'} ${name}.`;

/** One true sentence about where the points carried the ball, by real court features. */
export function courtRunLine(total: number): string {
  const { reached, next } = courtLandmarks(total);
  return total === 0
    ? 'The ball is still at half court.'
    : reached?.name === 'the rim'
      ? 'All the way to the rim. A perfect game.'
      : reached
        ? `Inside ${reached.name}${next ? `. ${toNext(next.at - total, next.name)}` : '.'}`
        : toNext(next!.at - total, next!.name);
}

const VIEWS = [
  { value: 'shots', label: 'Shot chart' },
  { value: 'run', label: 'Court run' },
] as const;
type View = (typeof VIEWS)[number]['value'];

/** One court, two readings of the same game: how boldly each window was set, and how far the points carried. */
export function PerformanceRecap({ attempts, checkpoints, total }: {
  attempts: readonly ShotAttempt[];
  checkpoints: readonly CourtCheckpoint[];
  total: number;
}) {
  const id = useId();
  const [view, setView] = useState<View>('shots');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const runLine = courtRunLine(total);
  const outcomes = [...new Set(attempts.map(({ outcome }) => outcome))];

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = VIEWS.findIndex(({ value }) => value === view);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? VIEWS.length - 1 : step ? (index + step + VIEWS.length) % VIEWS.length : -1;
    if (target < 0) return;
    event.preventDefault();
    setView(VIEWS[target]!.value);
    tabs.current[target]?.focus();
  };

  return (
    <section className="performance" aria-label="Your game on the court" data-view={view}>
      <div className="performance-tabs" role="tablist" aria-label="Court view" onKeyDown={onKey}>
        {VIEWS.map(({ value, label }, index) => (
          <button
            key={value}
            ref={(node) => { tabs.current[index] = node; }}
            type="button"
            role="tab"
            id={`${id}-${value}-tab`}
            aria-selected={view === value}
            aria-controls={`${id}-panel`}
            tabIndex={view === value ? 0 : -1}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${view}-tab`} className="performance-panel" tabIndex={0}>
        {view === 'shots' ? (
          <>
            <p className="performance-caption">Each circle is a question. Farther from the basket means a tighter, bolder window.</p>
            <ShotChartCourt attempts={attempts} />
            <ol className="performance-rounds" aria-label="Each shot" role="list">
              {attempts.map(({ number, outcome, potential }) => (
                <li key={number} data-outcome={outcome}>
                  <span className="performance-q">Q{number}</span>
                  <strong className="tabular">{potential ?? '–'}</strong>
                  <span className="performance-note">{SHOT_OUTCOME_LABELS[outcome]}</span>
                  <span className="sr-only">{potential !== null ? `, window worth ${potential} points` : ''}</span>
                </li>
              ))}
            </ol>
            <ul className="performance-key" role="list" aria-label="Shot chart key">
              {outcomes.map((outcome) => (
                <li key={outcome}>
                  <svg width="16" height="16" viewBox="-1.9 -1.9 3.8 3.8" aria-hidden="true" focusable="false">
                    <ShotMarker outcome={outcome} />
                  </svg>
                  {SHOT_OUTCOME_LABELS[outcome]}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="performance-caption">{runLine}</p>
            <CourtRunCourt total={total} checkpoints={checkpoints} />
            <p className="performance-q performance-rounds-label" aria-hidden="true">Running total</p>
            <ol className="performance-rounds" aria-label="Cumulative score by question" role="list">
              {checkpoints.map(({ number, total: cumulative }) => (
                <li key={number}>
                  <span className="performance-q" aria-hidden="true">Q{number}</span>
                  <span className="sr-only">Question {number}, </span>
                  <strong className="tabular">{cumulative}</strong><span className="sr-only"> points</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
