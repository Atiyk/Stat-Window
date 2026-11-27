import { isPlayerFormat, PLAYER_FORMATS, type PlayerFormat } from './formats';
import type { Question } from './schema';
import { potentialPoints, rangeSteps, toSteps, type RoundScore, type Window } from '../engine/scoring';
import { formatValue, unitFor } from '../lib/format';

/**
 * Evergreen teaching inventory (Workstream T): one untimed, worked NBA example per
 * player format (taxonomy v2: recall, reference, missing-point), plus the first-play
 * Warriors walkthrough. The four retired formats have no lesson: a historical question
 * that still carries one of their labels is taught with the recall guide.
 *
 * Rules (enforced by scripts/nba/teaching.test.ts against data/nba/facts.json and
 * data/nba/calendar.json):
 * - Every figure comes from a verified fact that was already played as a public beta
 *   daily on or before {@link TEACHING_PLAYED_BY}. Nothing scheduled from the official
 *   restart on, and nothing in the Survival reserve, is ever used, so an example can't
 *   expose a live or future answer.
 * - A derived example never repeats a scheduled question's derivation.
 * - Examples are never saved, scored officially or reported to analytics: they are
 *   played only by src/ui/TeachingPlay.tsx, which has no store and no tracking.
 *
 * Ids start with `teach-` so they can never collide with a published question id.
 */
export const TEACHING_PLAYED_BY = '2026-11-25';

/** Where an example's numbers come from, by verified fact id (checked by the test). */
export type TeachingBasis = {
  /** The verified fact whose figure is the answer, when the answer is not derived. */
  fact?: string;
  /** Verified figures the prompt prints as anchors. */
  references?: string[];
  /** Missing-point chart: each bar's verified fact; `fact` above is the hidden bar. */
  chart?: { label: string; fact: string }[];
  /** A derived answer: difference or percent of two verified facts (a − b, or 100·a/b). */
  derive?: { op: 'difference' | 'percent'; of: [string, string] };
  /** Ranking: the population and tie rule, and the source words that fix the place. */
  ranking?: { population: string; ties: string; quoted: string };
};

export type TeachingExample = {
  readonly id: `teach-${string}`;
  /** A schema-valid question, played with the real Readout, Ruler and QuestionChart. */
  readonly question: Question;
  readonly basis: TeachingBasis;
  /** Shown after the reveal: how this format's answer is worked out. */
  readonly why: string;
};

export type FormatGuide = {
  /** Display name of the format. */
  readonly label: string;
  /** The concise instruction shown under every question of this format during play. */
  readonly instruction: string;
  /** The deeper explanation: in-round disclosure and the guide. */
  readonly detail: string;
  readonly example: TeachingExample;
};

const WIKI = 'Wikipedia contributors (CC BY-SA 4.0)';
const VERIFIED = { on: '2026-11-26', by: 'Stat Window teaching inventory, from verified facts' } as const;

/**
 * The single source of truth for format help, keyed by the player formats. `satisfies`
 * makes a new player format fail to compile until it has help text and an example.
 */
