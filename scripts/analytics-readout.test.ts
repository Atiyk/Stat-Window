import { describe, expect, it } from 'vitest';
import { diffInterval, parseCounts, readout, sum } from './analytics-readout.ts';

describe('analytics readout', () => {
  const sample = [
    'Page,Visitors',
    '/,120',
    '/e/start/daily,40',
    '"/e/first-touch/daily","38"',
    '/e/lock/daily/r1/hit\t20',
    '/e/lock/daily/r1/miss 16',
    '/e/lock/daily/r2/hit,30',
    '/e/complete/daily/200-299,25',
    '/e/complete/daily/300-399,5',
    '/e/share/daily/clipboard,6',
    '/e/share/daily/failed,2',
    '/e/visit/new,1,000',
  ].join('\n');
  it('parses CSV, tab and space separated counts and ignores non-event paths', () => {
    const c = parseCounts(sample);
    expect(c.get('/')).toBeUndefined();
    expect(sum(c, '/e/lock/daily/r1')).toBe(36);
    expect(c.get('/e/visit/new')).toBe(1000);
  });
  it('computes the funnel from the documented equations', () => {
    const rows = readout(parseCounts(sample));
    const get = (m: string) => rows.find((r) => r.metric === m)!;
    expect(get('daily: first touch per start').rate).toBe('95.0%');
    expect(get('daily: round 1 locked per start').rate).toBe('90.0%');
    expect(get('daily: finished all five per round 1 lock').rate).toBe('83.3%');
    // Failed shares are not attempts that reached a share target.
    expect(get('daily: share attempts per finished game').numerator).toBe(6);
    expect(get('daily: share attempts per finished game').rate).toBe('20.0%');
  });
  it('says "not enough data" instead of a rate when the denominator is small', () => {
    const rows = readout(parseCounts('/e/start/daily,3\n/e/first-touch/daily,3'));
    expect(rows.find((r) => r.metric === 'daily: first touch per start')!.rate).toMatch(/^not enough data/);
  });
  it('reads Survival and the experiment from their fixed paths', () => {
    const c = parseCounts(['/e/complete/daily/200-299,100', '/e/survival/start/cta,40', '/e/survival/start/link,10', '/e/survival/start/again,20',
      '/e/survival/reach/r5,35', '/e/survival/end/r1-4/miss,30', '/e/survival/end/r5-8/short,5', '/e/survival/end/r5-8/miss,30', '/e/survival/win,1',
      '/e/x/survival-cta/cta/exposed,50', '/e/x/survival-cta/cta/next-day-start,20'].join('\n'));
    const rows = readout(c);
    const get = (m: string) => rows.find((r) => r.metric === m)!;
    expect(get('survival: starts from the results button per finished daily').rate).toBe('40.0%');
    expect(get('survival: deliberate "Run it again" per first start').rate).toBe('40.0%');
    expect(get('survival: survived round 5 per start').rate).toBe('50.0%');
    expect(get('survival: runs ending in rounds 5-8').numerator).toBe(35);
    expect(get('survival: ends that were inside but under the minimum').numerator).toBe(5);
    expect(get('experiment cta: next-day daily start per exposure').rate).toBe('40.0%');
    expect(get('experiment control: next-day daily start per exposure').rate).toMatch(/^not enough data/);
  });
  it('gives an interval only with enough exposures per arm', () => {
    expect(diffInterval(10, 50, 5, 50)).toBeNull();
    const ci = diffInterval(120, 400, 100, 400)!;
    expect(ci.diff).toBeCloseTo(0.05);
    expect(ci.lo).toBeLessThan(0);
    expect(ci.hi).toBeGreaterThan(0.1);
  });
});
