import { describe, expect, it } from 'vitest';
import { createSaveStore, emptySave, mergeRun, mergeTransferredSave, UNTIMED_PRACTICE_KEY, type SaveData, type StorageLike } from './storage';

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
  it('keeps practice and challenge runs apart from the daily record', () => {
    const storage = memoryStorage();
    const store = createSaveStore(storage);
    store.saveRun('2026-11-15', { results: [r('a', 80)], advanced: 1 }, 'practice');
    const data = createSaveStore(storage).load();
    expect(data.runs).toEqual({});
    expect(data.practice?.['2026-11-15']?.results).toEqual([r('a', 80)]);
  });
  it('preserves untimed practice through other tabs writing daily and timed practice saves', () => {
    const storage = memoryStorage();
    const untimedA = createSaveStore(storage, UNTIMED_PRACTICE_KEY);
    const untimedB = createSaveStore(storage, UNTIMED_PRACTICE_KEY);
    const tabA = createSaveStore(storage);
    const tabB = createSaveStore(storage);
    const day = '2026-11-15';
    const official = { ...r('a', 30), elapsedMs: 1_500 };
    const timed = { ...r('a', 60), elapsedMs: 2_500 };
    const untimed = r('a', 90);
    untimedA.saveRun(day, { results: [untimed], advanced: 0 }, 'practice');
    tabA.saveRun(day, { results: [official], advanced: 1 });
    tabB.saveRun(day, { results: [timed], advanced: 1 }, 'practice');
    untimedB.saveRun(day, { results: [r('a', 5)], advanced: 1 }, 'practice');
    const data = createSaveStore(storage).load();
    expect(data.runs[day]).toEqual({ results: [official], advanced: 1 });
    expect(data.practice?.[day]).toEqual({ results: [timed], advanced: 1 });
    expect(createSaveStore(storage, UNTIMED_PRACTICE_KEY).load().practice?.[day])
      .toEqual({ results: [untimed], advanced: 1 });
  });
  it('loads saves written before practice runs and visits were stored', () => {
    const old = { version: 1, runs: { '2026-11-15': { results: [r('a')], advanced: 1 } }, settings: { sound: false, introSeen: true } };
    const store = createSaveStore(memoryStorage({ 'stat-window:v1': JSON.stringify(old) }));
    expect(store.load().runs['2026-11-15']?.results).toHaveLength(1);
    expect(store.load().settings.introSeen).toBe(true);
  });
  it('never counts a player with saved runs from before visits were recorded as new', () => {
    const old = { version: 1, runs: { '2026-11-15': { results: [r('a')], advanced: 1 } }, settings: { sound: false, introSeen: true } };
    const store = createSaveStore(memoryStorage({ 'stat-window:v1': JSON.stringify(old) }));
    expect(store.recordVisit('2026-11-16')).toEqual({ first: '2026-11-15', last: '2026-11-15' });
    expect(store.load().visits).toEqual({ first: '2026-11-15', last: '2026-11-16' });
  });
  it('records visits: undefined for a new browser, then the previous first and last day', () => {
    const store = createSaveStore(memoryStorage());
    expect(store.recordVisit('2026-11-15')).toBeUndefined();
    expect(store.recordVisit('2026-11-16')).toEqual({ first: '2026-11-15', last: '2026-11-15' });
    expect(store.recordVisit('2026-11-16')).toEqual({ first: '2026-11-15', last: '2026-11-16' });
    // A clock that jumps backwards never rewinds the record.
    store.recordVisit('2026-11-10');
    expect(store.load().visits).toEqual({ first: '2026-11-10', last: '2026-11-16' });
  });
});


describe('timed round persistence', () => {
  it('preserves new elapsed fields without invalidating an older save', () => {
    const storage = memoryStorage();
    const store = createSaveStore(storage);
    const old = r('a');
    const timed = { ...r('b', 0), timedOut: true, elapsedMs: 24000 };
    store.saveRun('2026-11-15', { results: [old, timed], advanced: 2 });
    expect(createSaveStore(storage).load().runs['2026-11-15']?.results).toEqual([old, timed]);
  });
});

it('merges transferred history twice without duplicating or combining attempts', () => {
  const day = '2026-11-15';
  const today = '2026-11-16';
  const guess = { questionId: 'b', round: 1, lo: 23, hi: 31 };
  const here: SaveData = { ...emptySave(), runs: { [day]: { results: [r('a', 90)], advanced: 1 } } };
  const there: SaveData = { ...emptySave(), runs: {
    [day]: { results: [r('a', 5)], advanced: 1 },
    [today]: { results: [r('a', 70)], advanced: 1, guess },
  } };
  const merged = mergeTransferredSave(here, there)!;
  expect(merged.runs).toEqual({ [day]: here.runs[day], [today]: there.runs[today] });
  expect(mergeTransferredSave(merged, there)).toEqual(merged);
});
