import { FORMATS, type QuestionFormat } from './formats';
import type { Question } from './schema';
import { potentialPoints, rangeSteps, toSteps, type RoundScore, type Window } from '../engine/scoring';
import { formatValue, unitFor } from '../lib/format';

/**
 * Evergreen teaching inventory (Workstream T): one untimed, worked NBA example per
 * canonical question format, plus the first-play Warriors walkthrough.
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
export const TEACHING_PLAYED_BY = '2026-11-29';

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
 * The single source of truth for format help, keyed by the canonical enum. `satisfies`
 * makes a new format in FORMATS fail to compile until it has help text and an example.
 */
export const FORMAT_GUIDE = {
  recall: {
    label: 'Straight recall',
    instruction: 'Estimate the number, then frame it.',
    detail: 'The question asks for one verified figure. Set your window around what you remember: tighter pays more, but it has to catch the answer.',
    example: {
      id: 'teach-recall-curry-13-threes',
      basis: { fact: 'nba-curry16-13-threes' },
      why: 'Plain recall: the number asked for is the answer. Frame what you remember, as tight as you trust it.',
      question: {
        id: 'teach-recall-curry-13-threes',
        sport: 'NBA',
        prompt: 'On November 7, 2016, Stephen Curry set what was then the single-game record for threes. How many did he make?',
        context: 'Golden State Warriors · 2016–17 regular season',
        answer: 13,
        unit: { singular: 'three-pointer', plural: 'three-pointers' },
        min: 6,
        max: 24,
        step: 1,
        note: '13, then the single-game record.',
        source: {
          name: WIKI,
          url: 'https://en.wikipedia.org/wiki/2016%E2%80%9317_Golden_State_Warriors_season',
          quote: 'Stephen Curry set a new record of 13 three-pointers made in a single game',
        },
        verified: VERIFIED,
        meta: { format: 'recall', family: 'threes-game', era: '2010s', subjects: ['Stephen Curry', 'Golden State Warriors'], supports: [] },
      },
    },
  },
  reference: {
    label: 'Reference figure',
    instruction: 'Use the reference figure as an anchor; it isn’t the answer.',
    detail: 'The prompt prints a verified number from another player, team or season. Reason from it (higher or lower, and by how much), then frame the number actually asked for.',
    example: {
      id: 'teach-reference-murray-stockton',
      basis: { fact: 'nba-murray23-finals-apg', references: ['nba-stockton90-apg'] },
      why: 'Stockton’s 14.5 is the anchor, not the answer. Murray’s 10.0 in the 2023 Finals sits well below the all-time season record.',
      question: {
        id: 'teach-reference-murray-stockton',
        sport: 'NBA',
        prompt: 'John Stockton averaged 14.5 assists a game in 1989–90. What did Jamal Murray average in the 2023 Finals?',
        context: 'Denver Nuggets · five-game 2023 championship series',
        answer: 10,
        unit: { singular: 'assist per game', plural: 'assists per game' },
        min: 4,
        max: 17,
        step: 0.1,
        note: '10.0 assists a night, complementing Jokić’s scoring and passing.',
        source: {
          name: WIKI,
          url: 'https://en.wikipedia.org/wiki/2023_NBA_Finals',
          quote: 'Jamal Murray | 5 | 5 | 42.2 | .451 | .387 | .929 | 6.2 | 10.0 | 1.0 | 0.0 | 21.4',
        },
        verified: VERIFIED,
        meta: { format: 'reference', family: 'assists-average', era: 'cross-era', subjects: ['Jamal Murray', 'Denver Nuggets'], supports: ['nba-stockton90-apg'] },
      },
    },
  },
  'missing-point': {
    label: 'Missing data point',
    instruction: 'Read the chart’s units and known bars, then frame the hidden one.',
    detail: 'Each bar is a verified figure on the same scale; the dashed slot is the one you estimate. Read the title and unit first; your window is drawn on the slot as you move it.',
    example: {
      id: 'teach-missing-best-records',
      basis: {
        fact: 'nba-celtics24-wins',
        chart: [
          { label: 'Lakers ’87', fact: 'nba-lakers87-wins' },
          { label: 'Kings ’02', fact: 'nba-kings02-regular-wins' },
          { label: 'Bulls ’11', fact: 'nba-bulls11-regular-wins' },
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
            { label: 'Kings ’02', value: 61 },
            { label: 'Bulls ’11', value: 62 },
            { label: 'Bucks ’19', value: 60 },
            { label: 'Celtics ’24', value: null },
          ],
        },
        meta: {
          format: 'missing-point',
          family: 'wins-season',
          era: 'cross-era',
          subjects: ['Boston Celtics'],
          supports: ['nba-lakers87-wins', 'nba-kings02-regular-wins', 'nba-bulls11-regular-wins', 'nba-bucks19-season-wins'],
        },
      },
    },
  },
  difference: {
    label: 'Difference',
    instruction: 'Frame the gap between the two figures, in the direction asked.',
    detail: 'Work out both figures, then subtract in the order the question states. Your window is for the gap itself, not for either total.',
    example: {
      id: 'teach-difference-west-magic',
      basis: { references: ['nba-magic80-g6-points'], derive: { op: 'difference', of: ['nba-west69-g1', 'nba-magic80-g6-points'] } },
      why: 'Jerry West scored 53; Magic Johnson scored 42. The question asks for West minus Magic: 53 − 42 = 11.',
      question: {
        id: 'teach-difference-west-magic',
        sport: 'NBA',
        prompt: 'Magic Johnson scored 42 in Game 6 of the 1980 Finals. How many more did Jerry West score in Game 1 of the 1969 Finals?',
        context: 'Lakers Finals scoring · West 1969 minus Magic 1980',
        answer: 11,
        unit: { singular: 'point', plural: 'points' },
        min: 0,
        max: 30,
        step: 1,
        note: 'West scored 53 against Boston, 11 more than rookie Magic’s 42 in the 1980 clincher.',
        source: {
          name: WIKI,
          url: 'https://en.wikipedia.org/wiki/1969_NBA_Finals',
          quote: 'He used this freedom to score 53 points on opposing guards',
          derivation: 'Jerry West 53 points − Magic Johnson 42 points = 11 points.',
        },
        verified: VERIFIED,
        meta: { format: 'difference', family: 'points-game', era: 'cross-era', subjects: ['Jerry West', 'Magic Johnson', 'Los Angeles Lakers'], supports: ['nba-west69-g1', 'nba-magic80-g6-points'] },
      },
    },
  },
  ratio: {
    label: 'Percentage or share',
    instruction: 'Check what’s divided by what; frame the percentage, not a point gap.',
    detail: 'Find the numerator (the part) and the denominator (the whole) the prompt names, then estimate part ÷ whole as a percentage. A percentage is not a gap in percentage points.',
    example: {
      id: 'teach-ratio-kings-home-share',
      basis: { references: ['nba-kings02-regular-wins'], derive: { op: 'percent', of: ['nba-kings02-home-wins', 'nba-kings02-regular-wins'] } },
      why: 'Part: 36 home wins. Whole: all 61 wins (not the 41 home games). 36 ÷ 61 × 100 = 59.0, so 59%.',
      question: {
        id: 'teach-ratio-kings-home-share',
        sport: 'NBA',
        prompt: 'The 2001–02 Kings won 61 regular-season games. What percentage of those wins came at home, to the nearest whole percent?',
        context: 'Sacramento Kings · 2001–02 · home wins ÷ all wins',
        answer: 59,
        unit: { singular: 'percent', plural: 'percent' },
        min: 30,
        max: 90,
        step: 1,
        note: '36 of their 61 wins came at ARCO Arena: about 59%.',
        source: {
          name: WIKI,
          url: 'https://en.wikipedia.org/wiki/2001%E2%80%9302_Sacramento_Kings_season',
          quote: 'Sacramento Kings | 61 | 21 | .744 | – | 36–5 | 25–16',
          derivation: '36 home wins ÷ 61 wins × 100 = 59.0, so 59%.',
        },
        verified: VERIFIED,
        meta: { format: 'ratio', family: 'wins-situational', era: '2000s', subjects: ['Sacramento Kings'], supports: ['nba-kings02-home-wins', 'nba-kings02-regular-wins'] },
      },
    },
  },
  ranking: {
    label: 'Ranking',
    instruction: 'Frame the place or count under the stated rules.',
    detail: 'Read who is being ranked, what decides the order and how ties count. Then estimate the place (1 is the top) or the count, and frame it.',
    example: {
      id: 'teach-ranking-celtics-playoff-record',
      basis: {
        fact: 'nba-celtics24-playoff-losses',
        references: ['nba-celtics24-playoff-losses'],
        ranking: {
          population: 'NBA champions since all four playoff rounds became best-of-seven, by playoff record',
          ties: 'Equal records share the better place; 1st is the fewest losses',
          quoted: 'second only to the 2016–17 Golden State Warriors',
        },
      },
      why: 'The source says the 16–3 Celtics were second only to the 2016–17 Warriors. One champion ahead of them means 2nd.',
      question: {
        id: 'teach-ranking-celtics-playoff-record',
        sport: 'NBA',
        prompt: 'Boston went 16–3 in the 2024 playoffs. Among champions since all four rounds became best-of-seven, where does that rank?',
        context: 'Champions’ playoff records · 1st = fewest losses, ties share',
        answer: 2,
        unit: { singular: 'on the list', plural: 'on the list' },
        min: 1,
        max: 13,
        step: 1,
        note: '2nd. Only the 2016–17 Warriors lost fewer once all four rounds were best-of-seven.',
        source: {
          name: WIKI,
          url: 'https://en.wikipedia.org/wiki/2023%E2%80%9324_Boston_Celtics_season',
          quote: 'With a playoff record of 16–3, the Celtics were second only to the 2016–17 Golden State Warriors',
          derivation: 'Second only to the 2016–17 Warriors: one champion ahead, so 2nd.',
        },
        verified: VERIFIED,
        meta: { format: 'ranking', family: 'losses-season', era: '2020s', subjects: ['Boston Celtics'], supports: ['nba-celtics24-playoff-losses'] },
      },
    },
  },
  trajectory: {
    label: 'Career or era change',
    instruction: 'Find the two seasons or milestones, then frame the change.',
    detail: 'Identify the starting and ending points the prompt names (two seasons, or a record and the mark that broke it), then estimate how far the number moved between them.',
    example: {
      id: 'teach-trajectory-scoring-record',
      basis: { references: ['nba-baylor60-71'], derive: { op: 'difference', of: ['nba-wilt-100', 'nba-baylor60-71'] } },
      why: 'Start: Baylor’s 71 in November 1960. End: Wilt’s 100 on March 2, 1962. The record climbed 100 − 71 = 29 points.',
      question: {
        id: 'teach-trajectory-scoring-record',
        sport: 'NBA',
        prompt: 'Elgin Baylor’s 71 points set the NBA single-game record in November 1960. By how much had Wilt raised it by March 2, 1962?',
        context: 'Single-game scoring record · 1960–61 to 1961–62',
        answer: 29,
        unit: { singular: 'point', plural: 'points' },
        min: 0,
        max: 60,
        step: 1,
        note: 'Wilt’s 100 against the Knicks topped Baylor’s 71 by 29 points.',
        source: {
          name: WIKI,
          url: 'https://en.wikipedia.org/wiki/Wilt_Chamberlain%27s_100-point_game',
          quote: 'by scoring 100 points for the Philadelphia Warriors in a 169–147 win over the New York Knicks on March 2, 1962',
          derivation: 'Wilt Chamberlain 100 points (March 2, 1962) − Elgin Baylor 71 points (November 15, 1960) = 29 points.',
        },
        verified: VERIFIED,
        meta: { format: 'trajectory', family: 'points-game', era: '1960s', subjects: ['Wilt Chamberlain', 'Elgin Baylor'], supports: ['nba-wilt-100', 'nba-baylor60-71'] },
      },
    },
  },
} satisfies Record<QuestionFormat, FormatGuide>;

/** Canonical order, straight from the enum. */
export const GUIDE_FORMATS: readonly QuestionFormat[] = FORMATS;

export const isFormat = (f: unknown): f is QuestionFormat => typeof f === 'string' && (FORMATS as readonly string[]).includes(f);

/** Guidance for a question's format. Missing or unknown metadata falls back to recall. */
export function guideFor(format: string | null | undefined): FormatGuide & { format: QuestionFormat } {
  const f: QuestionFormat = isFormat(format) ? format : 'recall';
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
  const span = `${formatValue(w.lo, q.step)}–${formatValue(w.hi, q.step)}`;
  const width = toSteps(q, w.hi) - toSteps(q, w.lo);
  const range = rangeSteps(q);
  const widthText = v(Number((width * q.step).toFixed(6)));
  if (!score.hit) {
    return {
      kind: 'miss',
      headline: `Outside by ${v(score.missBy)}.`,
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
