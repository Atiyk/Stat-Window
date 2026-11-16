import type { Difficulty, Question } from '../content/schema.ts';
import { NBA_CUTOVER } from '../content/cutover.ts';
import type { SurvivalCatalog, SurvivalTag } from './catalog.ts';
import { BETA_MIN_TOTAL, BETA_TIER_MULTIPLE, perRunNeed } from './rules.ts';

export type PoolEntry = { readonly id: string; readonly tag: SurvivalTag };

/**
 * The questions Survival may use on UTC day `today`. The one rule that matters:
 * a Daily Five question is eligible only once its day is over (its date is
 * before today) and every daily answer its text gives away has been played
 * too (`notBefore`). Today's puzzle and every future day are never in the pool,
 * whatever the caller asks for. Reserves are eligible from their notBefore.
 *
 * `published` lists the day files that exist; a scheduled question whose day
 * file is missing is left out.
 */
export function eligiblePool(catalog: SurvivalCatalog, today: string, published: readonly string[]): PoolEntry[] {
  const have = new Set(published);
  const out: PoolEntry[] = [];
  for (const [id, tag] of Object.entries(catalog.tags)) {
    if (tag.day !== null) {
      if (!(tag.day < today) || tag.day < NBA_CUTOVER || !have.has(tag.day)) continue;
    }
    if (tag.notBefore !== null && tag.notBefore > today) continue;
    // Belt and braces: notBefore is always after day, but never trust one field alone.
    if (tag.day !== null && tag.notBefore !== null && tag.notBefore <= tag.day) continue;
    out.push({ id, tag });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export type Supply = {
  readonly today: string;
  readonly total: number;
  readonly byTier: Record<Difficulty, number>;
  /** Enough for one run with no repeats inside it. */
  readonly playable: boolean;
  /** Meets the public-beta gate in rules.ts. */
  readonly beta: boolean;
  /** Plain reasons the gates fail, empty when beta is true. */
  readonly short: string[];
};

export function supplyOf(pool: readonly PoolEntry[], today: string): Supply {
  const byTier: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 };
  for (const e of pool) byTier[e.tag.tier]++;
  const want = perRunNeed();
  const short: string[] = [];
  let playable = true;
  for (const t of Object.keys(want) as Difficulty[]) {
    if (byTier[t] < want[t]) playable = false;
    if (byTier[t] < want[t] * BETA_TIER_MULTIPLE) short.push(`${t}: ${byTier[t]} of ${want[t] * BETA_TIER_MULTIPLE}`);
  }
  if (pool.length < BETA_MIN_TOTAL) short.push(`total: ${pool.length} of ${BETA_MIN_TOTAL}`);
  return { today, total: pool.length, byTier, playable, beta: playable && short.length === 0, short };
}

/** The question body for an eligible id: reserves from the catalog, the rest from their day file. */
export function questionLookup(catalog: SurvivalCatalog, slates: readonly { date: string; questions: readonly Question[] }[]): Map<string, Question> {
  const map = new Map<string, Question>();
  for (const q of catalog.reserves) map.set(q.id, q);
  for (const s of slates) for (const q of s.questions) if (catalog.tags[q.id]?.day === s.date) map.set(q.id, q);
  return map;
}
