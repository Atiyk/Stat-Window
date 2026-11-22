import type { Question, Slate } from '../content/schema';
import { fromSteps, rangeSteps, scoreWindow, toSteps, type Scale, type Window } from './scoring';

export type Mode = 'daily' | 'practice';

export type RoundRecord = {
  readonly questionId: string;
  readonly lo: number;
  readonly hi: number;
  readonly hit: boolean;
  readonly points: number;
  readonly missBy: number;
  /** Active seconds spent answering; absent for legacy pre-shot-clock scores. */
  readonly elapsedMs?: number;
  /** The buzzer expired; a timed-out window always earns zero. */
  readonly timedOut?: boolean;
};

/**
 * ready      round shown, window untouched (full range, worth 0)
 * adjusting  player has moved the window
 * locked     score is computed and saved; nothing can change it now
 * revealing  the answer is landing on screen
 * resolved   the round's outcome and explanation are shown
 * complete   all five rounds are scored
 */
export type Phase = 'ready' | 'adjusting' | 'locked' | 'revealing' | 'resolved' | 'complete';

export type GameState = {
  readonly phase: Phase;
  readonly mode: Mode;
  readonly slate: Slate;
  readonly round: number;
  readonly window: Window;
  readonly results: readonly RoundRecord[];
};

export type GameAction =
  | { type: 'setWindow'; window: Window; moving?: 'lo' | 'hi' }
  | { type: 'lock'; elapsedMs?: number }
  | { type: 'timeout'; elapsedMs: number }
  | { type: 'reveal' }
  | { type: 'settle' }
  | { type: 'next' }
  /** Replace the whole state, e.g. when another tab saved progress for the same day. */
  | { type: 'hydrate'; state: GameState };

export const ROUNDS = 5;

export function fullWindow(scale: Scale): Window {
  return { lo: scale.min, hi: scale.max };
}

/** Snap to the step grid, clamp to the scale and keep the window at least one step wide. */
export function normalizeWindow(scale: Scale, w: Window, moving?: 'lo' | 'hi'): Window {
  const max = rangeSteps(scale);
  const clamp = (n: number) => Math.min(max, Math.max(0, n));
  let lo = clamp(toSteps(scale, w.lo));
  let hi = clamp(toSteps(scale, w.hi));
  if (hi - lo < 1) {
    if (moving === 'hi') {
      hi = lo + 1;
      if (hi > max) { hi = max; lo = max - 1; }
    } else {
      lo = hi - 1;
      if (lo < 0) { lo = 0; hi = 1; }
    }
  }
  return { lo: fromSteps(scale, lo), hi: fromSteps(scale, hi) };
}

export function currentQuestion(s: GameState): Question {
  const q = s.slate.questions[Math.min(s.round, ROUNDS - 1)];
  if (!q) throw new Error('Slate has no question for this round');
  return q;
}

export function totalPoints(results: readonly RoundRecord[]): number {
  return results.reduce((sum, r) => sum + r.points, 0);
}

/** Keeps only saved results that match this slate, in order, so a stale save can't corrupt a run. */
function matchingResults(slate: Slate, saved: readonly RoundRecord[]): RoundRecord[] {
  const out: RoundRecord[] = [];
  for (const [i, q] of slate.questions.entries()) {
    const r = saved[i];
    if (!r || r.questionId !== q.id) break;
    out.push(r);
  }
  return out;
}

/**
 * Rebuilds a run from storage. `advanced` is how many rounds the player has
 * moved past; when it trails the saved results, the last locked round is shown
 * again as resolved so a refresh mid-reveal never skips the answer.
 */
export function initGame(
  slate: Slate,
  mode: Mode,
  saved: readonly RoundRecord[],
  advanced: number = saved.length,
): GameState {
  const results = matchingResults(slate, saved);
  const last = results.at(-1);
  if (last && advanced < results.length) {
    return { phase: 'resolved', mode, slate, round: results.length - 1, results, window: { lo: last.lo, hi: last.hi } };
  }
  if (last && results.length >= ROUNDS) {
    return { phase: 'complete', mode, slate, round: ROUNDS - 1, results, window: { lo: last.lo, hi: last.hi } };
  }
  const q = slate.questions[results.length];
  if (!q) throw new Error('Empty slate');
  return { phase: 'ready', mode, slate, round: results.length, results, window: fullWindow(q) };
}

/** The untouched full scale can only score 0, so it can't be locked. */
export function canLock(s: GameState): boolean {
  if (s.phase !== 'ready' && s.phase !== 'adjusting') return false;
  const q = currentQuestion(s);
  return s.window.lo > q.min || s.window.hi < q.max;
}

export function gameReducer(s: GameState, a: GameAction): GameState {
  switch (a.type) {
    case 'setWindow': {
      if (s.phase !== 'ready' && s.phase !== 'adjusting') return s;
      const window = normalizeWindow(currentQuestion(s), a.window, a.moving);
      if (window.lo === s.window.lo && window.hi === s.window.hi && s.phase === 'adjusting') return s;
      return { ...s, phase: 'adjusting', window };
    }
    case 'lock':
    case 'timeout': {
      const expired = a.type === 'timeout';
      if (!expired && !canLock(s)) return s;
      if (expired && s.phase !== 'ready' && s.phase !== 'adjusting') return s;
      const q = currentQuestion(s);
      // A shot-clock violation is a zero-point turnover, even if the user was
      // halfway through setting a window. Full range also independently scores 0.
      const window = expired ? fullWindow(q) : s.window;
      const score = expired ? { hit: false, points: 0, missBy: 0 } : scoreWindow(q, window);
      const record: RoundRecord = {
        questionId: q.id, lo: window.lo, hi: window.hi, ...score,
        ...(typeof a.elapsedMs === 'number' ? { elapsedMs: Math.max(0, Math.min(24_000, Math.round(a.elapsedMs))) } : {}),
        ...(expired ? { timedOut: true } : {}),
      };
      return { ...s, phase: 'locked', results: [...s.results, record] };
    }
    case 'reveal':
      return s.phase === 'locked' ? { ...s, phase: 'revealing' } : s;
    case 'settle':
      return s.phase === 'locked' || s.phase === 'revealing' ? { ...s, phase: 'resolved' } : s;
    case 'hydrate':
      return a.state;
    case 'next': {
      if (s.phase !== 'resolved') return s;
      if (s.results.length >= ROUNDS) return { ...s, phase: 'complete' };
      const round = s.round + 1;
      const q = s.slate.questions[round];
      if (!q) return { ...s, phase: 'complete' };
      return { ...s, phase: 'ready', round, window: fullWindow(q) };
    }
  }
}
