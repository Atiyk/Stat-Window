import { describe, expect, it } from 'vitest';
import { createSaveStore, emptySave, mergeRun, type StorageLike } from './storage';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => { data[k] = v; },
  };
}
const r = (id: string, points = 50) => ({ questionId: id, lo: 1, hi: 2, hit: true, points, missBy: 0 });

describe('save store', () => {
  it('starts empty for a new player', () => {
    expect(createSaveStore(memoryStorage()).load()).toEqual(emptySave());
  });
  it('round-trips a run', () => {
    const storage = memoryStorage();
    const store = createSaveStore(storage);
    store.saveRun('2026-11-15', { results: [r('a')], advanced: 0 });
    expect(createSaveStore(storage).load().runs['2026-11-15']).toEqual({ results: [r('a')], advanced: 0 });
  });
  it('survives corrupted JSON by starting fresh and keeping a backup', () => {
    const storage = memoryStorage({ 'stat-window:v1': '{not json' });
    expect(createSaveStore(storage).load()).toEqual(emptySave());
    expect(storage.data['stat-window:v1:corrupt']).toBe('{not json');
  });
  it('rejects tampered data that fails validation', () => {
    const storage = memoryStorage({
      'stat-window:v1': JSON.stringify({ version: 1, runs: { '2026-11-15': { results: [{ questionId: 'a', points: 9999 }] } } }),
    });
    expect(createSaveStore(storage).load()).toEqual(emptySave());
  });
  it('works with no storage at all (private mode, blocked cookies)', () => {
    const store = createSaveStore(null);
    store.saveRun('2026-11-15', { results: [r('a')], advanced: 1 });
    expect(store.load().runs['2026-11-15']?.results).toHaveLength(1);
    expect(store.persistent).toBe(false);
  });
  it('keeps working in memory when setItem throws (quota exceeded)', () => {
    const storage: StorageLike = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    const store = createSaveStore(storage);
    store.saveRun('2026-11-15', { results: [r('a')], advanced: 1 });
    expect(store.load().runs['2026-11-15']?.results).toHaveLength(1);
  });
  it('never lets a second tab overwrite rounds the first tab already locked', () => {
    const storage = memoryStorage();
    const tabA = createSaveStore(storage);
    const tabB = createSaveStore(storage);
    tabA.saveRun('2026-11-15', { results: [r('a', 90), r('b', 10)], advanced: 2 });
    tabB.saveRun('2026-11-15', { results: [r('a', 0)], advanced: 1 });
    expect(createSaveStore(storage).load().runs['2026-11-15']).toEqual({ results: [r('a', 90), r('b', 10)], advanced: 2 });
  });
});

describe('mergeRun', () => {
  it('keeps existing locked rounds and appends new ones', () => {
    expect(mergeRun({ results: [r('a', 90)], advanced: 1 }, { results: [r('a', 5), r('b', 7)], advanced: 1 }))
      .toEqual({ results: [r('a', 90), r('b', 7)], advanced: 1 });
  });
});