export const FORMAT_GUIDE = {
  recall: {
    label: 'Straight recall',
    instruction: 'Frame your best estimate of the number.',
    detail: 'The question asks for one verified figure. Set your window around what you remember: tighter pays more, but it has to catch the answer.',
    example: {
      id: 'teach-recall-kobe-12-threes',
      basis: { fact: 'nba-kobe03-threes' },
      why: 'Plain recall: the number asked for is the answer. Frame what you remember, as tight as you trust it.',
      question: {
        id: 'teach-recall-kobe-12-threes',
        sport: 'NBA',
        prompt: 'On January 7, 2003, Kobe Bryant set the NBA record for threes in a game. How many did he make?',
        context: 'Los Angeles Lakers · 2002–03 regular season',
        answer: 12,
        unit: { singular: 'three-pointer', plural: 'three-pointers' },
        min: 7,
        max: 26,
        step: 1,
        note: '12, a record at the time.',
        source: {
          name: WIKI,
          url: 'https://en.wikipedia.org/wiki/Kobe_Bryant',
          quote: 'He broke an NBA record for three-pointers on January 7, 2003, when he made 12 against the Seattle SuperSonics.',
        },
        verified: VERIFIED,
        meta: { format: 'recall', family: 'threes-game', era: '2000s', subjects: ['Kobe Bryant', 'Los Angeles Lakers'], supports: [] },
      },
    },
  },
  reference: {
    label: 'Reference figure',
    instruction: 'The figure given is a clue, not the answer.',
    detail: 'The prompt prints a verified number from another player, team or season. Reason from it (higher or lower, and by how much), then frame the number actually asked for.',
    example: {
      id: 'teach-reference-dirk-wilt-free-throws',
      basis: { fact: 'nba-dirk11-24-ft', references: ['nba-wilt-100-ftm'] },
      why: 'Wilt’s 28 is the anchor, not the answer. Dirk’s record night was a little lower, 24, but he never missed.',
      question: {
        id: 'teach-reference-dirk-wilt-free-throws',
        sport: 'NBA',
        prompt: 'Wilt Chamberlain made 28 free throws in his 100-point game. In the 2011 West finals, how many did Dirk Nowitzki make without a miss?',
        context: '2011 West finals · Game 1 · vs Oklahoma City',
        answer: 24,
        unit: { singular: 'free throw', plural: 'free throws' },
        min: 14,
        max: 44,
        step: 1,
        note: '24 of 24, a playoff record.',
        source: {
          name: WIKI,
          url: 'https://en.wikipedia.org/wiki/2010%E2%80%9311_Dallas_Mavericks_season',
          quote: 'set a playoff record for most free throws made without a miss with 24, previously held by',
        },
        verified: VERIFIED,
        meta: { format: 'reference', family: 'free-throws', era: 'cross-era', subjects: ['Dirk Nowitzki', 'Dallas Mavericks'], supports: ['nba-wilt-100-ftm'] },
      },
    },
  },
  'missing-point': {
    label: 'Missing data point',
    instruction: 'Read the bars, then frame the hidden one.',
    detail: 'Each bar is a verified figure on the same scale, starting from zero. The dashed column is the one you estimate; your window is drawn on it as you move the brackets.',
    example: {
      id: 'teach-missing-best-records',
      basis: {
        fact: 'nba-celtics24-wins',
        chart: [
          { label: 'Lakers ’87', fact: 'nba-lakers87-wins' },
          { label: 'Suns ’93', fact: 'nba-suns93-regular-wins' },
          { label: 'Kings ’02', fact: 'nba-kings02-regular-wins' },
          { label: 'Bucks ’19', fact: 'nba-bucks19-season-wins' },
          { label: 'Celtics ’24', fact: 'nba-celtics24-wins' },
        ],
      },
      why: 'The four known league-best teams won 60 to 65 games. That cluster is your guide for the hidden bar; the Celtics landed inside it.',
      question: {
        id: 'teach-missing-best-records',
        sport: 'NBA',
        prompt: 'Each bar is a team with the NBA’s best regular-season record. How many games did the 2023–24 Celtics win?',
        context: 'League-best records · seasons labelled by the year they ended',
        answer: 64,
        unit: { singular: 'win', plural: 'wins' },
        min: 50,
        max: 82,
        step: 1,
        note: '64–18, the NBA’s best.',
        source: {
          name: WIKI,
          url: 'https://en.wikipedia.org/wiki/2023%E2%80%9324_Boston_Celtics_season',
          quote: 'The Celtics had the best record (64–18) in the NBA',
        },
        verified: VERIFIED,
        chart: {
          title: 'Wins by the league’s best regular-season team',
          unit: 'wins',
          points: [
            { label: 'Lakers ’87', value: 65 },
            { label: 'Suns ’93', value: 62 },
            { label: 'Kings ’02', value: 61 },
            { label: 'Bucks ’19', value: 60 },
            { label: 'Celtics ’24', value: null },
          ],
        },
        meta: {
          format: 'missing-point',
          family: 'wins-season',
          era: 'cross-era',
          subjects: ['Boston Celtics'],
          supports: ['nba-lakers87-wins', 'nba-suns93-regular-wins', 'nba-kings02-regular-wins', 'nba-bucks19-season-wins'],
        },
      },
    },
  },
} satisfies Record<PlayerFormat, FormatGuide>;

/** Canonical order, straight from the player enum. */
export const GUIDE_FORMATS: readonly PlayerFormat[] = PLAYER_FORMATS;

