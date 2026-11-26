/**
 * Cross-sport Question Factory. No network access, AI calls or publication.
 * Inputs are evidence-backed research facts; outputs are DRAFT questions.
 * Only a separate source check + editorial sign-off makes them eligible for a slate.
 */
import { isPlayerFormat, MAX_PER_FORMAT, slateFormatIssues, VARIETY_FROM, type PlayerFormat } from '../../src/content/formats.ts';

export const VERSION = 1;
export const LADDER = ['easy', 'medium', 'hard', 'hard', 'expert'] as const;
export const TYPES = [
  'famous-moment', 'meaningful-comparison', 'surprising-record', 'season-story',
  'estimable-derived', 'streak', 'team-leader', 'ranking', 'ordinary-average',
] as const;
export type Kind = (typeof TYPES)[number];
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export type Operation = 'literal' | 'difference' | 'sum';
export type Source = {
  url: string; quote: string; license: string; attribution: string;
  /** Human review of the source content, NOT automatic URL validation. */
  verifiedBy?: string; verifiedOn?: string;
};
export type Value = { value: number; source: Source };
export type Ratings = {
  recognition: number; estimability: number; surprise: number;
  story: number; clarity: number;
};
export type Coverage = {
  family: string;
  seasonYear: number | null;
  team?: string;
  player?: string;
  event?: string;
};
export type ResearchFact = {
  id: string; theme: string; kind: Kind; subject: string; event: string; statistic: string;
  values: Value[]; operation: Operation;
  /** Player-facing format (src/content/formats.ts PLAYER_FORMATS). Defaults to recall. */
  format?: PlayerFormat;
  /** Used for comparisons ("A vs B"). */
  compareWith?: string; rankLabel?: string;
  customPrompt?: string; context: string; note: string;
  unit: { singular: string; plural: string };
  scale: { min: number; max: number; step: number };
  difficulty: Difficulty; difficultyReason: string;
  /** Suggested by researcher/agent; editor must critically review. */
  ratings?: Ratings;
  /** Canonical editorial labels, independent of the rendered prompt and research theme. */
  coverage?: Coverage;
};
export type Theme = {
  id: string; title: string; subtitle: string; recap: string;
};
export type ResearchBatch = {
  version: 1; id: string; sport: string; topic: string; author: string;
  themes: Theme[]; facts: ResearchFact[];
};
export type Review = {
  status: 'draft' | 'approved' | 'rejected';
  factChecker?: string; editor?: string; rightsReviewer?: string;
  reviewedOn?: string; notes?: string;
};
export type Candidate = ResearchFact & {
  batchId: string; sport: string; prompt: string; answer: number;
  qualityScore: number; review: Review;
};
export type CandidateBatch = {
  version: 1; id: string; sport: string; topic: string;
  themes: Theme[]; candidates: Candidate[];
};
export type SourcePolicy = {
  sport: string; approvedHosts: string[];
  reviewedBy: string; reviewedOn: string; rationale: string;
};
export type SlateQuestion = {
  id: string; sport: string; prompt: string; context: string; answer: number;
  unit: { singular: string; plural: string }; min: number; max: number; step: number;
  note: string; source: { name: string; url: string; quote: string; derivation?: string };
  verified: { on: string; by: string }; difficulty: Difficulty;
  /** Canonical V5 format, so the NBA publisher and the daily-variety gate can see it. */
  format: string;
};
export type DayProposal = {
  date: string; theme: { title: string; subtitle: string; recap: string };
  questions: SlateQuestion[];
};
export type Proposal = {
  generatedBy: string; version: 1; batchId: string; sport: string;
  warning: string; days: DayProposal[]; candidateIds: string[];
};
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DANGEROUS = /(^|\.)(basketball-reference\.com|sports-reference\.com|nba\.com|stats\.nba\.com)$/i;
const allowedDifficulty: readonly string[] = ['easy', 'medium', 'hard', 'expert'];
const ERR = (key: string, why: string) => `${key}: ${why}`;

