import { describe, expect, it, vi } from 'vitest';
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

  it('keeps choices in memory for the session when storage writes fail (CR-3)', () => {
    const full = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    expect(savePrivacy({ analytics: 'off' }, full).analytics).toBe('off');
    expect(loadPrivacy(full).analytics).toBe('off');
    expect(analyticsAllowed(loadPrivacy(full), false)).toBe(false);
    // "No thanks" (or an untick) holds for the rest of the session, so the next results screen sends nothing.
    savePrivacy({ scores: 'off' }, full);
    expect(scoreIntent(loadPrivacy(full), false)).toBe('skip');
    expect(loadPrivacy(full)).toMatchObject({ analytics: 'off', scores: 'off' });
    // The key and sent days survive too, so "Delete my scores" still knows what to delete.
    const key = scoreKey(full);
    savePrivacy({ scores: 'on', sent: ['2026-11-18'] }, full);
    expect(loadPrivacy(full)).toMatchObject({ key, sent: ['2026-11-18'], analytics: 'off', scores: 'on' });
    // A storage that works is unaffected.
    expect(loadPrivacy(mem()).analytics).toBe('unset');
  });

  it('also holds when reads throw after a failed write', () => {
    const broken = { getItem: vi.fn(() => { throw new Error('blocked'); }), setItem: () => { throw new Error('blocked'); } };
    savePrivacy({ analytics: 'off', scores: 'off' }, broken);
    expect(loadPrivacy(broken)).toMatchObject({ analytics: 'off', scores: 'off' });
  });
});

describe('post-erasure privacy barriers',()=>{
  it('a pending deletion never sends new daily comparisons, even if the old preference is turned back on',()=>{
    const s=mem();
    savePrivacy({scores:'on',deleting:true,key:'a'.repeat(22),sent:['2026-11-18']},s);
    const p=loadPrivacy(s);
    expect(p.deleting).toBe(true);
    expect(scoreIntent(p,false)).toBe('skip');
    expect(scoresShownOn(p,false)).toBe(false);
    savePrivacy({scores:'on'},s);
    expect(scoreIntent(loadPrivacy(s),false)).toBe('skip');
    savePrivacy({scores:'off',deleting:false,key:null,sent:[],done:[]},s);
    expect(loadPrivacy(s).deleting).toBe(false);
  });
});
