import type { Difficulty, Question } from '../content/schema.ts';

/** One row per NBA question. Written by scripts/nba/survival.ts; never edit by hand. */
export type SurvivalTag = {
  readonly tier: Difficulty;
  readonly family: string;
  readonly franchise: string | null;
  /** Decade of the season ("1990s"), or "timeless" for rules and records. */
  readonly era: string;
  /** Scale length in steps ((max − min) / step): all the scoring curve depends on. */
  readonly steps: number;
  /** The UTC day this question is the Daily Five for, or null for a reserve. */
  readonly day: string | null;
  /** First UTC day Survival may show it (null: any day). Always after `day`. */
  readonly notBefore: string | null;
  /** Daily questions whose answers this one's text prints (why notBefore is late). */
  readonly leaks?: readonly string[];
};

export type SurvivalCatalog = {
  readonly version: 1;
  readonly cutover: string;
  readonly tags: Readonly<Record<string, SurvivalTag>>;
  /** Reserve facts have no day file, so their questions live here. */
  readonly reserves: readonly Question[];
};