export function isDay(day: string): boolean {
  if (!ISO.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === day;
}
export function addDays(day: string, n: number): string {
  if (!isDay(day)) throw new Error(`Invalid date: ${day}`);
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
const goodText = (s: unknown, n = 2): s is string => typeof s === 'string' && s.trim().length >= n;
export function normalized(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
export function factKey(c: Candidate): string {
  return JSON.stringify([c.sport, c.subject, c.event, c.statistic].map(normalized).concat(String(c.answer)));
}
export type QuestionIdentity = Pick<Candidate, 'id' | 'sport' | 'answer' | 'prompt'>;
export function similarQuestion(a: QuestionIdentity, b: QuestionIdentity): boolean {
  if (a.sport.toUpperCase() !== b.sport.toUpperCase() || a.answer !== b.answer) return false;
  const years = (prompt: string): string[] => prompt.match(/\b(?:18|19|20)\d{2}\b/g) ?? [];
  const aYears = years(a.prompt);
  const bYears = years(b.prompt);
  if (aYears.length && bYears.length && !aYears.some((year) => bYears.includes(year))) return false;
  const terms = (prompt: string) => new Set(normalized(prompt).split(' ').filter((word) => word.length > 2));
  const aWords = terms(a.prompt);
  const bWords = terms(b.prompt);
  const common = [...aWords].filter((word) => bWords.has(word)).length;
  return common >= 5 && common / (aWords.size + bWords.size - common) >= .8;
}
export function sourceHost(s: string): string | null {
  try { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password ? u.hostname.toLowerCase() : null; }
  catch { return null; }
}
function quoteContains(n: number, quote: string): boolean {
  // Require a complete numeric token, not "79" as a substring of "179".
  // Both 1234 and 1,234 are accepted.
  const tokens = quote.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return tokens.some((token) => Number(token.replaceAll(',', '')) === n);
}
export function answerFor(f: ResearchFact): number {
  if (!f.values?.length) throw new Error(`${f.id}: missing source numbers`);
  if (f.operation === 'literal') {
    if (f.values.length !== 1) throw new Error(`${f.id}: literal needs one source number`);
    return f.values[0]!.value;
  }
  if (f.values.length !== 2) throw new Error(`${f.id}: ${f.operation} requires exactly two source numbers`);
  if (f.operation === 'difference') return Number((f.values[0]!.value - f.values[1]!.value).toFixed(8));
  if (f.operation === 'sum') return Number((f.values[0]!.value + f.values[1]!.value).toFixed(8));
  throw new Error(`${f.id}: unsupported arithmetic`);
}
export function promptFor(f: ResearchFact): string {
  if (f.customPrompt) return f.customPrompt;
  switch (f.kind) {
    case 'famous-moment':
      return `In ${f.event}, how many ${f.statistic} did ${f.subject} record?`;
    case 'meaningful-comparison':
    case 'estimable-derived':
      if (!f.compareWith || f.operation !== 'difference' || answerFor(f) < 0)
        throw new Error(`${f.id}: comparison template requires positive difference and compareWith, or use customPrompt`);
      return `In ${f.event}, how many more ${f.statistic} did ${f.subject} have than ${f.compareWith}?`;
    case 'surprising-record':
      return `During ${f.event}, how many ${f.statistic} did ${f.subject} record?`;
    case 'season-story':
      return `In ${f.event}, how many ${f.statistic} did ${f.subject} record?`;
    case 'streak':
      return `During ${f.event}, how many consecutive ${f.statistic} did ${f.subject} achieve?`;
    case 'team-leader':
      return `In ${f.event}, how many ${f.statistic} did the ${f.subject} leader record?`;
    case 'ranking':
      if (!f.rankLabel) throw new Error(`${f.id}: ranking needs rankLabel or customPrompt`);
      return `In ${f.event}, how many ${f.statistic} did the ${f.rankLabel} player on ${f.subject} record?`;
    case 'ordinary-average':
      return `In ${f.event}, what was ${f.subject}'s ${f.statistic} average?`;
    default:
      throw new Error(`${f.id}: unsupported question kind`);
  }
}
export function qualityScore(r: Ratings | undefined): number {
  if (!r) return 0;
  return Math.round((r.recognition * .22 + r.estimability * .30 + r.surprise * .20 +
    r.story * .18 + r.clarity * .10) * 100) / 100;
}
export function generate(batch: ResearchBatch): CandidateBatch {
  if (batch.version !== VERSION || !ID.test(batch.id) || !goodText(batch.sport) ||
      !goodText(batch.topic) || !goodText(batch.author)) throw new Error('Invalid batch header');
  const themes = new Set(batch.themes.map((t) => t.id));
  if (themes.size !== batch.themes.length || [...themes].some((t) => !ID.test(t))) throw new Error('Invalid or duplicate theme ID');
  const seen = new Set<string>();
  const candidates = batch.facts.map((f) => {
    if (!ID.test(f.id) || seen.has(f.id)) throw new Error(`Invalid or duplicate fact ID: ${f.id}`);
    if (!themes.has(f.theme)) throw new Error(`${f.id}: unknown theme ${f.theme}`);
    if (!(TYPES as readonly string[]).includes(f.kind)) throw new Error(`${f.id}: unsupported type ${f.kind}`);
    seen.add(f.id);
    const answer = answerFor(f);
    const prompt = promptFor(f);
    return {
      ...f, batchId: batch.id, sport: batch.sport.toUpperCase(),
      prompt, answer, qualityScore: qualityScore(f.ratings),
      review: { status: 'draft' as const },
    };
  });
  return { version: 1, id: batch.id, sport: batch.sport.toUpperCase(), topic: batch.topic, themes: batch.themes, candidates };
}
export function validateCandidate(c: Candidate, policy: SourcePolicy | null): string[] {
  const e: string[] = [];
  const at = (why: string) => e.push(ERR(c.id, why));
  if (!ID.test(c.id) || !ID.test(c.theme)) at('invalid ID or theme');
  if (!goodText(c.prompt, 10) || c.prompt.length > 140 || !c.prompt.includes('?')) at('prompt must be a concise numeric question');
  if (!goodText(c.context, 3) || c.context.length > 80) at('context must be 3–80 characters');
  if (!goodText(c.note, 3) || c.note.length > 140) at('reveal must be 3–140 characters');
  if (!goodText(c.unit?.singular, 1) || !goodText(c.unit?.plural, 1)) at('units required');
  if (!allowedDifficulty.includes(c.difficulty) || !goodText(c.difficultyReason, 5)) at('difficulty needs a reason');
  if (!Number.isFinite(c.answer) || !c.values?.every((v) => Number.isFinite(v.value))) at('numeric values required');
  try { if (answerFor(c) !== c.answer) at('computed answer does not match evidence'); }
  catch (err) { at(String(err)); }
  const { min, max, step } = c.scale ?? {};
  if (!(Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(step) && step > 0 && min < c.answer && c.answer < max)) at('answer must be strictly inside a finite, positive-step scale');
  else {
    const steps = (max - min) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-8 || steps < 5 || steps > 400) at('scale must have 5–400 whole steps');
    const pos = (c.answer - min) / (max - min);
    if (pos < .08 || pos > .92) at('answer too close to ruler edge');
    if (steps >= 5) {
      const middle = Math.round(steps / 2);
      const answerStep = (c.answer - min) / step;
      const width = Math.max(1, Math.ceil(Math.abs(answerStep - middle)) * 2);
      const midpointScore = Math.round(100 * ((steps - width) / (steps - 1)) ** 2);
      if (midpointScore > 90) at('centering the window is an unfair shortcut (scores >90)');
    }
  }
  if (!c.ratings || Object.values(c.ratings).length !== 5 ||
      Object.values(c.ratings).some((v) => !Number.isInteger(v) || v < 1 || v > 5)) at('all five 1–5 editorial ratings required');
  else {
    if (c.ratings.estimability < 3) at('not reasonably estimable');
    if (c.ratings.surprise + c.ratings.story < 6) at('low curiosity/story value');
    if (qualityScore(c.ratings) < 3.4) at('below editorial quality threshold 3.4');
    if (['ranking', 'ordinary-average'].includes(c.kind) && c.ratings.story < 4)
      at('ordinary average or arbitrary ranking needs unusually compelling story');
  }
  if (!goodText(c.review?.factChecker) || !goodText(c.review?.editor) ||
      !goodText(c.review?.rightsReviewer) || !isDay(c.review?.reviewedOn ?? '')) at('needs dated independent fact, editorial and rights sign-offs');
  if (goodText(c.review?.factChecker) && goodText(c.review?.editor) &&
      c.review.factChecker.trim().toLowerCase() === c.review.editor.trim().toLowerCase()) at('fact-checker and editor must differ');
  if (c.sport.toUpperCase() === 'NBA') {
    const coverage = c.coverage;
    const reviewYear = typeof c.review?.reviewedOn === 'string' ? Number(c.review.reviewedOn.slice(0, 4)) : 0;
    if (!coverage || !goodText(coverage.family) || !ID.test(coverage.family) ||
        ![coverage.team, coverage.player, coverage.event].some(Boolean) ||
        [coverage.team, coverage.player, coverage.event].some((id) => id !== undefined && (typeof id !== 'string' || !ID.test(id))) ||
        (coverage.seasonYear !== null && (!Number.isInteger(coverage.seasonYear) || coverage.seasonYear < 1946 ||
          coverage.seasonYear > reviewYear)))
      at('NBA review needs canonical stat family, subject IDs and season year (null for timeless facts)');
    if (!goodText(c.review?.notes, 10)) at('NBA approval needs editorial notes on estimability and the reveal');
  }
  if (!policy || policy.sport.toLowerCase() !== c.sport.toLowerCase() ||
      !goodText(policy.reviewedBy) || !isDay(policy.reviewedOn)) at('reviewed sport-specific source policy required');
  if (!c.values?.length || c.values.some((v) => !v.source)) at('each input number needs provenance');
  const hosts = new Set<string>();
  for (const v of c.values ?? []) {
    const s = v.source;
    if (!s) continue;
    const host = sourceHost(s.url);
    if (!host || DANGEROUS.test(host)) at('unsupported or restricted source hostname');
    if (policy && (!host || !policy.approvedHosts.includes(host))) at(`source ${host ?? s.url} not approved by sport policy`);
    if (!goodText(s.quote, 3) || s.quote.length > 160) at('source quote must be 3–160 characters');
    else if (!quoteContains(v.value, s.quote)) at('source quote does not state the input number');
    if (!goodText(s.license) || !goodText(s.attribution) || !goodText(s.verifiedBy) || !isDay(s.verifiedOn ?? '')) at('source license, attribution and documented human verification required');
    if (host) hosts.add(s.url);
  }
  if (hosts.size > 1) at('derived answers need one primary source URL in the staged schema');
  if (c.review?.status !== 'approved') at('candidate is not editorially approved');
  return e;
}
export function validateBatch(b: CandidateBatch): string[] {
  const errors: string[] = [];
  if (b.version !== VERSION || !ID.test(b.id) || !goodText(b.sport)) errors.push('invalid candidate batch header');
  const ids = new Set<string>();
  const prompts = new Set<string>();
  const meanings = new Set<string>();
  for (const t of b.themes) {
    if (!ID.test(t.id) || !goodText(t.title) || t.title.length > 40 ||
        !goodText(t.subtitle) || t.subtitle.length > 60 ||
        !goodText(t.recap, 10) || t.recap.length > 220)
      errors.push(ERR(t.id, 'theme title, subtitle or recap invalid for the live game'));
  }
  for (const c of b.candidates) {
    if (ids.has(c.id)) errors.push(ERR(c.id, 'duplicate candidate id'));
    ids.add(c.id);
    if (prompts.has(normalized(c.prompt))) errors.push(ERR(c.id, 'duplicate prompt'));
    prompts.add(normalized(c.prompt));
    const meaning = factKey(c);
    if (meanings.has(meaning)) errors.push(ERR(c.id, 'same underlying fact already used in batch'));
    meanings.add(meaning);
    if (!b.themes.some((t) => t.id === c.theme)) errors.push(ERR(c.id, 'missing theme'));
    if (c.format !== undefined && !isPlayerFormat(c.format)) errors.push(ERR(c.id, `unknown question format ${String(c.format)} (taxonomy v2: recall, reference or missing-point)`));
    if (c.batchId !== b.id || c.sport.toLowerCase() !== b.sport.toLowerCase()) errors.push(ERR(c.id, 'batch/sport mismatch'));
  }
  for (const [index, c] of b.candidates.entries()) {
    const other = b.candidates.slice(0, index).find((prior) => similarQuestion(c, prior));
    if (other) errors.push(ERR(c.id, `prompt is similar to ${other.id}; confirm it asks a distinct question`));
  }
  return errors;
}
export function eligible(b: CandidateBatch, policy: SourcePolicy | null): Candidate[] {
  return b.candidates.filter((c) => validateCandidate(c, policy).length === 0);
}
export function slateQuestion(c: Candidate): SlateQuestion {
  const base = c.values[0]!.source;
  const derivation = c.operation === 'literal' ? undefined :
    `${c.values[0]!.value} ${c.operation === 'difference' ? '-' : '+'} ${c.values[1]!.value} = ${c.answer}`;
  return {
    id: c.id, sport: c.sport, prompt: c.prompt, context: c.context, answer: c.answer,
    unit: c.unit, min: c.scale.min, max: c.scale.max, step: c.scale.step,
    note: c.note, source: { name: base.attribution, url: base.url, quote: base.quote, ...(derivation ? { derivation } : {}) },
    verified: { on: c.review.reviewedOn!, by: c.review.factChecker! }, difficulty: c.difficulty,
    format: candidateFormat(c),
  };
}
const order = (a: Candidate, b: Candidate) =>
  qualityScore(b.ratings) - qualityScore(a.ratings) || a.id.localeCompare(b.id);

function hasNbaVariety(candidates: Candidate[]): boolean {
  const groups = candidates.map((c) => c.coverage!);
  const subjects = new Set(groups.map(({ player, team, event }) => player ?? team ?? event));
  const eras = new Set(groups.flatMap(({ seasonYear }) => seasonYear === null ? [] : [Math.floor(seasonYear / 10)]));
  return subjects.size >= 3 && new Set(groups.map(({ family }) => family)).size >= 3 && eras.size >= 2;
}

function suitsNbaSlot(c: Candidate, slot: number): boolean {
  const { recognition, estimability, story, surprise } = c.ratings!;
  if (slot === 2) return surprise >= 4;
  if (slot === 0 || slot === 4)
    return recognition >= 4 && estimability >= 3 && story >= 4 && (slot === 0 || surprise >= 4);
  return true;
}

/**
 * A candidate's player-facing format (taxonomy v2, src/content/formats.ts). A research
 * fact names it (`format`) when it prints a reference or needs a chart; otherwise it is
 * recall. A difference or sum is the underlying statistic, not a format of its own.
 */
export function candidateFormat(c: Pick<ResearchFact, 'operation'> & { format?: string }): string {
  return c.format ?? 'recall';
}

function selectSlate(candidates: Candidate[], nba: boolean, formatsRequired = false): Candidate[] | null {
  const pools = LADDER.map((diff, slot) => candidates.filter((c) => c.difficulty === diff && (!nba || suitsNbaSlot(c, slot))));
  const available = [...new Set(pools.flat())];
  if (pools.some((pool) => !pool.length) || new Set(available.map((c) => c.kind)).size < 3) return null;
  if (nba && !hasNbaVariety(available)) return null;

  function choose(selected: Candidate[]): Candidate[] | null {
    if (selected.length === LADDER.length) {
      const variety = new Set(selected.map((c) => c.kind)).size >= 3;
      // V5.2: official slates use all three player formats, 2/2/1.
      const formats = !formatsRequired || slateFormatIssues(selected.map(candidateFormat)).length === 0;
      return variety && formats && (!nba || hasNbaVariety(selected)) ? selected : null;
    }
    const kindCount = (c: Candidate) => selected.filter((prior) => prior.kind === c.kind).length;
    const formatCount = (c: Candidate) => selected.filter((prior) => candidateFormat(prior) === candidateFormat(c)).length;
    const pool = pools[selected.length]!.filter((c) => !selected.includes(c) && kindCount(c) < 2 && (!formatsRequired || formatCount(c) < MAX_PER_FORMAT));
    pool.sort((a, b) => kindCount(a) - kindCount(b) || order(a, b));
    for (const c of pool) {
      if (nba) {
        const coverage = c.coverage!;
        if (coverage.family === selected.at(-1)?.coverage!.family) continue;
        const repeated = (['team', 'player', 'event', 'family'] as const).some((key) =>
          coverage[key] && selected.filter((prior) => prior.coverage![key] === coverage[key]).length >= 2);
        if (repeated) continue;
      }
      const result = choose([...selected, c]);
      if (result) return result;
    }
    return null;
  }
  return choose([]);
}

export function plan(b: CandidateBatch, policy: SourcePolicy | null, start: string, days: number): Proposal {
  if (!isDay(start) || !Number.isInteger(days) || days < 1 || days > 120) throw new Error('Require valid start date and 1–120 days');
  const errors = validateBatch(b);
  if (errors.length) throw new Error(errors.join('\n'));
  const chosen = new Set<string>();
  const lastTheme: string[] = [];
  const output: DayProposal[] = [];
  const nba = b.sport.toUpperCase() === 'NBA';
  const themes = nba ? [{ id: 'nba-mixed', title: 'NBA', subtitle: 'Mixed slate', recap: 'Mixed daily NBA slate.' }] : b.themes;
  const approved = eligible(b, policy);
  for (let d = 0; d < days; d++) {
    const options: { t: Theme; selected: Candidate[]; score: number }[] = [];
    for (const t of themes) {
      const available = approved.filter((c) => (nba || c.theme === t.id) && !chosen.has(c.id));
      const selected = selectSlate(available, nba, addDays(start, d) >= VARIETY_FROM);
      if (!selected) continue;
      options.push({ t, selected, score: selected.reduce((s, x) => s + qualityScore(x.ratings), 0) });
    }
    options.sort((a, c) => {
      const aRepeated = a.t.id === lastTheme.at(-1) ? 1 : 0;
      const cRepeated = c.t.id === lastTheme.at(-1) ? 1 : 0;
      return aRepeated - cRepeated || c.score - a.score || a.t.id.localeCompare(c.t.id);
    });
    if (!options.length) {
      const coverage = nba ? ' NBA days also need strong Q1/Q3/Q5, three subjects, three stat families, two dated eras and no repeated adjacent family.' : '';
      const formats = addDays(start, d) >= VARIETY_FROM ? ' Official slates also need all three formats in a 2/2/1 distribution, <=2 per format (set `format` to reference or missing-point on research facts).' : '';
      throw new Error(`Only ${d} of ${days} complete slates found. Need 1 easy, 1 medium, 2 hard, 1 expert, >=3 types and <=2 per type per day with reviewed facts.${coverage}${formats}`);
    }
    const { t, selected } = options[0]!;
    for (const c of selected) chosen.add(c.id);
    lastTheme.push(t.id);
    output.push({ date: addDays(start, d), theme: { title: t.title, subtitle: t.subtitle, recap: t.recap },
      questions: selected.map(slateQuestion) });
  }
  return {
    generatedBy: 'Stat Window Question Factory', version: 1, batchId: b.id, sport: b.sport,
    warning: 'STAGED PROPOSAL ONLY. Not published. Source pages, ratings, rights, duplicate checks and historical locks require independent release review.',
    days: output, candidateIds: [...chosen],
  };
}
