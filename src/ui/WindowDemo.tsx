import type { CSSProperties } from 'react';
import { potentialPoints } from '../engine/scoring';
import './window-demo.css';

/** An illustrative 0–100 scale, scored by the game's own formula, so the two numbers are honest. */
const SCALE = { min: 0, max: 100, step: 1 } as const;
const ANSWER = 66;
const ROWS = [
  { name: 'Wide', lo: 20, hi: 80 },
  { name: 'Tight', lo: 60, hi: 72 },
] as const;

/**
 * The mechanic in one glance, with no reading required: the same answer caught by a wide
 * window and by a tight one, and what each would score. It is a picture of the rules,
 * not a question, so it gives nothing away. The tight row's brackets close in once on
 * arrival (transform only; reduced motion shows the final frame).
 */
export function WindowDemo({ className = '' }: { className?: string }) {
  const rows = ROWS.map((r) => ({ ...r, points: potentialPoints(SCALE, r) }));
  const [wide, tight] = rows;
  return (
    <figure className={`window-demo ${className}`}>
      <div className="window-demo__rows" aria-hidden="true">
        {rows.map((r, i) => (
          <div key={r.name} className="window-demo__row" data-row={i === 0 ? 'wide' : 'tight'}>
            <span className="window-demo__name">{r.name}</span>
            <span className="window-demo__track" style={{ '--lo': r.lo, '--hi': r.hi, '--from-lo': ROWS[0].lo, '--from-hi': ROWS[0].hi, '--answer': ANSWER } as CSSProperties}>
              <span className="window-demo__band" />
              <span className="window-demo__edge window-demo__edge--lo"><span /></span>
              <span className="window-demo__edge window-demo__edge--hi"><span /></span>
              <span className="window-demo__ball"><span /></span>
            </span>
            <span className="window-demo__points tabular">+{r.points}</span>
          </div>
        ))}
      </div>
      <figcaption className="sr-only">
        Both windows catch the same answer. The wide window earns {wide!.points} points and the tight one earns {tight!.points}.
      </figcaption>
    </figure>
  );
}
