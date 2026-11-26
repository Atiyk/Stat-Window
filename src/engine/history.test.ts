import { describe, expect, it } from 'vitest';
import { buildHistory, finishedDays, loadOfficialHistory } from './history';
import { testRun, testSlate } from './test-fixtures';
import { BETA } from './season';

const S1 = { launchDay: '2026-11-30' };
const slateFor = (d: string) => testSlate(d);

describe('eligible official history', () => {
  it('keeps only finished, verified, in-season runs and reports the rest', () => {
    const runs = {
      '2026-11-28': testRun(slateFor('2026-11-28')), // beta: excluded from s1
      '2026-11-30': testRun(slateFor('2026-11-30')),
      '2026-12-01': { ...testRun(slateFor('2026-12-01')), advanced: 4 }, // last reveal not finished
      '2026-12-02': { ...testRun(slateFor('2026-12-02')), results: testRun(slateFor('2026-12-02')).results.slice(0, 4) },
      '2026-12-03': testRun(slateFor('2026-12-03')),
      '2026-12-09': testRun(slateFor('2026-12-09')), // future
      'not-a-day': testRun(slateFor('2026-12-04')),
    };
    expect(finishedDays(runs, 's1', S1, '2026-12-05')).toEqual(['2026-11-30', '2026-12-03']);
    const h = buildHistory(runs, 's1', S1, '2026-12-05', { '2026-11-30': slateFor('2026-11-30'), '2026-12-03': null });
    expect(h.records.map((r) => r.day)).toEqual(['2026-11-30']);
    expect(h.unavailable).toEqual(['2026-12-03']);
  });

  it('rejects a tampered score and a run against the wrong slate', () => {
    const slate = slateFor('2026-11-30');
    const run = testRun(slate);
    const inflated = { ...run, results: run.results.map((r, i) => (i === 0 ? { ...r, points: 100 } : r)) };
    const h1 = buildHistory({ '2026-11-30': inflated }, 's1', S1, '2026-12-01', { '2026-11-30': slate });
    expect(h1.records).toHaveLength(0);
    expect(h1.unavailable).toEqual(['2026-11-30']);
    const h2 = buildHistory({ '2026-11-30': run }, 's1', S1, '2026-12-01', { '2026-11-30': slateFor('2026-12-24') });
    expect(h2.unavailable).toEqual(['2026-11-30']);
  });

  it('season isolation both ways: beta history only in beta, s1 only in s1', () => {
    const runs = { '2026-11-20': testRun(slateFor('2026-11-20')), '2026-12-01': testRun(slateFor('2026-12-01')) };
    const slates = { '2026-11-20': slateFor('2026-11-20'), '2026-12-01': slateFor('2026-12-01') };
    expect(buildHistory(runs, 'beta', S1, '2026-12-02', slates).records.map((r) => r.day)).toEqual(['2026-11-20']);
    expect(buildHistory(runs, 's1', S1, '2026-12-02', slates).records.map((r) => r.day)).toEqual(['2026-12-01']);
    expect(buildHistory(runs, 'beta', BETA, '2026-12-02', slates).records).toHaveLength(2);
  });

  it('practice never reaches the history: only the official runs map is read', () => {
    // Practice lives in SaveData.practice, which callers never pass; an empty runs map gives an empty history.
    expect(buildHistory({}, 's1', S1, '2026-12-02', {}).records).toEqual([]);
  });

  it('loads only the days in range, tolerating a failing loader', async () => {
    const runs = { '2026-11-30': testRun(slateFor('2026-11-30')), '2026-12-01': testRun(slateFor('2026-12-01')), '2026-12-02': testRun(slateFor('2026-12-02')) };
    const asked: string[] = [];
    const h = await loadOfficialHistory(runs, 's1', S1, '2026-12-03', async (d) => {
      asked.push(d);
      if (d === '2026-12-02') throw new Error('chunk failed');
      return slateFor(d);
    }, { from: '2026-12-01' });
    expect(asked.sort()).toEqual(['2026-12-01', '2026-12-02']);
    expect(h.records.map((r) => r.day)).toEqual(['2026-12-01']);
    expect(h.unavailable).toEqual(['2026-12-02']);
  });
});
