import { describe, expect, it } from 'vitest';
import { referralChannel } from './referral';
import { eventPath, setCohort } from './track';

describe('referral attribution', () => {
  it('recognizes only allowlisted tags and hostnames, with tags taking precedence', () => {
    expect(referralChannel('?utm_source=Twitter&utm_campaign=secret', 'https://reddit.com/r/nba/')).toBe('x');
    expect(referralChannel('', 'https://www.reddit.com/r/nba/?private=value')).toBe('reddit');
    expect(referralChannel('?utm_source=embed', '')).toBe('embed');
    expect(referralChannel('?utm_source=how-to-play', '')).toBe('guide');
    expect(referralChannel('?utm_source=playlin', '')).toBe('playlin');
  });
  it('does not use arbitrary values, object prototype names, internal or spoofed hosts', () => {
    for (const x of ['user@example.com','__proto__','constructor','toString','%3Cscript%3E']) expect(referralChannel('?utm_source='+x, '')).toBeNull();
    expect(referralChannel('', 'https://reddit.com.evil.test/')).toBeNull();
    expect(referralChannel('', 'https://www.statwindow.app/how-to-play.html')).toBeNull();
    expect(referralChannel('', 'javascript:alert(1)')).toBeNull();
  });
  it('retains QA and season isolation for fixed event paths', () => {
    try {
      setCohort('qa');
      expect(eventPath({name:'referral',channel:'x',step:'landing',cohort:'s1'})).toBe('/e/qa/referral/x/landing');
      setCohort('s1');
      expect(eventPath({name:'referral',channel:'playlin',step:'complete'})).toBe('/e/s1/referral/playlin/complete');
    } finally { setCohort('beta'); }
  });
});
