import type { Question } from '../content/schema';
import type { Window } from '../engine/scoring';
import { chartUnitLabel, formatObserved, formatValue } from '../lib/format';
import './question-chart.css';

/**
 * A missing-point question's verified observations, drawn as plain columns from a
 * zero baseline. The hidden column is an empty dashed slot: its height is never drawn
 * before the lock, and the scale comes from the bracket range (question.max), not from
 * the answer, so nothing about the chart's geometry gives the number away.
 *
 * The player's window is projected onto the empty slot as a band, straight from props,
 * so it follows the brackets with no easing. On reveal the hidden column grows with the
 * ruler marker's own progress: one motion shown in two places, not a second animation.
 */
export function QuestionChart({ question, window, reveal }: {
  question: Question;
  window: Window | null;
  /** Ruler reveal progress 0..1, or null before the answer starts to land. */
  reveal: number | null;
}) {
  const chart = question.chart;
  if (!chart) return null;
  const top = question.max;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  const shown = (v: number) => formatValue(v, question.step);
  // Known bars are verified facts: shown at their own precision, never rounded to the step.
  const observed = (v: number) => formatObserved(v, question.step);
  const revealed = reveal === 1;
  const unit = chartUnitLabel(chart.title, chart.unit);
  // Text equivalent: every known bar's value; the hidden one only once the answer has landed.
  const hiddenValue = revealed ? shown(question.answer) : window ? 'hidden, your estimate' : 'hidden';
  const spoken = chart.points
    .map((p) => `${p.label}: ${p.value === null ? hiddenValue : observed(p.value)}`)
    .join('. ');

  return (
    <figure className="q-chart" data-revealing={reveal !== null || undefined} data-revealed={revealed || undefined}>
      <figcaption className="q-chart__title">
        {chart.title}{unit && <> <span className="q-chart__unit">({unit})</span></>}
      </figcaption>
      <p className="sr-only">Bars start at 0. {spoken}.</p>
      <ol className="q-chart__cols" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${chart.points.length}, minmax(0, 1fr))` }}>
        {chart.points.map((p) => {
          const hidden = p.value === null;
          return (
            <li key={p.label} className="q-chart__col" data-hidden={hidden || undefined}>
              <span className="q-chart__value tabular">
                {hidden ? (revealed ? <span className="q-chart__answer">{shown(question.answer)}</span> : '?') : observed(p.value!)}
              </span>
              <span className="q-chart__plot">
                {hidden ? (
                  <>
                    {/* Full height on purpose: the slot says "somewhere on this scale", never a height. */}
                    <span className="q-chart__slot" />
                    {window && (
                      <span className="q-chart__band" style={{ bottom: pct(window.lo), height: `calc(${pct(window.hi)} - ${pct(window.lo)})` }} />
                    )}
                    {reveal !== null && (
                      // Mounted only after the lock; scaleY rides the ruler's own reveal progress.
                      <span className="q-chart__bar q-chart__bar--answer" style={{ height: pct(question.answer), transform: `scaleY(${reveal})` }} />
                    )}
                  </>
                ) : (
                  <span className="q-chart__bar" style={{ height: pct(p.value!) }} />
                )}
              </span>
              <span className="q-chart__label">{p.label}</span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}
