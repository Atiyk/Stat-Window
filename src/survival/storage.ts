import * as z from 'zod/mini';
import type { StorageLike } from '../engine/storage.ts';
import { addResult, advance, isBetter, isOver, runScore, runStatus, type Best, type SurvivalRun } from './engine.ts';
import { RECENT_RUNS, SURVIVAL_ROUNDS } from './rules.ts';
import type { RoundRecord } from '../engine/game.ts';

/**
 * Survival's own save, apart from the Daily Five save (stat-window:v1), so
 * nothing here can touch daily runs, practice runs, stats or streaks. Validated
 * on read; an unreadable value is set aside under `<key>:corrupt`.
 */
export const SURVIVAL_KEY = 'stat-window:survival:v1';
/** Preview builds that simulate a later date keep their runs apart from real ones. */
export const SURVIVAL_PREVIEW_KEY = 'stat-window:survival-preview:v1';

const Day = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));
const Record_ = z.object({
  questionId: z.string(),
  lo: z.number(),
  hi: z.number(),
  hit: z.boolean(),
  points: z.int().check(z.minimum(0), z.maximum(100)),
  missBy: z.number().check(z.minimum(0)),
});
const Run = z.object({
  id: z.string().check(z.regex(/^[0-9a-f]{8}$/)),
  ruleset: z.string(),
  startedOn: Day,
  questionIds: z.array(z.string()).check(z.length(SURVIVAL_ROUNDS)),
  results: z.array(Record_).check(z.maxLength(SURVIVAL_ROUNDS)),
  advanced: z.int().check(z.minimum(0), z.maximum(SURVIVAL_ROUNDS)),
});
const BestSchema = z.object({ ruleset: z.string(), rounds: z.int(), points: z.int(), on: Day, runId: z.string() });
const Save = z.object({
  version: z.literal(1),
  current: z.nullable(Run),
  /** Personal best per ruleset. */
  best: z.record(z.string(), BestSchema),
  /** Question ids of the last few runs, newest first, to avoid repeats. */
  recent: z.array(z.array(z.string())),
  /** Runs started in this browser. */
  started: z.int().check(z.minimum(0)),
});
export type SurvivalSave = Omit<z.infer<typeof Save>, 'current'> & { current: SurvivalRun | null };

export const emptySurvival = (): SurvivalSave => ({ version: 1, current: null, best: {}, recent: [], started: 0 });

/** A saved run must be internally consistent too: its results match its questions, in order. */
function consistent(run: SurvivalRun): boolean {
  if (new Set(run.questionIds).size !== run.questionIds.length) return false;
  if (run.advanced > run.results.length) return false;
  return run.results.every((r, i) => r.questionId === run.questionIds[i]);
}

export type SurvivalStore = {
  readonly persistent: boolean;
  load(): SurvivalSave;
  /** Starts a run, replacing a finished one. Refuses (returns the existing run) while one is still in play. */
  start(run: SurvivalRun): SurvivalRun;
  /** Saves a locked round. First lock wins; returns the stored run, or null when that run is no longer current. */
  lock(runId: string, round: number, rec: RoundRecord): SurvivalRun | null;
  /** Marks a reveal as read. Records a personal best when the run is over. */
  advance(runId: string): SurvivalRun | null;
  /** Drops a run whose questions can no longer be found (content changed). */
  discard(runId: string): void;
};

export function createSurvivalStore(storage: StorageLike | null, key = SURVIVAL_KEY): SurvivalStore {
  let memory = emptySurvival();
  let persistent = storage !== null;

  function read(): SurvivalSave {
    if (!storage || !persistent) return memory;
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      persistent = false;
      return memory;
    }
    if (raw === null) return emptySurvival();
    try {
      const parsed = Save.safeParse(JSON.parse(raw));
      if (parsed.success && (!parsed.data.current || consistent(parsed.data.current))) return parsed.data as SurvivalSave;
    } catch {
      /* fall through */
    }
    try {
      storage.setItem(`${key}:corrupt`, raw);
      storage.setItem(key, JSON.stringify(emptySurvival()));
    } catch {
      /* ignore */
    }
    return emptySurvival();
  }

  function write(data: SurvivalSave): void {
    memory = data;
    if (!storage || !persistent) return;
    try {
      storage.setItem(key, JSON.stringify(data));
    } catch {
      persistent = false;
    }
  }

  /** `ended`: also count a lost or won run whose last reveal hasn't been read (it's being replaced). */
  function withBest(data: SurvivalSave, run: SurvivalRun, ended = false): SurvivalSave {
    if (!isOver(run) && !(ended && runStatus(run) !== 'playing')) return data;
    const score = runScore(run);
    const prev = data.best[run.ruleset];
    if (prev?.runId === run.id || !isBetter(score, prev)) return data;
    const best: Best = { ruleset: run.ruleset, rounds: score.rounds, points: score.points, on: run.startedOn, runId: run.id };
    return { ...data, best: { ...data.best, [run.ruleset]: best } };
  }

  return {
    get persistent() {
      return persistent;
    },
    load: read,
    start(run) {
      const data = read();
      if (data.current && !isOver(data.current) && runStatus(data.current) === 'playing') return data.current;
      const recent = data.current ? [[...data.current.questionIds], ...data.recent].slice(0, RECENT_RUNS) : data.recent;
      // A finished run replaced before its last reveal was read still counts toward the best.
      const kept = data.current ? withBest(data, data.current, true) : data;
      write({ ...kept, current: run, recent, started: data.started + 1 });
      return run;
    },
    lock(runId, round, rec) {
      const data = read();
      if (!data.current || data.current.id !== runId) return null;
      const next = addResult(data.current, round, rec);
      if (next !== data.current) write({ ...data, current: next });
      return next;
    },
    advance(runId) {
      const data = read();
      if (!data.current || data.current.id !== runId) return null;
      const next = advance(data.current);
      write(withBest({ ...data, current: next }, next));
      return next;
    },
    discard(runId) {
      const data = read();
      if (data.current?.id === runId) write({ ...data, current: null });
    },
  };
}
