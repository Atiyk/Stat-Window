import { describe, expect, it } from 'vitest';
import { parseCounts, readout, sum } from './analytics-readout.ts';

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
});