/**
 * Guidance for a question's format. A retired format (an old beta day, a saved run, the
 * Survival reserve) asks for one number like any recall question, so it gets the recall
 * guide; so does missing or unknown metadata.
 */
export function guideFor(format: string | null | undefined): FormatGuide & { format: PlayerFormat } {
  const f: PlayerFormat = isPlayerFormat(format) ? format : 'recall';
  return { ...FORMAT_GUIDE[f], format: f };
}

export const TEACHING_EXAMPLES: readonly TeachingExample[] = GUIDE_FORMATS.map((f) => FORMAT_GUIDE[f].example);

/**
 * The first-play walkthrough: the easy, real Warriors 73-win question kept from the
 * beta onboarding (it predates this inventory and is not in data/nba/facts.json). The
 * 73–9 record is printed in a verified source quote in the fact database; the test
 * checks that, and that no scheduled question asks for it.
 */
export const CORE_INTRO: TeachingExample = {
  id: 'teach-intro-warriors-73',
  basis: {},
  why: 'The Warriors finished 73–9, setting the NBA record for regular-season wins.',
  question: {
    id: 'teach-intro-warriors-73',
    sport: 'NBA',
    prompt: 'How many regular-season games did the 2015–16 Golden State Warriors win?',
    context: 'Golden State Warriors · 2015–16 · 82 games',
    answer: 73,
    unit: { singular: 'win', plural: 'wins' },
    min: 0,
    max: 82,
    step: 1,
    note: 'The Warriors finished 73–9, setting the NBA record for regular-season wins.',
    source: {
      name: WIKI,
      url: 'https://en.wikipedia.org/wiki/2015%E2%80%9316_Golden_State_Warriors_season',
      quote: 'finishing with a record of 73–9',
    },
    verified: VERIFIED,
    meta: { format: 'recall', family: 'wins-season', era: '2010s', subjects: ['Golden State Warriors'], supports: [] },
  },
};

export type WindowFeedback = { kind: 'hit' | 'zero' | 'miss'; headline: string; detail: string };

/**
 * Why a window scored, missed, or caught the answer for zero, in plain words, using
 * the real scoring formula. Shared by the first-play walkthrough and the guide.
 */
export function explainWindow(q: Pick<Question, 'min' | 'max' | 'step' | 'answer' | 'unit'>, w: Window, score: RoundScore): WindowFeedback {
  const v = (n: number) => `${formatValue(n, q.step)} ${unitFor(n, q.unit)}`;
  // A ranking's unit names a position ("2 on the list"); a distance between positions is in places.
  const positional = /^on the /.test(q.unit.plural);
  const gap = (n: number) => positional ? `${formatValue(n, q.step)} ${n === 1 ? 'place' : 'places'}` : v(n);
  const span = `${formatValue(w.lo, q.step)}–${formatValue(w.hi, q.step)}`;
  const width = toSteps(q, w.hi) - toSteps(q, w.lo);
  const range = rangeSteps(q);
  const widthText = gap(Number((width * q.step).toFixed(6)));
  if (!score.hit) {
    return {
      kind: 'miss',
      headline: `Outside by ${gap(score.missBy)}.`,
      detail: `The answer, ${v(q.answer)}, fell outside ${span}. A miss scores 0 however tight the window was, so a narrow window is a bigger risk.`,
    };
  }
  const onEdge = q.answer === w.lo || q.answer === w.hi;
  const edge = onEdge ? ' It sat right on your edge, and edges count.' : '';
  if (score.points === 0) {
    return {
      kind: 'zero',
      headline: 'Inside, but too wide to score.',
      detail: `${span} caught ${v(q.answer)}, but it covered ${width} of the ruler’s ${range} steps, so it is worth 0.${edge} Pull the brackets in to earn points.`,
    };
  }
  const half = Math.max(1, Math.floor(width / 2));
  const tighter = half < width ? potentialPoints(q, { lo: q.min, hi: Number((q.min + half * q.step).toFixed(6)) }) : null;
  return {
    kind: 'hit',
    headline: `Inside: +${score.points}.`,
    detail: `${span} caught ${v(q.answer)}.${edge} A window ${widthText} wide earns ${score.points} of 100${tighter !== null ? `; half as wide would earn ${tighter}, if it still caught the answer` : ', the most a window can earn'}.`,
  };
}
