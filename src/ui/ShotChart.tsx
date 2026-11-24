import { useId, useState } from 'react';
import { COURT_HEIGHT, COURT_WIDTH } from '../engine/court-run';
import { SHOT_MARKER_RADIUS, SHOT_OUTCOME_LABELS, SHOT_UNSUBMITTED_DIVIDER, type ShotAttempt } from '../engine/shot-chart';
import { MAX_TOTAL } from '../engine/summary';
import { CourtOutline } from './CourtRun';
import './shot-chart.css';

function Marker({ outcome, number }: { outcome: ShotAttempt['outcome']; number?: number }) {
  return (
    <g className="shot-marker" data-outcome={outcome}>
      {outcome === 'timeout' ? (
        <rect className="shot-marker-shape" x="-9" y="-9" width="18" height="18" rx="2" />
      ) : outcome === 'zero' ? (
        <path className="shot-marker-shape" d="M0 -12 12 0 0 12 -12 0Z" />
      ) : (
        <circle className="shot-marker-shape" r={SHOT_MARKER_RADIUS} />
      )}
      {number !== undefined && <text className="shot-marker-number" textAnchor="middle" y="4.5">{number}</text>}
    </g>
  );
}

export function ShotChart({ attempts, total }: { attempts: readonly ShotAttempt[]; total: number }) {
  const detailId = useId();
  const [selectedNumber, select] = useState(1);
  const selected = attempts.find((attempt) => attempt.number === selectedNumber) ?? attempts[0];
  const scoring = attempts.filter((attempt) => attempt.earned > 0).length;
  const outcomes = [...new Set(attempts.map((attempt) => attempt.outcome))];
  return (
    <details className="shot-chart">
      <summary>View your shot chart</summary>
      <div className="shot-chart-body">
        <p className="shot-chart-score">
          <strong className="tabular">{total}/{MAX_TOTAL} points</strong>
          <span>{scoring} scoring {scoring === 1 ? 'window' : 'windows'}</span>
        </p>
        <p className="shot-chart-caption">Farther from the basket means more potential points.</p>
        <svg className="shot-chart-court" viewBox={`0 0 ${COURT_WIDTH} ${COURT_HEIGHT}`} aria-hidden="true" focusable="false">
          <CourtOutline />
          {attempts.some(({ potential }) => potential === null) && (
            <path className="shot-chart-divider" d={`M${SHOT_UNSUBMITTED_DIVIDER} 26V154`} />
          )}
          {attempts.map(({ number, outcome, x, y }) => (
            <g key={number} transform={`translate(${x} ${y})`} data-selected={number === selected?.number || undefined}>
              <Marker outcome={outcome} number={number} />
            </g>
          ))}
        </svg>
        <ul className="shot-chart-key" role="list" aria-label="Shot chart key">
          {outcomes.map((outcome) => (
            <li key={outcome}>
              <svg width="15" height="15" viewBox="-13 -13 26 26" aria-hidden="true" focusable="false">
                <Marker outcome={outcome} />
              </svg>
              {SHOT_OUTCOME_LABELS[outcome]}
            </li>
          ))}
        </ul>
        <div className="shot-chart-questions" role="group" aria-label="Inspect a shot">
          {attempts.map(({ number }) => (
            <button
              key={number}
              type="button"
              aria-controls={detailId}
              aria-pressed={number === selected?.number}
              onClick={() => select(number)}
            >
              Q{number}
            </button>
          ))}
        </div>
        <p id={detailId} className="shot-chart-detail tabular" aria-live="polite" aria-atomic="true">
          {selected && <>
            Question {selected.number} · {SHOT_OUTCOME_LABELS[selected.outcome]} ·{' '}
            {selected.potential !== null ? `${selected.potential} points possible` : selected.outcome === 'timeout' ? 'No window submitted' : 'Potential points unavailable'}
            {' · '}{selected.earned} points earned
          </>}
        </p>
      </div>
    </details>
  );
}
