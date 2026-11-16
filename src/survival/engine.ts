import type { Question } from '../content/schema.ts';
import { initGame, type GameState, type RoundRecord } from '../engine/game.ts';
import { need, RULESET, SURVIVAL_ROUNDS } from './rules.ts';

/**
 * One Survival run. The question list is fixed when the run starts and saved
 * with it, so a refresh can never reshuffle it. Results are saved at lock,
 * before the reveal, exactly like the Daily Five.
 */
export type SurvivalRun = {
  /** Random per run; also the seed that picked the questions. */
  readonly id: string;
  readonly ruleset: string;
  /** UTC day the run started (the pool was computed for this day). */
  readonly startedOn: string;
  readonly questionIds: readonly string[];
  readonly results: readonly RoundRecord[];
  /** Rounds the player has moved past (pressed Next on). */
  readonly advanced: number;
};

export type RunStatus = 'playing' | 'lost' | 'won';
export type EndReason = 'miss' | 'short';

/** A round survives only when the answer is inside AND the window earned at least that round's minimum. */
export const survives = (r: RoundRecord, round: number): boolean => r.hit && r.points >= need(round);

export function endReason(r: RoundRecord, round: number): EndReason | null {
  if (survives(r, round)) return null;
  return r.hit ? 'short' : 'miss';
}

export function runStatus(run: SurvivalRun): RunStatus {
  for (const [i, r] of run.results.entries()) if (!survives(r, i)) return 'lost';
  return run.results.length >= SURVIVAL_ROUNDS ? 'won' : 'playing';
}

/** Rounds survived and the points they earned. The round that ended a run banks nothing. */
export function runScore(run: SurvivalRun): { rounds: number; points: number } {
  let rounds = 0;
  let points = 0;
  for (const [i, r] of run.results.entries()) {
    if (!survives(r, i)) break;
    rounds++;
    points += r.points;
  }
  return { rounds, points };
}

export type Best = { readonly ruleset: string; readonly rounds: number; readonly points: number; readonly on: string; readonly runId: string };

/** More rounds wins; equal rounds, more points wins. Only the same ruleset compares. */
export function isBetter(a: { rounds: number; points: number }, b: { rounds: number; points: number } | undefined): boolean {
  if (!b) return true;
  return a.rounds > b.rounds || (a.rounds === b.rounds && a.points > b.points);
}

/** Over when lost or won AND the player has seen the last reveal. */
export function isOver(run: SurvivalRun): boolean {
  return runStatus(run) !== 'playing' && run.advanced >= run.results.length;
}

/** The round on screen: the last locked one while its reveal is unread, else the next to play. */
export function currentRound(run: SurvivalRun): number {
  if (run.results.length > run.advanced) return run.results.length - 1;
  return Math.min(run.results.length, SURVIVAL_ROUNDS - 1);
}

/**
 * The Daily Five state machine for one Survival round. Survival reuses it
 * unchanged (same window rules, same lock, same scoring), one question at a
 * time: the slate here holds only that question.
 */
export function roundState(run: SurvivalRun, q: Question): GameState {
  const round = currentRound(run);
  const rec = run.results[round];
  const slate = { date: run.startedOn, questions: [q] } as unknown as GameState['slate'];
  const saved = rec && rec.questionId === q.id ? [rec] : [];
  return initGame(slate, 'practice', saved, saved.length && run.advanced > round ? 1 : 0);
}

export function newRun(id: string, startedOn: string, questionIds: readonly string[]): SurvivalRun {
  if (questionIds.length !== SURVIVAL_ROUNDS || new Set(questionIds).size !== SURVIVAL_ROUNDS) {
    throw new RangeError(`A run needs ${SURVIVAL_ROUNDS} different questions`);
  }
  return { id, ruleset: RULESET, startedOn, questionIds: [...questionIds], results: [], advanced: 0 };
}

/**
 * Adds a locked round. First lock wins: a round already saved is never
 * replaced, a round out of order is refused, and nothing is added after the
 * run has ended. Returns the run unchanged when the record is not accepted.
 */
export function addResult(run: SurvivalRun, round: number, rec: RoundRecord): SurvivalRun {
  if (round !== run.results.length) return run;
  if (runStatus(run) !== 'playing') return run;
  if (rec.questionId !== run.questionIds[round]) return run;
  return { ...run, results: [...run.results, rec] };
}

export function advance(run: SurvivalRun): SurvivalRun {
  return { ...run, advanced: Math.min(run.results.length, run.advanced + 1) };
}
