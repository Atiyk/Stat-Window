import { z } from 'zod';
import type { RoundRecord } from './game';

/**
 * Browser-local save. This is a convenience, not anti-cheat: anyone can edit
 * localStorage. Data is validated on read so a bad or tampered value can never
 * crash the game; it is set aside under `<key>:corrupt` and the player starts fresh.
 */
export const SAVE_KEY = 'stat-window:v1';

const RoundRecordSchema = z.object({
  questionId: z.string(),
  lo: z.number().finite(),
  hi: z.number().finite(),
  hit: z.boolean(),
  points: z.number().int().min(0).max(100),
  missBy: z.number().min(0),
});

const RunSchema = z.object({
  results: z.array(RoundRecordSchema).max(5),
  advanced: z.number().int().min(0).max(5),
});

const SaveSchema = z.object({
  version: z.literal(1),
  runs: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), RunSchema),
  settings: z.object({ sound: z.boolean(), introSeen: z.boolean() }),
});

export type SavedRun = { results: readonly RoundRecord[]; advanced: number };
export type SaveData = z.infer<typeof SaveSchema>;
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
  saveRun(day: string, run: SavedRun): SavedRun;
  saveSettings(settings: Partial<Settings>): void;
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
    saveRun(day, run) {
      const data = persistent ? read() : memory;
      const merged = mergeRun(data.runs[day], run);
      write({ ...data, runs: { ...data.runs, [day]: { results: [...merged.results], advanced: merged.advanced } } });
      return merged;
    },
    saveSettings(settings) {
      const data = persistent ? read() : memory;
      write({ ...data, settings: { ...data.settings, ...settings } });
    },
  };
}
