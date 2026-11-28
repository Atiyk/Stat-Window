import { describe, expect, it } from 'vitest';
import { growthReport, parseGrowthCounts, parseVercelGrowthCounts } from './growth-report.mjs';

const day = { from: '2026-11-28', to: '2026-11-28', period: 'daily' };

describe('growth report', () => {
  it('isolates official counts and reports the supported outcomes', () => {
    const text = growthReport(parseGrowthCounts([
      '/,80', '/e/s1/visit/new,10', '/e/s1/visit/return/gap-1/day1,4',
      '/e/s1/visit/return/gap-7plus/day7,2', '/e/s1/start/daily,40',
      '/e/s1/complete/daily/200-299,30', '/e/s1/share/daily/native,3',
      '/e/s1/weekly/share/clipboard,2', '/e/s1/referral/reddit/landing,7',
      '/e/s1/referral/reddit/start,6', '/e/s1/referral/reddit/complete,5',
      '/e/s1/start/challenge,8', '/e/s1/complete/challenge/200-299,5',
      '/e/s1/challenge-open/today/with-score,9', '/e/s1/failure/game,1',
      '/e/s1/failure/comparison,2', '/e/qa/start/daily,999',
      '/e/qa/visit/return/gap-1/day1,999', '/e/referral/reddit/landing,999',
    ].join('\n')), { ...day, usage: 38_000 });

    expect(text).toContain('New browser events: 10 | returning browser-day events: 6');
    expect(text).toContain('Daily starts: 40 | finishes: 30 | aggregate finish ratio: 75% (aggregate, not joined)');
    expect(text).toContain('share/daily: native 3');
    expect(text).toContain('clipboard 2');
    expect(text).toContain('Challenge: playable arrivals 9; starts 8; finishes 5');
    expect(text).toContain('Referral landing / start / complete: reddit 7/6/5');
    expect(text).toContain('Return indicators: D1 4; D7 2 (event counts only');
    expect(text).toContain('Game failures: 1; comparison failures: 2.');
    expect(text).toContain('38000/50000 (76%)');
    expect(text).not.toContain('999');
  });

  it('parses normalized CSV without accepting duplicates, malformed rows or unsafe totals', () => {
    expect([...parseGrowthCounts('\ufeff"path","page views"\r\n"/","1,100"\r\n/e/s1/start/daily\t42')])
      .toEqual([['/', 1100], ['/e/s1/start/daily', 42]]);
    for (const bad of [
      '/e/s1/start/daily,-1', '/e/s1/start/daily,2\n/e/s1/start/daily,3',
      '/e/s1/start/daily,NaN', '"/e/s1/start/daily,5', '/e//start/daily,4',
      '/?day=2026-11-28,1', '/,"1,00"', '/,9007199254740992',
      '/,9007199254740991\n/e/s1/start/daily,1', 'path,count\npath,count',
    ]) expect(() => parseGrowthCounts(bad)).toThrow();
  });

  it('withholds unsupported and inconsistent completion ratios, including zero denominators', () => {
    const report = text => growthReport(parseGrowthCounts(text), day);
    expect(report('/e/s1/start/daily,1')).toContain('aggregate finish ratio: unavailable');
    expect(report('/e/s1/start/daily,0\n/e/s1/complete/daily/200-299,0')).toContain('insufficient denominator');
    expect(report('/e/s1/start/daily,0\n/e/s1/complete/daily/200-299,1')).toContain('finishes exceed starts');
    expect(report('/e/s1/start/daily,30\n/e/s1/complete/daily/200-299,31')).toContain('finishes exceed starts');
  });

  it('uses the sample start and prior round for progression without assuming missing rows equal zero', () => {
    const report = growthReport(parseGrowthCounts([
      '/e/s1/sample/start/daily,60',
      '/e/s1/sample/lock/daily/r1/hit,40', '/e/s1/sample/lock/daily/r1/miss,8',
      '/e/s1/sample/lock/daily/r2/hit,13', '/e/s1/sample/lock/daily/r2/miss,20',
      '/e/s1/sample/lock/daily/r3/hit,20', '/e/s1/sample/lock/daily/r3/miss,14',
      '/e/s1/sample/lock/daily/r4/hit,5',
    ].join('\n')), day);
    expect(report).toContain('Q1 8 miss / 40 hit, reached from prior step 80%');
    expect(report).toContain('Q2 20 miss / 13 hit, reached from prior step 69%');
    expect(report).toContain('Q3 14 miss / 20 hit, reached from prior step inconsistent counts');
    expect(report).toContain('Q4 not supplied / no matching row miss / 5 hit, reached from prior step unavailable');
  });

  it('rejects impossible dates, invalid periods, and noncontiguous or uneven comparison windows', () => {
    const rows = parseGrowthCounts('/e/s1/start/daily,25');
    expect(() => growthReport(rows, { ...day, from: '2026-02-30' })).toThrow('Invalid date');
    expect(() => growthReport(rows, { ...day, to: '2026-11-29' })).toThrow('Daily requires');
    expect(() => growthReport(rows, { ...day, period: 'weekly', to: '2026-12-05' })).toThrow('weekly requires');
    expect(() => growthReport(rows, { ...day, usage: -1 })).toThrow('Invalid usage count');
    expect(() => growthReport(rows, { ...day, previous: rows, previousFrom: '2026-11-26', previousTo: '2026-11-26' })).toThrow('immediately precede');
    expect(() => growthReport(rows, { ...day, previous: rows, previousFrom: '2026-11-26', previousTo: '2026-11-27' })).toThrow('match its length');
    expect(growthReport(rows, { ...day, previous: rows, previousFrom: '2026-11-27', previousTo: '2026-11-27' })).toContain('25 starts; change: 0');
  });
});

describe('Vercel API import', () => {
  const response = {
    query: {
      groupBy: ['requestPath'], since: '2026-11-28T05:00:00.000Z', until: '2026-11-29T05:00:00.000Z',
      filter: "environment eq 'production' and (requestPath eq '/' or startswith(requestPath, '/e/s1/'))",
    },
    data: [{ requestPath: '/e/s1/start/daily', pageviews: 42, visitors: 31 }],
  };
  const parse = obj => parseVercelGrowthCounts(JSON.stringify(obj), day);

  it('imports aggregate pageviews rather than visitors and preserves empty data', () => {
    expect([...parse({ result: response })]).toEqual([['/e/s1/start/daily', 42]]);
    expect([...parse({ ...response, data: [] })]).toEqual([]);
  });

  it('requires a matching Eastern reporting window and complete production groups', () => {
    expect(() => parse({ ...response, query: { ...response.query, since: '2026-11-28T00:00:00Z' } })).toThrow('Eastern dates');
    expect(() => parse({ ...response, data: [...response.data, { requestPath: 'Others', pageviews: 100 }] })).toThrow('omitted individual paths');
    expect(() => parse({ ...response, data: [...response.data, { requestPath: '/e/qa/start/daily', pageviews: 100 }] })).toThrow('outside');
    expect(() => parse({ ...response, query: { ...response.query, filter: 'anything' } })).toThrow('production requestPath');
  });

  it('handles an Eastern daylight-saving transition', () => {
    const query = { ...response.query, since: '2027-03-14T05:00:00.000Z', until: '2027-03-15T04:00:00.000Z' };
    const data = parseVercelGrowthCounts(JSON.stringify({ ...response, query }), { from: '2027-03-14', to: '2027-03-14' });
    expect(data.get('/e/s1/start/daily')).toBe(42);
  });
});
