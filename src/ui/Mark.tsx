import { SYMBOL } from '../brand/symbol';

/** The symbol: the scoring end of an NBA half court, with the copper ball on its way to the basket. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d={SYMBOL.baseline.d} fill="none" stroke="var(--brand)" strokeWidth={SYMBOL.baseline.width} strokeLinecap="round" />
      <path d={SYMBOL.lane.d} fill="none" stroke="var(--brand)" strokeWidth={SYMBOL.lane.width} strokeLinejoin="round" />
      <path d={SYMBOL.arc.d} fill="none" stroke="var(--brand)" strokeWidth={SYMBOL.arc.width} strokeLinejoin="round" />
      <circle cx={SYMBOL.ball.cx} cy={SYMBOL.ball.cy} r={SYMBOL.ball.r} fill="var(--accent)" />
    </svg>
  );
}
