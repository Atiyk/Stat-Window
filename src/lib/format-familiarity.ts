import { FORMATS, type QuestionFormat } from '../content/formats';

/**
 * Which question formats this browser has already met in play, so the small
 * first-encounter cue shows once per format and never nags. Its own key, outside the
 * official save schema (stat-window:v1): clearing or corrupting it can never touch
 * runs, streaks or settings, and it carries no scores.
 */
export const FAMILIARITY_KEY = 'stat-window:formats-seen:v1';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function seenFormats(s: Store | null = storage()): Set<QuestionFormat> {
  try {
    const raw = s?.getItem(FAMILIARITY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((f): f is QuestionFormat => (FORMATS as readonly string[]).includes(f)) : []);
  } catch {
    return new Set();
  }
}

export function markFormatSeen(format: QuestionFormat, s: Store | null = storage()): void {
  const seen = seenFormats(s);
  if (seen.has(format)) return;
  seen.add(format);
  try {
    s?.setItem(FAMILIARITY_KEY, JSON.stringify(FORMATS.filter((f) => seen.has(f))));
  } catch { /* storage blocked: the cue may show again, which is harmless */ }
}

/**
 * Whether this is the player's first question of a format, so its one-line instruction
 * shows. Unreadable storage counts as met: a browser that can't remember would
 * otherwise repeat the line on every question.
 */
export function isFirstEncounter(format: QuestionFormat, s: Store | null = storage()): boolean {
  if (!s) return false;
  try {
    s.getItem(FAMILIARITY_KEY);
  } catch {
    return false;
  }
  return !seenFormats(s).has(format);
}
