import type { StorageLike } from '../engine/storage.ts';
import { addDays } from '../engine/daily.ts';

/**
 * One experiment: after today's Daily Five, does a quiet "Try Survival" button
 * change next-day Daily Five participation? Spec: docs/SURVIVAL.md.
 *
 * Each browser gets an arm once, at random, kept in localStorage. Everyone gets
 * the same daily questions; only the results screen differs. The arm is a path
 * segment on a handful of extra events (`/e/x/survival-cta/{arm}/…`).
 */
export type Arm = 'cta' | 'control';
export const EXPERIMENT_KEY = 'stat-window:x:survival-cta:v1';

type Saved = { arm: Arm; lastExposed?: string };

function read(storage: StorageLike | null): Saved | null {
  if (!storage) return null;
  try {
    const v = JSON.parse(storage.getItem(EXPERIMENT_KEY) ?? 'null') as Saved | null;
    return v && (v.arm === 'cta' || v.arm === 'control') ? v : null;
  } catch {
    return null;
  }
}

function write(storage: StorageLike, v: Saved): boolean {
  try {
    storage.setItem(EXPERIMENT_KEY, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

/**
 * The browser's arm, assigning one if needed. Null when the experiment is not
 * running or the browser can't remember an arm (it then sees the control
 * screen and sends no experiment events).
 */
export function armFor(storage: StorageLike | null, running: boolean, rand: () => number = Math.random): Arm | null {
  if (!running || !storage) return null;
  const saved = read(storage);
  if (saved) return saved.arm;
  const arm: Arm = rand() < 0.5 ? 'cta' : 'control';
  return write(storage, { arm }) ? arm : null;
}

/** Records that today's results screen was seen; returns true the first time per day. */
export function markExposed(storage: StorageLike | null, today: string): boolean {
  const saved = read(storage);
  if (!storage || !saved || saved.lastExposed === today) return false;
  return write(storage, { ...saved, lastExposed: today });
}

/** True when this browser saw the results screen yesterday: today's daily start is a next-day return. */
export function exposedYesterday(storage: StorageLike | null, today: string): boolean {
  return read(storage)?.lastExposed === addDays(today, -1);
}
