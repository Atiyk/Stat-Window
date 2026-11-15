import { parseSlate, type Slate } from './schema';

/**
 * Each day's slate is its own lazily loaded chunk, so the app downloads only
 * the day being played. (Future days are still public files: this is a static
 * site, so content secrecy is not a goal. See docs/CONTENT.md.)
 */
const loaders = import.meta.glob<{ default: unknown }>('../../content/days/*.json');

const byDay = new Map<string, () => Promise<{ default: unknown }>>(
  Object.entries(loaders).map(([path, load]) => [path.slice(-15, -5), load]),
);

export const inventoryDays: readonly string[] = [...byDay.keys()].sort();

export async function loadSlate(day: string): Promise<Slate | null> {
  const load = byDay.get(day);
  if (!load) return null;
  return parseSlate((await load()).default);
}
