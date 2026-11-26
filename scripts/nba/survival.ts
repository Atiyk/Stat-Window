/**
 * Builds content/survival/catalog.json, the only NBA data Survival mode reads
 * besides the published day files.
 *
 * It holds:
 *   - `tags`: one row per NBA question (scheduled days and reserve) with its
 *     difficulty tier, stat family, franchise, era, the day it is scheduled for
 *     (null for a reserve) and `notBefore`, the first UTC day Survival may show it.
 *   - `reserves`: the full question for each reserve fact, because reserves have
 *     no day file.
 *
 * `notBefore` is how leaks are kept out. A question is held back until every
 * daily question whose answer its own text gives away (same season or same
 * player, answer printed in its prompt, context, reveal or source quote) has
 * been played. For a scheduled question it is also never earlier than the day
 * after its own date: today's puzzle is never in Survival.
 *
 * Nothing here decides *eligibility on a date*: that is src/survival/pool.ts,
 * which runs in the browser against the real UTC date.
 *
 *   node --experimental-strip-types scripts/nba/survival.ts [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addDays } from '../../src/engine/daily.ts';
import { eraOf, leaksAnswer, loadNbaData, questionFromFact, ROOT, v5Context, validateNba, type Fact, type NbaData } from './model.ts';
import { supportsOf } from './formats.ts';
import type { SurvivalCatalog, SurvivalTag } from '../../src/survival/catalog.ts';

export const CATALOG_PATH = join(ROOT, 'content', 'survival', 'catalog.json');

function textOf(f: Fact): string {
  return [f.question.prompt, f.question.context, f.question.reveal, f.claim, f.source.quote, f.source.derivation ?? ''].join(' \n ');
}

/**
 * Two facts are about the same thing when they share a season or a player, or
 * when `a`'s text names `b`'s player ("78, breaking Baylor's 71").
 */
export function related(a: Fact, b: Fact, text: string = textOf(a)): boolean {
  if (a.season && b.season && a.season === b.season) return true;
  if (a.player && b.player && a.player === b.player) return true;
  // "Dereck Lively II", "Gary Payton Jr.": the surname is the last word that isn't a suffix.
  const surname = b.player?.trim().split(/\s+/).filter((w) => !/^(jr\.?|sr\.?|i{1,3}|iv|v)$/i.test(w)).at(-1);
  if (surname && surname.length >= 3 && new RegExp(`\\b${surname.replace(/[^A-Za-z'’-]/g, '')}\\b`, 'i').test(text)) return true;
  return false;
}

/**
 * The first day `f` may appear in Survival: after its own daily date, and after
 * the date of every related daily question whose answer its text prints.
 */
export function leakHorizon(f: Fact, scheduled: ReadonlyMap<string, string>, facts: readonly Fact[]): { notBefore: string | null; leaks: string[] } {
  const own = scheduled.get(f.id);
  let notBefore = own ? addDays(own, 1) : null;
  const leaks: string[] = [];
  const text = textOf(f);
  // V5: a chart, reference or derivation shows another fact's figure by construction.
  const supports = new Set(supportsOf(f));
  for (const g of facts) {
    if (g.id === f.id) continue;
    const day = scheduled.get(g.id);
    if (day && supports.has(g.id)) {
      leaks.push(g.id);
      const after = addDays(day, 1);
      if (!notBefore || after > notBefore) notBefore = after;
      continue;
    }
    if (!day || !related(f, g, text)) continue;
    // 27 on a 0.1 scale is written "27.0" in the day file but "27" in prose: check both.
    const printed = leaksAnswer(text, g.answer, g.question.step) || (Number.isInteger(g.answer) && leaksAnswer(text, g.answer, 1));
    if (!printed) continue;
    leaks.push(g.id);
    const after = addDays(day, 1);
    if (!notBefore || after > notBefore) notBefore = after;
  }
  return { notBefore, leaks };
}

export function buildCatalog(data: NbaData): SurvivalCatalog {
  const scheduled = new Map<string, string>();
  for (const d of data.calendar.days) for (const id of d.questions) scheduled.set(id, d.date);
  const byId = new Map(data.facts.map((f) => [f.id, f]));
  const v5 = v5Context(data);
  const ids = [...data.calendar.days.flatMap((d) => d.questions), ...data.calendar.reserve];
  const tags: Record<string, SurvivalTag> = {};
  for (const id of ids) {
    const f = byId.get(id);
    if (!f) throw new Error(`unknown question ${id}`);
    const { notBefore: leakNotBefore, leaks } = leakHorizon(f, scheduled, data.facts);
    // A question removed from a *future daily slate* keeps its original
    // no-earlier-than eligibility. Otherwise a harmless editorial replacement
    // can accidentally expose an unreleased answer in today's Survival pool.
    const embargo = data.calendar.reserveNotBefore?.[id];
    const notBefore = embargo && (!leakNotBefore || embargo > leakNotBefore) ? embargo : leakNotBefore;
    tags[id] = {
      tier: f.question.difficulty,
      family: f.family,
      franchise: f.franchise,
      era: eraOf(f.season),
      steps: Math.round((f.question.max - f.question.min) / f.question.step),
      day: scheduled.get(id) ?? null,
      notBefore,
      ...(leaks.length ? { leaks } : {}),
    };
  }
  return {
    version: 1,
    cutover: data.calendar.cutover,
    tags,
    reserves: data.calendar.reserve.map((id) => questionFromFact(byId.get(id)!, v5)),
  };
}

/**
 * Reserve facts are shown in Survival, so once a catalog has listed one as a
 * reserve it must never move onto a Daily Five day.
 */
export function spentReserves(previous: SurvivalCatalog | null, data: NbaData): string[] {
  if (!previous) return [];
  const scheduled = new Set(data.calendar.days.flatMap((d) => d.questions));
  return previous.reserves.map((q) => q.id).filter((id) => scheduled.has(id));
}

export const serializeCatalog = (c: SurvivalCatalog): string => `${JSON.stringify(c, null, 2)}\n`;

function main() {
  const data = loadNbaData();
  const report = validateNba(data);
  if (report.errors.length) {
    for (const e of report.errors) console.error(`error: data/nba: ${e}`);
    process.exit(1);
  }
  const bytes = serializeCatalog(buildCatalog(data));
  const current = existsSync(CATALOG_PATH) ? readFileSync(CATALOG_PATH, 'utf8') : undefined;
  const spent = spentReserves(current ? (JSON.parse(current) as SurvivalCatalog) : null, data);
  if (spent.length) {
    for (const id of spent) console.error(`error: ${id} was a Survival reserve, so players may have seen it; it can't be scheduled as a Daily Five question`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    if (current !== bytes) {
      console.error('error: content/survival/catalog.json is out of date with data/nba; run npm run survival:catalog');
      process.exit(1);
    }
    console.log('Survival catalog up to date.');
    return;
  }
  mkdirSync(dirname(CATALOG_PATH), { recursive: true });
  writeFileSync(CATALOG_PATH, bytes);
  console.log(`Wrote ${CATALOG_PATH}`);
}

if (process.argv[1]?.endsWith('survival.ts')) main();
