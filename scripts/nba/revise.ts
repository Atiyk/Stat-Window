/**
 * Applies a reviewed editorial revision batch to the unpublished NBA calendar.
 *
 * A batch records one decision for every question it audits:
 *   retained  the question stays exactly as it is
 *   reframed  same verified fact id and answer; the prompt, reveal, scale, ratings
 *             or V5 format change (`patch.question` is merged into the fact)
 *   replaced  a new fact takes the slot (`newFact`), and the old one moves to the
 *             reserve with a Survival embargo of its original day + 1, so an
 *             unreleased answer can never appear early
 *
 * Every decision is appended to data/nba/editorial/launch-audit.json, which is the
 * inventory report's source of truth. Published days (on or before today, Eastern)
 * are refused, and the whole database must still pass validateNba afterwards.
 *
 *   node --experimental-strip-types scripts/nba/revise.ts --batch file.json [--check]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addDays, puzzleDay } from '../../src/engine/daily.ts';
import { DATA_DIR, loadNbaData, validateNba, type Fact, type NbaData } from './model.ts';

export type Verdict = 'retained' | 'reframed' | 'replaced';
export type Decision = {
  day: string;
  /** 1–5 */
  slot: number;
  /** The id currently in the slot (for replaced: the one being replaced). */
  id: string;
  verdict: Verdict;
  note: string;
  patch?: { question: Partial<Fact['question']>; claim?: string; source?: Partial<Fact['source']> };
  newFact?: Fact;
};
export type Batch = { batch: string; editor: string; decisions: Decision[] };

export type AuditEntry = {
  day: string;
  slot: number;
  id: string;
  /** Set when the slot was replaced. */
  replaced?: string;
  verdict: Verdict;
  format: string;
  note: string;
  batch: string;
  editor: string;
};
export type Audit = { version: 1; entries: AuditEntry[] };

/** V5.0's audit of the 2026-11-28 → 2027-01-27 inventory (frozen). */
export const V5_AUDIT_PATH = join(DATA_DIR, 'editorial', 'launch-audit.json');
/**
 * V5.1's audit of the restarted official season (every slot from VARIETY_FROM). New
 * batches are recorded here; the latest entry for a slot is its current decision.
 */
export const AUDIT_PATH = join(DATA_DIR, 'editorial', 'v51-audit.json');

export function readAudit(path = AUDIT_PATH): Audit {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Audit) : { version: 1, entries: [] };
}

/** Applies `batch` to a copy of `data`. Throws on a decision that cannot apply. */
export function applyBatch(data: NbaData, audit: Audit, batch: Batch, today: string): { data: NbaData; audit: Audit } {
  const next = structuredClone(data);
  const entries = [...audit.entries];
  const byId = new Map(next.facts.map((f) => [f.id, f]));
  for (const d of batch.decisions) {
    const at = `${batch.batch} ${d.day} Q${d.slot}`;
    if (d.day <= today) throw new Error(`${at}: ${d.day} is published; it cannot be revised`);
    const day = next.calendar.days.find((x) => x.date === d.day);
    if (!day) throw new Error(`${at}: no such day`);
    if (day.questions[d.slot - 1] !== d.id) throw new Error(`${at}: slot holds ${day.questions[d.slot - 1]}, not ${d.id}`);
    if (!d.note?.trim()) throw new Error(`${at}: every decision needs an editorial note`);
    if (entries.some((e) => e.day === d.day && e.slot === d.slot)) throw new Error(`${at}: already audited`);
    let id = d.id;
    if (d.verdict === 'reframed') {
      const f = byId.get(d.id);
      if (!f || !d.patch) throw new Error(`${at}: a reframe needs a patch`);
      f.question = { ...f.question, ...d.patch.question };
      if (d.patch.claim) f.claim = d.patch.claim;
      if (d.patch.source) f.source = { ...f.source, ...d.patch.source };
    } else if (d.verdict === 'replaced') {
      const nf = d.newFact;
      if (!nf) throw new Error(`${at}: a replacement needs newFact`);
      if (byId.has(nf.id)) throw new Error(`${at}: ${nf.id} already exists`);
      next.facts.push(nf);
      byId.set(nf.id, nf);
      day.questions[d.slot - 1] = nf.id;
      next.calendar.reserve.push(d.id);
      // The old answer stays unreleased until the day it would have been played has passed.
      next.calendar.reserveNotBefore = { ...(next.calendar.reserveNotBefore ?? {}), [d.id]: addDays(d.day, 1) };
      id = nf.id;
    } else if (d.verdict !== 'retained') throw new Error(`${at}: unknown verdict ${String(d.verdict)}`);
    const f = byId.get(id)!;
    entries.push({
      day: d.day,
      slot: d.slot,
      id,
      ...(d.verdict === 'replaced' ? { replaced: d.id } : {}),
      verdict: d.verdict,
      format: f.question.format?.kind ?? 'recall',
      note: d.note.trim(),
      batch: batch.batch,
      editor: batch.editor,
    });
  }
  entries.sort((a, b) => a.day.localeCompare(b.day) || a.slot - b.slot);
  return { data: next, audit: { version: 1, entries } };
}

const write = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
};

function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const file = arg('--batch');
  if (!file) throw new Error('usage: revise.ts --batch file.json[,file2.json…] [--check] [--scope FROM..TO]');
  // Several disjoint batches (comma-separated) are applied together and validated once.
  const batches = file.split(',').map((f) => JSON.parse(readFileSync(f, 'utf8')) as Batch);
  const today = puzzleDay(new Date());
  let data = loadNbaData();
  let audit = readAudit();
  for (const b of batches) ({ data, audit } = applyBatch(data, audit, b, today));
  const batch = { batch: batches.map((b) => b.batch).join('+'), editor: '', decisions: batches.flatMap((b) => b.decisions) };
  const report = validateNba(data);
  // --scope FROM..TO: while disjoint batches are in flight, ignore the daily-variety
  // errors of days outside this batch's range (they belong to other editors).
  const scope = arg('--scope')?.split('..');
  if (scope && process.argv.includes('--check')) {
    const [from, to] = scope as [string, string];
    report.errors = report.errors.filter((e) => {
      const day = /^(\d{4}-\d{2}-\d{2}): /.exec(e)?.[1];
      const variety = /(questions \(max 2 per format\)|formats? \(need at least 3\))$/.test(e);
      return !(day && variety && (day < from || day > to));
    });
  }
  if (report.errors.length) {
    for (const e of report.errors) console.error(`error: ${e}`);
    process.exit(1);
  }
  const counts = { retained: 0, reframed: 0, replaced: 0 };
  for (const d of batch.decisions) counts[d.verdict]++;
  if (process.argv.includes('--check')) {
    console.log(`Batch ${batch.batch} is valid: ${JSON.stringify(counts)} (nothing written)`);
    return;
  }
  // facts.json is written with one-space indentation, as before.
  write(join(DATA_DIR, 'facts.json'), data.facts);
  write(join(DATA_DIR, 'calendar.json'), data.calendar);
  write(AUDIT_PATH, audit);
  console.log(`Applied batch ${batch.batch}: ${JSON.stringify(counts)}`);
}

if (process.argv[1]?.endsWith('revise.ts')) main();
