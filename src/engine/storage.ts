import * as z from 'zod/mini';
import type { RoundRecord } from './game';

/**
 * Browser-local save. This is a convenience, not anti-cheat: anyone can edit
 * localStorage. Data is validated on read so a bad or tampered value can never
 * crash the game; it is set aside under `<key>:corrupt` and the player starts fresh.
 */
export const SAVE_KEY = 'stat-window:v1';

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

const RunSchema = z.object({
  results: z.array(RoundRecordSchema).check(z.maxLength(5)),
  advanced: z.int().check(z.minimum(0), z.maximum(5)),
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
  settings: z.object({ sound: z.boolean(), introSeen: z.boolean() }),
  /** First and latest UTC day this browser opened the game. Used only for return counts. */
  visits: z.optional(z.object({ first: DayKey, last: DayKey })),
});

export type SavedRun = { results: readonly RoundRecord[]; advanced: number };
export type SaveData = z.infer<typeof SaveSchema>;
export type RunKind = 'runs' | 'practice';
export type Settings = SaveData['settings'];

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

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
  return { results, advanced: Math.min(results.length, Math.max(existing.advanced, incoming.advanced)) };
}

export type SaveStore = {
  readonly persistent: boolean;
  load(): SaveData;
  saveRun(day: string, run: SavedRun, kind?: RunKind): SavedRun;
  saveSettings(settings: Partial<Settings>): void;
  /** Records a visit on `day`; returns the previous record (undefined for a new browser). */
  recordVisit(day: string): { first: string; last: string } | undefined;
};

export function createSaveStore(storage: StorageLike | null): SaveStore {
  let memory: SaveData = emptySave();
  let persistent = storage !== null;

  function read(): SaveData {
    if (!storage) return memory;
    let raw: string | null;
    try {
      raw = storage.getItem(SAVE_KEY);
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
      storage.setItem(`${SAVE_KEY}:corrupt`, raw);
    } catch {
      /* ignore */
    }
    return emptySave();
  }

  function write(data: SaveData): void {
    memory = data;
    if (!storage) return;
    try {
      storage.setItem(SAVE_KEY, JSON.stringify(data));
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
      write({ ...data, [kind]: { ...map, [day]: { results: [...merged.results], advanced: merged.advanced } } });
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
