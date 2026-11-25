import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { COURT_LINES, laneView, viewBox, type CourtView } from '../engine/court';
import { courtPosition } from '../engine/court-run';
import { MAX_TOTAL } from '../engine/summary';
import { usePrefersReducedMotion } from './hooks';
import './court.css';

/** The NBA half court in feet. Parents choose the crop; the scale is always uniform. */
export function CourtSvg({ view, className, children, crop = false }: { view: CourtView; className?: string; children?: ReactNode; crop?: boolean }) {
  // `slice` lets CSS trim the strip's height on short screens; both keep one uniform scale.
  const fit = crop ? 'xMidYMid slice' : 'xMidYMid meet';
  return (
    <svg className={className} viewBox={viewBox(view)} preserveAspectRatio={fit} aria-hidden="true" focusable="false">
      <CourtLines />
      {children}
    </svg>
  );
}

export function CourtLines() {
  return (
    <g className="court-lines">
      <rect className="court-paint" x="28" y="17" width="19" height="16" />
      {COURT_LINES.map(({ d, kind }) => <path key={d} d={d} data-kind={kind} />)}
    </g>
  );
}

/** Ball radius in feet: legible at game size, small enough to sit on the route. */
export const BALL_RADIUS = 1.15;

export function Ball({ ghost = false }: { ghost?: boolean }) {
  return ghost ? (
    <circle className="court-ball court-ball--ghost" r={BALL_RADIUS} />
  ) : (
    <g className="court-ball">
      <circle r={BALL_RADIUS} />
      <path d="M-1.15 0H1.15M0 -1.15V1.15M-.8 -.82Q-.25 0 -.8 .82M.8 -.82Q.25 0 .8 .82" />
    </g>
  );
}

const STRIP_DEPTH = 9;
export const LIVE_VIEW = laneView(STRIP_DEPTH);
const percentX = (x: number) => `${((x - LIVE_VIEW.x) / LIVE_VIEW.width) * 100}%`;
/** Labels centre on their ball, but stay inside the strip near either end. */
const anchor = (x: number) => x < 6 ? 'start' : x > 38 ? 'end' : 'center';

type Fate = { key: number; x: number; kind: 'merge' | 'miss' } | null;

/**
 * Prototype A: the solid ball is points already awarded; the outlined ball is where the
 * current window would take it if the answer is inside. Positions come straight from
 * props, so the outline tracks the brackets with no easing or lag.
 */
export function LiveCourtRun({ earned, potential, record = null, animate = false }: {
  earned: number;
  potential: number | null;
  /** The total that would beat the verified personal best, when it is in reach this round. */
  record?: number | null;
  /** True only for a result that just landed in this tab: never on restore or adoption. */
  animate?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const ball = courtPosition(earned);
  const ghost = potential !== null && potential > earned ? courtPosition(potential) : null;
  const recordAt = record !== null ? courtPosition(record) : null;
  const marker = useRef<SVGGElement>(null);
  const previous = useRef({ earned, potential });
  const [fate, setFate] = useState<Fate>(null);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { earned, potential };
    if (before.earned === earned && before.potential === potential) return;
    const lastGhost = before.potential;
    const motion = animate && !reduced && !document.hidden;
    if (!motion || lastGhost === null || potential !== null) {
      setFate(null);
    } else {
      // The preview resolves: it joins the ball on a hit, or clears on a miss.
      setFate({ key: Date.now(), x: courtPosition(lastGhost).x, kind: earned > before.earned ? 'merge' : 'miss' });
    }

    const from = courtPosition(before.earned).x;
    const to = courtPosition(earned).x;
    const node = marker.current;
    if (!motion || to <= from || !node?.animate) return;
    const offset = from - to;
    // Pose to pose: a small gather, a low arc, a squash on landing, then rest.
    // The group itself already sits at the true total; only this offset animates.
    const travel = node.animate([
      { transform: `translate(${offset}px, 0)`, easing: 'cubic-bezier(.3, 0, .6, 1)' },
      { transform: `translate(${offset - .35}px, 0) scale(1.04, .96)`, offset: .12, easing: 'cubic-bezier(.33, 0, .2, 1)' },
      { transform: `translate(${offset * .45}px, -1.3px)`, offset: .55, easing: 'cubic-bezier(.4, 0, .7, .6)' },
      { transform: 'translate(0, 0) scale(1.12, .88)', offset: .86, easing: 'cubic-bezier(.2, .7, .3, 1)' },
      { transform: 'none' },
    ], { duration: Math.round(380 + Math.min(1, (to - from) / 8.35) * 160) });
    const settle = () => { if (document.hidden) travel.finish(); };
    document.addEventListener('visibilitychange', settle);
    return () => {
      travel.cancel();
      document.removeEventListener('visibilitychange', settle);
    };
  }, [earned, potential, animate, reduced]);

  return (
    <div className="live-court" data-total={earned} data-potential={ghost ? potential : undefined}>
      <CourtSvg view={LIVE_VIEW} className="live-court__court" crop>
        <path className="court-route" d={`M${courtPosition(0).x} ${ball.y}H${courtPosition(MAX_TOTAL).x}`} />
        {earned > 0 && <path className="court-trail" d={`M${courtPosition(0).x} ${ball.y}H${ball.x}`} />}
        {ghost && <path className="court-trail court-trail--ghost" d={`M${ball.x} ${ball.y}H${ghost.x}`} />}
        {recordAt && (
          <g className="court-record" transform={`translate(${recordAt.x} ${recordAt.y})`} data-court-record="">
            <path d="M0 -3.2V3.4" />
            <path className="court-record__flag" d="M0 3.4H2L1.35 2.7 2 2H0Z" />
          </g>
        )}
        {fate && (
          <g key={fate.key} className="court-fate" data-fate={fate.kind} transform={`translate(${fate.x} ${ball.y})`} onAnimationEnd={() => setFate(null)}>
            <Ball ghost />
          </g>
        )}
        {ghost && (
          <g className="court-ghost" data-court-ghost="" transform={`translate(${ghost.x} ${ghost.y})`}>
            <Ball ghost />
          </g>
        )}
        <g data-court-ball="" transform={`translate(${ball.x} ${ball.y})`}>
          <g ref={marker} className="court-ball-motion" data-court-marker="">
            <Ball />
          </g>
        </g>
      </CourtSvg>
      {ghost && (
        <span className="live-court__tag" data-anchor={anchor(ghost.x)} style={{ left: percentX(ghost.x) }} aria-hidden="true">
          <b className="tabular">{potential}</b> if inside
        </span>
      )}
    </div>
  );
}
