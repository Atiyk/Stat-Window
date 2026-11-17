import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSlate } from '../../src/content/schema.ts';
import {
  addDays, answerFor, eligible, generate, plan, promptFor, sourceHost,
  validateBatch, validateCandidate, type CandidateBatch, type ResearchBatch, type SourcePolicy,
  type ResearchFact,
} from './core.ts';

const policy: SourcePolicy = {
  sport: 'TEST', approvedHosts: ['example.org'], reviewedBy: 'legal-reviewer',
  reviewedOn: '2026-11-16', rationale: 'Synthetic test data only, not a real grant of rights',
};
function fact(id: string, kind: ResearchFact['kind'], difficulty: ResearchFact['difficulty'], value: number): ResearchFact {
  return {
    id, theme: 'historic-final', kind, subject: 'Team Alpha', event: `a fictional final involving ${id}`,
    statistic: 'points', operation: 'literal',
    values: [{ value, source: {
      url: 'https://example.org/fictional-final', quote: `Team Alpha scored ${value} points`,
      license: 'synthetic-fixture', attribution: 'Synthetic test data author', verifiedBy: 'fact-auditor', verifiedOn: '2026-11-16',
    } }],
    context: 'fictional sports test season', note: 'A deliberately fictional result used only to test the factory.',
    unit: { singular: 'point', plural: 'points' }, scale: { min: 0, max: 200, step: 1 },
    difficulty, difficultyReason: 'This is a test of the editorial difficulty ladder.',
    ratings: { recognition: 5, estimability: 5, surprise: 5, story: 5, clarity: 5 },
  };
}
const raws = [
  fact('test-q1', 'famous-moment', 'easy', 75),
  fact('test-q2', 'season-story', 'medium', 83),
  fact('test-q3', 'surprising-record', 'hard', 112),
  fact('test-q4', 'team-leader', 'hard', 91),
  fact('test-q5', 'streak', 'expert', 127),
];
const batch: ResearchBatch = {
  version: 1, id: 'test-factory', sport: 'TEST', topic: 'Fictional championship', author: 'researcher',
  themes: [{ id: 'historic-final', title: 'Historic final', subtitle: 'Test game season',
    recap: 'Five entirely fictional numbers, not real sports facts.' }],
  facts: raws,
};
function reviewed(b: CandidateBatch): CandidateBatch {
  return { ...b, candidates: b.candidates.map((c) => ({ ...c,
    review: { status: 'approved', factChecker: 'fact-auditor', editor: 'editor-a',
      rightsReviewer: 'legal-reviewer', reviewedOn: '2026-11-16' } })) };
}
describe('question factory', () => {
  it('creates draft candidates from generic sports research; never silently approves', () => {
    const created = generate(batch);
    expect(created.candidates).toHaveLength(5);
    expect(created.candidates.every((x) => x.review.status === 'draft')).toBe(true);
    expect(eligible(created, policy)).toHaveLength(0);
    expect(created.candidates[0]?.sport).toBe('TEST');
  });
  it('generates reproducible reviewed themed slates with five difficulty slots', () => {
    const approved = reviewed(generate(batch));
    expect(validateBatch(approved)).toEqual([]);
    expect(eligible(approved, policy)).toHaveLength(5);
    const result = plan(approved, policy, '2027-01-06', 1);
    expect(result.days[0]?.date).toBe('2027-01-06');
    expect(result.days[0]?.questions.map((q) => q.difficulty)).toEqual([
      'easy', 'medium', 'hard', 'hard', 'expert',
    ]);
    expect(result.days[0]?.questions.every((q) => q.sport === 'TEST')).toBe(true);
    expect(result.days[0]?.questions[0]?.source.url).toContain('example.org');
    expect(plan(approved, policy, '2027-01-06', 1)).toEqual(result);
    expect(() => plan(approved, policy, '2027-01-06', 2)).toThrow('Only 1 of 2');
  });
  it('computes differences only from supplied verified source numbers', () => {
    const f = { ...fact('test-comp', 'meaningful-comparison', 'hard', 95),
      compareWith: 'Team Beta', operation: 'difference' as const,
      values: [
        { value: 95, source: fact('a', 'season-story', 'hard', 95).values[0]!.source },
        { value: 35, source: { ...fact('b', 'season-story', 'hard', 35).values[0]!.source, quote: 'Team Beta scored 35 points' } },
      ],
    };
    expect(answerFor(f)).toBe(60);
    expect(promptFor(f)).toContain('Team Beta');
    const c = reviewed(generate({ ...batch, facts: [f] })).candidates[0]!;
    expect(validateCandidate(c, policy)).toEqual([]);
  });
  it('rejects missing signoffs, forbidden source hosts, unsupported arithmetic and score-based guessing shortcuts', () => {
    const draft = generate(batch).candidates[0]!;
    expect(validateCandidate(draft, policy)).toEqual(expect.arrayContaining([expect.stringContaining('not editorially approved')]))
    const approved = reviewed(generate(batch)).candidates[0]!;
    expect(validateCandidate({ ...approved, values: [{ ...approved.values[0]!,
      source: { ...approved.values[0]!.source, url: 'https://basketball-reference.com/teams/XYZ/' } }] }, policy))
      .toEqual(expect.arrayContaining([expect.stringContaining('restricted source hostname')]))
    expect(validateCandidate({ ...approved, scale: { min: 74.8, max: 80, step: 0.1 } }, policy))
      .toEqual(expect.arrayContaining([expect.stringContaining('ruler edge')]))
    expect(validateCandidate({ ...approved, ratings: { ...approved.ratings!, estimability: 1 } }, policy))
      .toEqual(expect.arrayContaining([expect.stringContaining('not reasonably estimable')]))
    expect(validateCandidate({ ...approved, values: [{ ...approved.values[0]!, value: 99 }] }, policy))
      .toEqual(expect.arrayContaining([expect.stringContaining('computed answer')]))
    expect(validateCandidate({ ...approved, review: { ...approved.review, editor: 'fact-auditor' } }, policy))
      .toEqual(expect.arrayContaining([expect.stringContaining('must differ')]))
    expect(validateCandidate(approved, null)).toEqual(expect.arrayContaining([expect.stringContaining('source policy')]))
  });
  it('requires 3 distinct question types and refuses duplicates', () => {
    const approved = reviewed(generate(batch));
    expect(validateBatch({ ...approved, candidates: [...approved.candidates, approved.candidates[0]!] }))
      .toEqual(expect.arrayContaining([expect.stringContaining('duplicate candidate id')]))
    const onlyMoment = { ...approved, candidates: approved.candidates.map((c) => ({ ...c, kind: 'famous-moment' as const })) };
    expect(() => plan(onlyMoment, policy, '2027-01-06', 1)).toThrow('Only 0 of 1');
  });
  it('handles cross-year dates and source URL safety', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(sourceHost('https://example.org/news')).toBe('example.org');
    expect(sourceHost('http://example.org/news')).toBeNull();
    expect(sourceHost('not a url')).toBeNull();
    expect(() => plan(reviewed(generate(batch)), policy, '2027-02-30', 1)).toThrow('valid start');
  });
  it('runs init → generate → review → check → plan in an isolated repo without touching live content', () => {
    const root = mkdtempSync(join(tmpdir(), 'stat-window-factory-'));
    const cli = fileURLToPath(new URL('./cli.ts', import.meta.url));
    const run = (...args: string[]) => spawnSync(process.execPath,
      ['--experimental-strip-types', cli, ...args],
      { env: { ...process.env, QUESTION_FACTORY_ROOT: root }, encoding: 'utf8' });
    try {
      mkdirSync(join(root, 'content', 'days'), { recursive: true });
      expect(run('init', '--sport', 'TEST', '--topic', 'Fictional Final').status).toBe(0);
      const dataDir = join(root, 'data', 'question-factory');
      const batchId = 'test-fictional-final';
      const sourcePath = join(dataDir, 'batches', batchId + '.json');
      writeFileSync(sourcePath, JSON.stringify({ ...batch, id: batchId }));
      writeFileSync(join(dataDir, 'policies', 'test.json'), JSON.stringify(policy));
      const generated = run('generate', '--batch', batchId);
      expect(generated.status, generated.stderr).toBe(0);
      const candidatesFile = join(dataDir, 'candidates', batchId + '.json');
      const draft = JSON.parse(readFileSync(candidatesFile, 'utf8')) as CandidateBatch;
      expect(draft.candidates).toHaveLength(5);
      expect(draft.candidates.every((c) => c.review.status === 'draft')).toBe(true);
      const approved = reviewed(draft);
      writeFileSync(candidatesFile, JSON.stringify(approved));
      const check = run('check', '--batch', batchId);
      expect(check.status, check.stderr).toBe(0);
      const planned = run('plan', '--batch', batchId, '--start', '2027-01-06', '--days', '1');
      expect(planned.status, planned.stderr).toBe(0);
      const proposal = JSON.parse(readFileSync(join(dataDir, 'proposals', batchId + '.json'), 'utf8'));
      expect(proposal.days).toHaveLength(1);
      expect(proposal.days[0].questions).toHaveLength(5);
      expect(() => parseSlate(proposal.days[0])).not.toThrow();
      expect(proposal.warning).toContain('STAGED');
      expect(run('plan', '--batch', batchId, '--start', '2027-01-06', '--days', '1').status).not.toBe(0);
      expect(readFileSync(candidatesFile, 'utf8')).toContain('approved');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

});
