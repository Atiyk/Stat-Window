import { stepDecimals } from '../engine/scoring';

export function formatValue(value: number, step: number): string {
  const d = stepDecimals(step);
  return value.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** “1 point”, “2 points”: a count with its noun in the right number. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function unitFor(value: number, unit: { singular: string; plural: string }): string {
  return value === 1 ? unit.singular : unit.plural;
}

export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

/** Nice label spacing (1, 2, 2.5, 5 × 10^k) giving roughly `target` labels across the range. */
export function niceTicks(min: number, max: number, target: number): { major: number[]; minor: number[] } {
  const span = max - min;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const mult = [1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10;
  const majorStep = mult * pow;
  const minorStep = majorStep / (mult === 2.5 ? 5 : mult === 2 ? 4 : 5);
  const round = (n: number) => Number(n.toFixed(6));
  const major: number[] = [];
  const minor: number[] = [];
  for (let v = Math.ceil(min / majorStep) * majorStep; v <= max + 1e-9; v += majorStep) major.push(round(v));
  for (let v = Math.ceil(min / minorStep) * minorStep; v <= max + 1e-9; v += minorStep) {
    const r = round(v);
    if (!major.some((m) => Math.abs(m - r) < minorStep / 10)) minor.push(r);
  }
  // Label the scale's own ends when the nearest round value is too far away to read them off.
  const gap = majorStep * 0.45;
  if (!major.some((m) => Math.abs(m - min) < gap)) major.unshift(round(min));
  if (!major.some((m) => Math.abs(m - max) < gap)) major.push(round(max));
  return { major, minor: minor.filter((t) => !major.includes(t)) };
}
