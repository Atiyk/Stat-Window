/**
 * Question Factory CLI. Creates research batches, unverified candidates and
 * REVIEW-ONLY playable slate proposals. Nothing writes to content/days or data/nba.
 *
 * npm run factory -- init --sport NBA --topic "2019 Raptors"
 * npm run factory -- generate --batch nba-2019-raptors
 * npm run factory -- check [--batch nba-2019-raptors]
 * npm run factory -- plan --batch nba-2019-raptors --days 2 --start 2027-01-06
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generate, normalized, plan, sourceHost, validateBatch, validateCandidate, type Candidate,
  type CandidateBatch, type ResearchBatch, type SourcePolicy, type Proposal,
} from './core.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = join(ROOT, 'data', 'question-factory');
const RESEARCH = join(BASE, 'batches');
const CANDIDATES = join(BASE, 'candidates');
const POLICIES = join(BASE, 'policies');
const PROPOSALS = join(BASE, 'proposals');

function json<T>(path: string): T { return JSON.parse(readFileSync(path, 'utf8')) as T; }
function writeNew(path: string, data: unknown): void {
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}. Review/reconcile your edits first.`);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}
function flag(name: string): string | undefined {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const safeId = (v: string): string => normalized(v).replace(/\s+/g, '-');
function requireBatch(): string {
  const id = flag('batch');
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Supply --batch <lowercase-slug>');
  return id;
}
function policyFor(sport: string): SourcePolicy | null {
  const path = join(POLICIES, safeId(sport) + '.json');
  return existsSync(path) ? json<SourcePolicy>(path) : null;
}
function safeId(s: string): string { return normalized(s).replace(/\s+/g, '-'); }
const batchPath = (id: string) => join(RESEARCH, id + '.json');
const candidatesPath = (id: string) => join(CANDIDATES, id + '.json');
const proposalsPath = (id: string) => join(PROPOSALS, id + '.json');

function init(): void {
  const sport = flag('sport')?.toUpperCase();
  const topic = flag('topic');
  if (!sport || !topic || !/^[A-Z][A-Z0-9 -]{1,30}$/.test(sport)) throw new Error('Supply --sport "NBA" and --topic "1996 Bulls"');
  const id = flag('id') ?? safeId(sport + ' ' + topic);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid batch id');
  const data: ResearchBatch = { version: 1, id, sport, topic, author: 'REPLACE_WITH_RESEARCHER',
    themes: [], facts: [] };
  writeNew(batchPath(id), data);
  if (!policyFor(sport)) {
    writeNew(join(POLICIES, safeId(sport) + '.json'), {
      sport, approvedHosts: [], reviewedBy: '', reviewedOn: '',
      rationale: 'PENDING LICENSE AND SOURCE-REUSE REVIEW. Do not approve hosts until checked.',
    } satisfies SourcePolicy);
  }
  console.log(`Created ${batchPath(id)}. Fill themes, sourced facts and editorial metadata; no questions were fabricated.`);
  console.log('Source policy must be reviewed independently before planning.');
}
function makeCandidates(): void {
  const id = requireBatch();
  const b = json<ResearchBatch>(batchPath(id));
  if (b.id !== id) throw new Error('Research batch filename and ID mismatch');
  const result = generate(b);
  writeNew(candidatesPath(id), result);
  console.log(`Created ${result.candidates.length} DRAFT questions in ${candidatesPath(id)}.`);
  console.log('No candidate is approved automatically. Verify sources, edit prompts, score quality, and sign off.');
}
function existingPublished(): { ids: Set<string>; prompts: Set<string>; last: string } {
  const ids = new Set<string>(), prompts = new Set<string>();
  const dir = join(ROOT, 'content', 'days');
  const names = readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  for (const name of names) {
    const slate = json<{ questions: { id: string; prompt: string }[] }>(join(dir, name));
    for (const q of slate.questions) { ids.add(q.id); prompts.add(normalized(q.prompt)); }
  }
  return { ids, prompts, last: names.at(-1)?.slice(0, 10) ?? '0000-00-00' };
}
function checkCandidateBatch(b: CandidateBatch, p: SourcePolicy | null): string[] {
  const errors = validateBatch(b);
  const known = existingPublished();
  const all = readdirSync(CANDIDATES).filter((n) => n.endsWith('.json'));
  const otherIds = new Set<string>(), otherPrompts = new Set<string>();
  for (const n of all) {
    if (n === b.id + '.json') continue;
    for (const c of json<CandidateBatch>(join(CANDIDATES, n)).candidates) {
      otherIds.add(c.id);
      otherPrompts.add(normalized(c.prompt));
    }
  }
  for (const c of b.candidates) {
    // Duplicates are errors even for drafts: editing the question is cheaper now than after publishing.
    if (known.ids.has(c.id) || otherIds.has(c.id)) errors.push(`${c.id}: ID already used in another question or published day`);
    if (known.prompts.has(normalized(c.prompt)) || otherPrompts.has(normalized(c.prompt))) errors.push(`${c.id}: prompt already used in another question or published day`);
    if (c.review?.status === 'approved') errors.push(...validateCandidate(c, p));
  }
  return errors;
}
function check(): void {
  const id = flag('batch');
  const names = id ? [id + '.json'] : existsSync(CANDIDATES) ?
    readdirSync(CANDIDATES).filter((n) => n.endsWith('.json')).sort() : [];
  let failed = 0, total = 0, approved = 0;
  for (const name of names) {
    const b = json<CandidateBatch>(join(CANDIDATES, name));
    const errs = checkCandidateBatch(b, policyFor(b.sport));
    total += b.candidates.length;
    approved += b.candidates.filter((c) => c.review.status === 'approved').length;
    console.log(`${b.id}: ${b.candidates.length} candidates; ${b.candidates.filter((c) => c.review.status === 'approved').length} approved; ${errs.length} errors`);
    for (const e of errs) console.error('error:', e);
    failed += errs.length;
  }
  console.log(`Factory: ${names.length} batches, ${total} candidates, ${approved} approved, ${failed} errors. (Drafts never publish.)`);
  if (failed) process.exitCode = 1;
}
function planBatch(): void {
  const id = requireBatch();
  const start = flag('start'), raw = flag('days');
  if (!start || !raw) throw new Error('Supply --start YYYY-MM-DD and --days N');
  const b = json<CandidateBatch>(candidatesPath(id));
  const policy = policyFor(b.sport);
  const errors = checkCandidateBatch(b, policy);
  if (errors.length) throw new Error(errors.join('\n'));
  const latest = existingPublished().last;
  if (start <= latest) throw new Error(`Start must be after existing calendar ends (${latest}); published or scheduled puzzles cannot be overwritten`);
  const proposal: Proposal = plan(b, policy, start, Number(raw));
  // Test for all approved questions was completed inside plan(); review proposals manually before promotion.
  writeNew(proposalsPath(id), proposal);
  console.log(`Staged ${proposal.days.length} days / ${proposal.candidateIds.length} approved questions in ${proposalsPath(id)}.`);
  console.log('Nothing published. Existing NBA and other daily content, locks, and Survival pool were not changed.');
  console.log('Release integrator must check other future proposals and integrate via the appropriate sport publisher.');
}
function main(): void {
  const op = process.argv[2];
  if (op === 'init') init();
  else if (op === 'generate') makeCandidates();
  else if (op === 'check') check();
  else if (op === 'plan') planBatch();
  else throw new Error('Usage: npm run factory -- <init|generate|check|plan> [options]; see docs/QUESTION-FACTORY.md');
}
if (process.argv[1] && /question-factory[\\/]cli\.ts$/.test(process.argv[1])) {
  try { main(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }
}
