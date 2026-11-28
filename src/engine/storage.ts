import * as z from 'zod/mini';
import type { Mode, RoundRecord } from './game';
import type { Window } from './scoring';

/**
 * Browser-local save. This is a convenience, not anti-cheat: anyone can edit
 * localStorage. Data is validated on read so a bad or tampered value can never
 * crash the game; it is set aside under `<key>:corrupt` and the player starts fresh.
 */
export const SAVE_KEY = 'stat-window:v1';
// Keep untimed runs available if an older release writes to the daily save.
export const UNTIMED_PRACTICE_KEY = 'stat-window:practice-untimed:v1';

export function shotSessionKey(mode: Mode, questionId: string): string {
  return mode === 'daily' ? `stat-window:shot:v1:${questionId}` : `stat-window:shot:practice:v1:${questionId}`;
}

export const sharedShotKey = (day: string, id: string) => `stat-window:shot:daily:v1:${day}:${id}`;

const RoundRecordSchema = z.object({
  questionId: z.string(),
  lo: z.number(),
  hi: z.number(),
  hit: z.boolean(),
  points: z.int().check(z.minimum(0), z.maximum(100)),
  missBy: z.number().check(z.minimum(0)),
  elapsedMs: z.optional(z.number().check(z.minimum(0), z.maximum(24_000))),
  timedOut: z.optional(z.boolean()),
});

const GuessSchema = z.object({
  questionId: z.string(),
  round: z.int().check(z.minimum(0), z.maximum(4)),
  lo: z.number(),
  hi: z.number(),
});

const RunSchema = z.object({
  results: z.array(RoundRecordSchema).check(z.maxLength(5)),
  advanced: z.int().check(z.minimum(0), z.maximum(5)),
  guess: z.optional(GuessSchema),
});

const DayKey = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));

const SaveSchema = z.object({
  version: z.literal(1),
  /** Official daily runs, one per UTC day. Only these count toward stats and streaks. */
  runs: z.record(DayKey, RunSchema),
  /**
   * Runs of earlier days (practice or a friend's challenge link). Saved so a refresh
   * can't re-roll them, but kept apart so they never touch daily stats.
   * Optional so saves written before this field existed still load.
   */
  practice: z.optional(z.record(DayKey, RunSchema)),
  // The old client requires sound in v1 saves. Keep the field readable on rollback.
  settings: z.object({ sound: z.boolean(), introSeen: z.boolean() }),
  /** First and latest UTC day this browser opened the game. Used only for return counts. */
  visits: z.optional(z.object({ first: DayKey, last: DayKey })),
});

export type SavedGuess = Window & { questionId: string; round: number };
export type SavedRun = { results: readonly RoundRecord[]; advanced: number; guess?: SavedGuess | undefined };
export type SaveData = z.infer<typeof SaveSchema>;
export type RunKind = 'runs' | 'practice';
export type Settings = SaveData['settings'];

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function mergeTransferredSave(existing: SaveData, payload: unknown): SaveData | null {
  const parsed = SaveSchema.safeParse(payload);
  if (!parsed.success) return null;
  const incoming = parsed.data;
  // These are separate attempts. Keep a whole run rather than mixing its locked rounds.
  const progress = (run: SavedRun) => run.results.length * 3 + Number(run.advanced === run.results.length) + Number(!!run.guess);
  const mergeDays = (current: SaveData['runs'], received: SaveData['runs']) => {
    const days = { ...current };
    for (const [day, run] of Object.entries(received)) {
      const saved = days[day];
      if (!saved || progress(run) > progress(saved)) days[day] = run;
    }
    return days;
  };
  return {
    ...existing,
    runs: mergeDays(existing.runs, incoming.runs),
    ...(incoming.practice ? { practice: mergeDays(existing.practice ?? {}, incoming.practice) } : {}),
    settings: { ...existing.settings, introSeen: existing.settings.introSeen || incoming.settings.introSeen },
  };
}

export function emptySave(): SaveData {
  return { version: 1, runs: {}, settings: { sound: false, introSeen: false } };
}

/** First lock wins: rounds already saved are never replaced, only extended. */
export function mergeRun(existing: SavedRun | undefined, incoming: SavedRun): SavedRun {
  if (!existing) return incoming;
  const results = [...existing.results];
  for (let i = existing.results.length; i < incoming.results.length; i++) {
    results.push(incoming.results[i]!);
  }
  const advanced = Math.min(results.length, Math.max(existing.advanced, incoming.advanced));
  const guess = [incoming.guess, existing.guess].find((g) => g?.round === advanced && advanced === results.length);
  return { results, advanced, ...(guess ? { guess } : {}) };
}

export type SaveStore = {
  readonly persistent: boolean;
  load(): SaveData;
  saveRun(day: string, run: SavedRun, kind?: RunKind): SavedRun;
  saveSettings(settings: Partial<Settings>): void;
  /** Records a visit on `day`; returns the previous record (undefined for a new browser). */
  recordVisit(day: string): { first: string; last: string } | undefined;
};

export function createSaveStore(storage: StorageLike | null, key = SAVE_KEY): SaveStore {
  let memory: SaveData = emptySave();
  let persistent = storage !== null;

  function read(): SaveData {
    if (!storage) return memory;
    let raw: string | null;
    try {
      raw = storage.getItem(key);
    } catch {
      persistent = false;
      return memory;
    }
    if (raw === null) return persistent ? emptySave() : memory;
    try {
      const parsed = SaveSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      /* fall through */
    }
    try {
      storage.setItem(`${key}:corrupt`, raw);
    } catch {
      /* ignore */
    }
    return emptySave();
  }

  function write(data: SaveData): void {
    memory = data;
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(data));
    } catch {
      persistent = false;
    }
  }

  return {
    get persistent() {
      return persistent;
    },
    load: () => (persistent ? read() : memory),
    saveRun(day, run, kind = 'runs') {
      const data = persistent ? read() : memory;
      const map = data[kind] ?? {};
      const merged = mergeRun(map[day], run);
      write({ ...data, [kind]: { ...map, [day]: { ...merged, results: [...merged.results] } } });
      return merged;
    },
    recordVisit(day) {
      const data = persistent ? read() : memory;
      // Saves from before visits were recorded: infer them from the days already played,
      // so a long-standing player is never counted as a new browser.
      const played = [...Object.keys(data.runs), ...Object.keys(data.practice ?? {})].filter((d) => d <= day).sort();
      const prev = data.visits ?? (played.length ? { first: played[0]!, last: played.at(-1)! } : undefined);
      const first = prev && prev.first < day ? prev.first : day;
      const last = prev && prev.last > day ? prev.last : day;
      write({ ...data, visits: { first, last } });
      return prev;
    },
    saveSettings(settings) {
      const data = persistent ? read() : memory;
      write({ ...data, settings: { ...data.settings, ...settings } });
    },
  };
}
