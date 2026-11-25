import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { COURT_LINES, laneView, PAINT, viewBox, type CourtView } from '../engine/court';
import { COURT_END, COURT_START, courtPosition } from '../engine/court-run';
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
      <rect className="court-paint" x={PAINT.x} y={PAINT.y} width={PAINT.width} height={PAINT.height} />
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

type Fate = { key: number; x: number; kind: 'merge' | 'miss'; ms: number } | null;

/** The answer lands first; the ball sets off a beat later, so one thing moves at a time. */
export const COURT_TRAVEL_DELAY_MS = 150;
export const courtTravelMs = (fromX: number, toX: number) => Math.round(380 + Math.min(1, (toX - fromX) / 8.35) * 160);
const X_EASE = 'cubic-bezier(.45, 0, .25, 1)';

/**
 * The live Court Run: the solid ball is points already awarded; the outlined ball is
 * where the current window would take it if the answer is inside. Positions come
 * straight from props, so the outline tracks the brackets with no easing or lag.
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
  const hop = useRef<SVGGElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const previous = useRef({ earned, potential });
  const [fate, setFate] = useState<Fate>(null);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { earned, potential };
    if (before.earned === earned && before.potential === potential) return;
    const lastGhost = before.potential;
    const motion = animate && !reduced && !document.hidden;
    const from = courtPosition(before.earned).x;
    const to = courtPosition(earned).x;
    const duration = courtTravelMs(from, to);
    if (!motion || lastGhost === null || potential !== null) {
      setFate(null);
    } else {
      // The preview resolves: the ball fills its outline on a hit; on a miss it clears.
      setFate({
        key: Date.now(),
        x: courtPosition(lastGhost).x,
        kind: earned > before.earned ? 'merge' : 'miss',
        ms: COURT_TRAVEL_DELAY_MS + duration,
      });
    }

    const node = marker.current;
    if (!motion || to <= from || !node?.animate) return;
    const offset = from - to;
    const timing = { duration, delay: COURT_TRAVEL_DELAY_MS, fill: 'backwards' } as const;
    // Pose to pose. Horizontal travel is one smooth curve with a small gather; the
    // hop and the landing squash ride on an inner group, peaking mid-flight.
    // The outer group already sits at the true total; only these offsets animate.
    const travel = node.animate([
      { transform: `translateX(${offset}px)`, easing: 'cubic-bezier(.3, 0, .6, 1)' },
      { transform: `translateX(${offset - .35}px)`, offset: .12, easing: X_EASE },
      { transform: 'translateX(0)' },
    ], timing);
    const lift = hop.current?.animate?.([
      { transform: 'none', easing: 'cubic-bezier(.33, 0, .2, 1)' },
      { transform: 'translateY(.12px) scale(1.04, .96)', offset: .12, easing: 'cubic-bezier(.2, .6, .35, 1)' },
      { transform: 'translateY(-1.3px)', offset: .5, easing: 'cubic-bezier(.6, 0, .8, .4)' },
      { transform: 'scale(1.12, .88)', offset: .86, easing: 'cubic-bezier(.2, .7, .3, 1)' },
      { transform: 'none' },
    ], timing);
    // The earned line grows with the ball, on the same horizontal curve.
    const grow = trail.current?.animate?.(from > 0
      ? [{ transform: `scaleX(${from / to})`, easing: 'cubic-bezier(.3, 0, .6, 1)' }, { transform: `scaleX(${(from - .35) / to})`, offset: .12, easing: X_EASE }, { transform: 'none' }]
      : [{ transform: 'scaleX(0)', easing: X_EASE }, { transform: 'none' }], timing);
    const all = [travel, lift, grow];
    const settle = () => { if (document.hidden) all.forEach((a) => a?.finish()); };
    document.addEventListener('visibilitychange', settle);
    return () => {
      all.forEach((a) => a?.cancel());
      document.removeEventListener('visibilitychange', settle);
    };
  }, [earned, potential, animate, reduced]);

  return (
    <div className="live-court" data-total={earned} data-potential={ghost ? potential : undefined}>
      <CourtSvg view={LIVE_VIEW} className="live-court__court" crop>
        <path className="court-route" d={`M${COURT_START.x} ${ball.y}H${COURT_END.x}`} />
        {earned > 0 && <path ref={trail} className="court-trail" d={`M${COURT_START.x} ${ball.y}H${ball.x}`} />}
        {ghost && <path className="court-trail court-trail--ghost" d={`M${ball.x} ${ball.y}H${ghost.x}`} />}
        {recordAt && (
          // Below the route only, so it never crosses the outlined ball or its label.
          <g className="court-record" transform={`translate(${recordAt.x} ${recordAt.y})`} data-court-record="">
            <path d="M0 1.45V3.3" />
            <path className="court-record__flag" d="M0 3.3H1.7L1.15 2.75 1.7 2.2H0Z" />
          </g>
        )}
        <g data-court-ball="" transform={`translate(${ball.x} ${ball.y})`}>
          <g ref={marker} className="court-ball-motion" data-court-marker="">
            <g ref={hop} className="court-ball-motion">
              <Ball />
            </g>
          </g>
        </g>
        {fate && (
          <g key={fate.key} transform={`translate(${fate.x} ${ball.y})`}>
            <g className="court-fate" data-fate={fate.kind} style={{ animationDuration: `${fate.kind === 'merge' ? fate.ms : 180}ms` }} onAnimationEnd={() => setFate(null)}>
              <Ball ghost />
            </g>
          </g>
        )}
        {ghost && (
          // Drawn over the ball: when the two overlap, the dashed outline stays visible.
          <g className="court-ghost" data-court-ghost="" transform={`translate(${ghost.x} ${ghost.y})`}>
            <Ball ghost />
          </g>
        )}
      </CourtSvg>
      {ghost && (
        <span className="live-court__tag" data-anchor={anchor(ghost.x)} style={{ left: percentX(ghost.x) }} aria-hidden="true">
          <b className="tabular">{potential}</b> if inside{record !== null && potential! >= record ? ' · new best' : ''}
        </span>
      )}
    </div>
  );
}
