import { describe, expect, it } from 'vitest';
import { analyticsAllowed, browserSignal, loadPrivacy, newKey, PRIVACY_KEY, savePrivacy, scoreIntent, scoreKey, scoresShownOn } from './privacy';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('privacy choices', () => {
  it('defaults: counting and score comparison on, unless GPC/DNT says otherwise', () => {
    const p = loadPrivacy(mem());
    expect(analyticsAllowed(p, false)).toBe(true);
    expect(analyticsAllowed(p, true)).toBe(false);
    expect(scoreIntent(p, false)).toBe('send');
    expect(scoreIntent(p, true)).toBe('ask');
  });

  it('an explicit choice wins over the default and over GPC/DNT', () => {
    const s = mem();
    savePrivacy({ analytics: 'off', scores: 'off' }, s);
    expect(analyticsAllowed(loadPrivacy(s), false)).toBe(false);
    expect(scoreIntent(loadPrivacy(s), false)).toBe('skip');
    savePrivacy({ analytics: 'on', scores: 'on' }, s);
    expect(analyticsAllowed(loadPrivacy(s), true)).toBe(true);
    expect(scoreIntent(loadPrivacy(s), true)).toBe('send');
  });

  it('reads GPC and DNT', () => {
    expect(browserSignal({ globalPrivacyControl: true } as unknown as Navigator)).toBe(true);
    expect(browserSignal({ doNotTrack: '1' } as unknown as Navigator)).toBe(true);
    expect(browserSignal({ doNotTrack: '0' } as unknown as Navigator)).toBe(false);
  });

  it('the score key is random, URL-safe, 22 characters and stable once made', () => {
    const s = mem();
    const k = scoreKey(s);
    expect(k).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(scoreKey(s)).toBe(k);
    expect(newKey()).not.toBe(newKey());
  });

  it('survives corrupt storage and drops bad fields', () => {
    const s = mem();
    s.setItem(PRIVACY_KEY, '{not json');
    expect(loadPrivacy(s)).toEqual({ analytics: 'unset', scores: 'unset', key: null, sent: [], done: [], asked: false });
    s.setItem(PRIVACY_KEY, JSON.stringify({ analytics: 'maybe', scores: 'on', key: 'short', sent: ['2026-11-18', 'x', 5] }));
    expect(loadPrivacy(s)).toEqual({ analytics: 'unset', scores: 'on', key: null, sent: ['2026-11-18'], done: [], asked: false });
  });

  it('keeps sent days unique, sorted and bounded', () => {
    const s = mem();
    const days = Array.from({ length: 70 }, (_, i) => `2027-01-${String((i % 28) + 1).padStart(2, '0')}`);
    expect(savePrivacy({ sent: [...days, '2026-11-18'] }, s).sent.length).toBeLessThanOrEqual(9);
  });

  it('works with no storage at all', () => {
    expect(savePrivacy({ scores: 'off' }, null).scores).toBe('off');
  });
});

describe('consent where the server asks first', () => {
  it('shows the score switch off, and asks without a network round trip, once a location needed a yes', () => {
    const p = { analytics: 'unset', scores: 'unset', key: null, sent: [], done: [], asked: true } as const;
    expect(scoresShownOn({ ...p, sent: [], done: [] }, false)).toBe(false);
    expect(scoreIntent({ ...p, sent: [], done: [] }, false)).toBe('ask');
    expect(scoresShownOn({ ...p, sent: [], done: [], asked: false }, false)).toBe(true);
  });
});
