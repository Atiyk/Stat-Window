import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Question, Slate } from '../../src/content/schema.ts';
import { addDays, puzzleDay, puzzleStartUtcMs } from '../../src/engine/daily.ts';
import type { RoundRecord } from '../../src/engine/game.ts';
import { gameReducer } from '../../src/engine/game.ts';
import type { SurvivalCatalog } from '../../src/survival/catalog.ts';
import { addResult, advance, currentRound, endReason, isBetter, isOver, newRun, roundState, runScore, runStatus, survives, type SurvivalRun } from '../../src/survival/engine.ts';
import { eligiblePool, questionLookup, supplyOf } from '../../src/survival/pool.ts';
import { MIN_PASS_STEPS, need, perRunNeed, RULESET, SURVIVAL_ROUNDS, THRESHOLDS, TIER_BY_ROUND, widestPassing } from '../../src/survival/rules.ts';
import { pickRun, prng } from '../../src/survival/select.ts';
import { createSurvivalStore, SURVIVAL_KEY } from '../../src/survival/storage.ts';

const root = join(import.meta.dirname, '..', '..');
const catalog = JSON.parse(readFileSync(join(root, 'content/survival/catalog.json'), 'utf8')) as SurvivalCatalog;
const dayFiles = readdirSync(join(root, 'content/days')).filter((f) => f.endsWith('.json'));
const slates = dayFiles.map((f) => JSON.parse(readFileSync(join(root, 'content/days', f), 'utf8')) as Slate);
const published = slates.map((s) => s.date);
const calendar = JSON.parse(readFileSync(join(root, 'data/nba/calendar.json'), 'utf8')) as { cutover: string; days: { date: string }[]; reserve: string[] };
const CUTOVER = calendar.cutover;
const LAST = calendar.days.at(-1)!.date;
const questions = questionLookup(catalog, slates);

const poolOn = (day: string) => eligiblePool(catalog, day, published);

describe('eligible pool: never today, never the future', () => {
  const days = [addDays(CUTOVER, -1), CUTOVER, addDays(CUTOVER, 1), addDays(CUTOVER, 10), addDays(CUTOVER, 24), LAST, addDays(LAST, 1), addDays(LAST, 30)];
  it.each(days)('on %s every scheduled question is from a day already over', (today) => {
    for (const e of poolOn(today)) {
      if (e.tag.day !== null) expect(e.tag.day < today).toBe(true);
      if (e.tag.notBefore !== null) expect(e.tag.notBefore <= today).toBe(true);
    }
  });

  it('before and on the cutover day, only reserves (today’s puzzle is still being played)', () => {
    for (const d of [addDays(CUTOVER, -1), CUTOVER]) expect(poolOn(d).every((e) => e.tag.day === null)).toBe(true);
  });

  it('exact midnight Eastern: the previous puzzle stays until New York midnight, then unlocks', () => {
    const d2 = addDays(CUTOVER, 1);
    const reset = puzzleStartUtcMs(d2);
    const before = puzzleDay(new Date(reset - 1));
    const after = puzzleDay(new Date(reset));
    expect(before).toBe(CUTOVER);
    expect(after).toBe(d2);
    const unlocked = poolOn(after).filter((e) => e.tag.day === CUTOVER).map((e) => e.id);
    expect(poolOn(before).some((e) => e.tag.day === CUTOVER)).toBe(false);
    expect(unlocked.length).toBeGreaterThan(0);
  });

  it('a day whose file is missing contributes nothing', () => {
    const today = addDays(CUTOVER, 5);
    const without = eligiblePool(catalog, today, published.filter((d) => d !== CUTOVER));
    expect(without.some((e) => e.tag.day === CUTOVER)).toBe(false);
  });

  it('a question whose text gives away a later daily answer waits until that day is over', () => {
    const held = Object.entries(catalog.tags).find(([, t]) => t.leaks?.length && t.day !== null && t.notBefore! > addDays(t.day, 1));
    expect(held).toBeDefined();
    const [id, tag] = held!;
    expect(poolOn(addDays(tag.day!, 1)).some((e) => e.id === id)).toBe(false);
    expect(poolOn(tag.notBefore!).some((e) => e.id === id)).toBe(true);
  });

  it('after the calendar ends the pool holds every NBA question once', () => {
    const all = poolOn(addDays(LAST, 2));
    expect(all.length).toBe(Object.keys(catalog.tags).length);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  it('is deterministic for a date', () => {
    expect(poolOn('2026-12-10')).toEqual(poolOn('2026-12-10'));
  });

  it('only grows as days pass', () => {
    let prev = 0;
    for (let d = addDays(CUTOVER, -1); d <= addDays(LAST, 2); d = addDays(d, 1)) {
      const n = poolOn(d).length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('every eligible id resolves to a question with a source', () => {
    for (const e of poolOn(addDays(LAST, 2))) {
      const q = questions.get(e.id);
      expect(q, e.id).toBeDefined();
      expect(q!.source.url).toMatch(/^https:\/\//);
    }
  });
});

describe('catalog', () => {
  it('every scheduled question’s notBefore is after its own day', () => {
    for (const t of Object.values(catalog.tags)) if (t.day !== null) expect(t.notBefore! > t.day).toBe(true);
  });
  it('reserves in the catalog are exactly the calendar reserve', () => {
    expect(catalog.reserves.map((q) => q.id)).toEqual(calendar.reserve);
    for (const id of calendar.reserve) expect(catalog.tags[id]!.day).toBeNull();
  });
  it('covers every scheduled question', () => {
    const scheduled = slates.filter((s) => s.date >= CUTOVER).flatMap((s) => s.questions.map((q) => q.id));
    for (const id of scheduled) expect(catalog.tags[id], id).toBeDefined();
  });
  it('records the real scale length', () => {
    for (const [id, q] of questions) expect(catalog.tags[id]!.steps).toBe(Math.round((q.max - q.min) / q.step));
  });
});

describe('supply and the beta gate', () => {
  it('fails closed on the cutover (no easy questions yet)', () => {
    const s = supplyOf(poolOn(CUTOVER), CUTOVER);
    expect(s.byTier.easy).toBe(0);
    expect(s.playable).toBe(false);
    expect(s.beta).toBe(false);
  });
  it('passes once enough days have been played, and the first passing day is stable', () => {
    let first: string | null = null;
    for (let d = CUTOVER; d <= addDays(LAST, 2); d = addDays(d, 1)) {
      if (supplyOf(poolOn(d), d).beta) {
        first = d;
        break;
      }
    }
    expect(first).toBe('2026-12-05');
  });
});

describe('picking a run', () => {
  const pool = poolOn('2026-12-20');
  it('20 different questions, each from its round’s tier, every round winnable', () => {
    for (let seed = 1; seed < 200; seed++) {
      const ids = pickRun(pool, seed)!;
      expect(ids).toHaveLength(SURVIVAL_ROUNDS);
      expect(new Set(ids).size).toBe(SURVIVAL_ROUNDS);
      ids.forEach((id, r) => {
        expect(catalog.tags[id]!.tier).toBe(TIER_BY_ROUND[r]);
        expect(widestPassing(catalog.tags[id]!.steps, need(r))).toBeGreaterThanOrEqual(MIN_PASS_STEPS);
      });
    }
  });
  it('same pool and seed, same run', () => {
    expect(pickRun(pool, 1234)).toEqual(pickRun(pool, 1234));
    expect(pickRun(pool, 1234)).not.toEqual(pickRun(pool, 1235));
  });
  it('does not depend on the order the pool arrives in', () => {
    expect(pickRun([...pool].reverse(), 99)).toEqual(pickRun(pool, 99));
  });
  it('fails closed when a tier is short instead of borrowing', () => {
    expect(pickRun(pool.filter((e) => e.tag.tier !== 'easy').concat(pool.filter((e) => e.tag.tier === 'easy').slice(0, 3)), 5)).toBeNull();
    expect(pickRun(poolOn(CUTOVER), 5)).toBeNull();
  });
  it('avoids the last runs’ questions when the pool allows', () => {
    const first = pickRun(pool, 7)!;
    const second = pickRun(pool, 8, new Set(first))!;
    const overlap = second.filter((id) => first.includes(id)).length;
    expect(overlap).toBe(0);
  });
  it('spreads franchises: no franchise more than four times in a run on a full pool', () => {
    const full = poolOn(addDays(LAST, 2));
    for (let seed = 1; seed < 100; seed++) {
      const ids = pickRun(full, seed)!;
      const counts = new Map<string, number>();
      for (const id of ids) {
        const f = catalog.tags[id]!.franchise;
        if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
      }
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(4);
    }
  });
  it('prng is reproducible', () => {
    const a = prng(1);
    const b = prng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('rules', () => {
  it('20 thresholds that never go down, each a winnable score', () => {
    expect(THRESHOLDS).toHaveLength(SURVIVAL_ROUNDS);
    for (let i = 1; i < THRESHOLDS.length; i++) expect(THRESHOLDS[i]!).toBeGreaterThanOrEqual(THRESHOLDS[i - 1]!);
    expect(Math.max(...THRESHOLDS)).toBeLessThan(100);
  });
  it('per-run tier need adds up to 20', () => {
    const n = perRunNeed();
    expect(n.easy + n.medium + n.hard + n.expert).toBe(SURVIVAL_ROUNDS);
  });
  it('widestPassing matches the Daily Five curve (100-step scale: 80 points needs about a tenth)', () => {
    expect(widestPassing(100, 80)).toBe(11);
    expect(widestPassing(100, 100)).toBe(1);
    expect(widestPassing(10, 81)).toBe(1);
  });
});

const rec = (questionId: string, hit: boolean, points: number): RoundRecord => ({ questionId, lo: 0, hi: 1, hit, points, missBy: hit ? 0 : 1 });
const ids = Array.from({ length: SURVIVAL_ROUNDS }, (_, i) => `q${i}`);

describe('engine', () => {
  it('survives only when inside and at or above the minimum', () => {
    expect(survives(rec('q0', true, need(0)), 0)).toBe(true);
    expect(survives(rec('q0', true, need(0) - 1), 0)).toBe(false);
    expect(survives(rec('q0', false, 0), 0)).toBe(false);
    expect(endReason(rec('q0', true, need(0) - 1), 0)).toBe('short');
    expect(endReason(rec('q0', false, 0), 0)).toBe('miss');
  });
  it('a run ends at the first failed round and banks only survived rounds', () => {
    let run = newRun('0000abcd', '2026-12-10', ids);
    run = addResult(run, 0, rec('q0', true, 90));
    run = addResult(run, 1, rec('q1', true, 50));
    run = addResult(run, 2, rec('q2', false, 0));
    expect(runStatus(run)).toBe('lost');
    expect(runScore(run)).toEqual({ rounds: 2, points: 140 });
    // Nothing more can be added after the end.
    expect(addResult(run, 3, rec('q3', true, 99))).toBe(run);
  });
  it('first lock wins: a round cannot be replaced or skipped', () => {
    let run = newRun('0000abcd', '2026-12-10', ids);
    run = addResult(run, 0, rec('q0', true, 60));
    expect(addResult(run, 0, rec('q0', true, 99))).toBe(run);
    expect(addResult(run, 2, rec('q2', true, 99))).toBe(run);
    expect(addResult(run, 1, rec('qX', true, 99))).toBe(run);
  });
  it('twenty survived rounds is a win, and it is over once the last reveal is read', () => {
    let run = newRun('0000abcd', '2026-12-10', ids);
    for (let r = 0; r < SURVIVAL_ROUNDS; r++) run = advance(addResult(run, r, rec(`q${r}`, true, 100)));
    expect(runStatus(run)).toBe('won');
    expect(isOver(run)).toBe(true);
    expect(runScore(run)).toEqual({ rounds: 20, points: 2000 });
  });
  it('refresh mid-reveal shows the same locked round again', () => {
    let run = newRun('0000abcd', '2026-12-10', ids);
    run = addResult(run, 0, rec('q0', true, 60));
    expect(currentRound(run)).toBe(0);
    run = advance(run);
    expect(currentRound(run)).toBe(1);
  });
  it('round state reuses the Daily Five machine: a locked round reloads resolved, never re-lockable', () => {
    const q = [...questions.values()][0]!;
    let run: SurvivalRun = newRun('0000abcd', '2026-12-10', [q.id, ...ids.slice(1)]);
    const fresh = roundState(run, q);
    expect(fresh.phase).toBe('ready');
    const moved = gameReducer(fresh, { type: 'setWindow', window: { lo: q.min, hi: q.min + q.step } });
    const locked = gameReducer(moved, { type: 'lock' });
    run = addResult(run, 0, locked.results[0]!);
    const reloaded = roundState(run, q);
    expect(reloaded.phase).toBe('resolved');
    expect(gameReducer(reloaded, { type: 'lock' })).toBe(reloaded);
  });
  it('best: more rounds, then more points', () => {
    expect(isBetter({ rounds: 5, points: 100 }, { rounds: 4, points: 400 })).toBe(true);
    expect(isBetter({ rounds: 5, points: 100 }, { rounds: 5, points: 101 })).toBe(false);
    expect(isBetter({ rounds: 5, points: 100 }, undefined)).toBe(true);
  });
  it('rejects a run with repeated questions', () => {
    expect(() => newRun('0000abcd', '2026-12-10', [...ids.slice(0, 19), 'q0'])).toThrow();
  });
});

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('survival storage', () => {
  it('a refresh keeps the run, its questions and its locked rounds', () => {
    const s = memoryStorage();
    const a = createSurvivalStore(s);
    a.start(newRun('0000abcd', '2026-12-10', ids));
    a.lock('0000abcd', 0, rec('q0', true, 60));
    const b = createSurvivalStore(s);
    expect(b.load().current!.questionIds).toEqual(ids);
    expect(b.load().current!.results).toHaveLength(1);
  });
  it('two tabs: the second lock of the same round is ignored', () => {
    const s = memoryStorage();
    const a = createSurvivalStore(s);
    const b = createSurvivalStore(s);
    a.start(newRun('0000abcd', '2026-12-10', ids));
    a.lock('0000abcd', 0, rec('q0', true, 60));
    const r = b.lock('0000abcd', 0, rec('q0', true, 99));
    expect(r!.results[0]!.points).toBe(60);
  });
  it('cannot start a second run while one is in play (no free retries)', () => {
    const s = createSurvivalStore(memoryStorage());
    s.start(newRun('0000abcd', '2026-12-10', ids));
    s.lock('0000abcd', 0, rec('q0', true, 60));
    const again = s.start(newRun('1111abcd', '2026-12-10', ids));
    expect(again.id).toBe('0000abcd');
  });
  it('a lock from a run that is no longer current is refused', () => {
    const s = createSurvivalStore(memoryStorage());
    s.start(newRun('0000abcd', '2026-12-10', ids));
    s.lock('0000abcd', 0, rec('q0', false, 0));
    s.advance('0000abcd');
    s.start(newRun('1111abcd', '2026-12-10', ids));
    expect(s.lock('0000abcd', 1, rec('q1', true, 60))).toBeNull();
  });
  it('records the best once the run is over, per ruleset, and remembers recent questions', () => {
    const s = createSurvivalStore(memoryStorage());
    s.start(newRun('0000abcd', '2026-12-10', ids));
    s.lock('0000abcd', 0, rec('q0', true, 60));
    s.advance('0000abcd');
    expect(s.load().best[RULESET]).toBeUndefined();
    s.lock('0000abcd', 1, rec('q1', false, 0));
    s.advance('0000abcd');
    expect(s.load().best[RULESET]).toMatchObject({ rounds: 1, points: 60 });
    s.start(newRun('1111abcd', '2026-12-11', ids));
    expect(s.load().recent[0]).toEqual(ids);
    expect(s.load().started).toBe(2);
  });
  it('a lost run replaced by another tab before its reveal was read still records the best', () => {
    const s = createSurvivalStore(memoryStorage());
    s.start(newRun('0000abcd', '2026-12-10', ids));
    s.lock('0000abcd', 0, rec('q0', true, 60));
    s.advance('0000abcd');
    s.lock('0000abcd', 1, rec('q1', false, 0));
    // No advance: the other tab starts a new run straight away.
    s.start(newRun('1111abcd', '2026-12-10', ids));
    expect(s.load().best[RULESET]).toMatchObject({ rounds: 1, points: 60, runId: '0000abcd' });
  });
  it('a malformed or tampered save is set aside, never crashes', () => {
    const st = memoryStorage();
    st.setItem(SURVIVAL_KEY, '{"version":1,"current":{"id":"zz"}}');
    expect(createSurvivalStore(st).load().current).toBeNull();
    expect(st.getItem(`${SURVIVAL_KEY}:corrupt`)).toContain('zz');
    st.setItem(SURVIVAL_KEY, 'not json');
    expect(createSurvivalStore(st).load()).toMatchObject({ version: 1, current: null });
    // Results that don't match the run's questions are tampering.
    const bad = { version: 1, current: { ...newRun('0000abcd', '2026-12-10', ids), results: [rec('qX', true, 100)] }, best: {}, recent: [], started: 1 };
    st.setItem(SURVIVAL_KEY, JSON.stringify(bad));
    expect(createSurvivalStore(st).load().current).toBeNull();
  });
  it('storage that throws falls back to memory for this page', () => {
    const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const s = createSurvivalStore(throwing);
    s.start(newRun('0000abcd', '2026-12-10', ids));
    expect(s.persistent).toBe(false);
    expect(s.load().current!.id).toBe('0000abcd');
  });
  it('never touches the Daily Five save', () => {
    const st = memoryStorage();
    st.setItem('stat-window:v1', 'daily');
    const s = createSurvivalStore(st);
    s.start(newRun('0000abcd', '2026-12-10', ids));
    expect(st.getItem('stat-window:v1')).toBe('daily');
  });
});

// Guards the shape of what the browser reads.
it('every reserve question passes the same schema as a day file question', async () => {
  const { QuestionSchema } = await import('../../src/content/schema.ts');
  for (const q of catalog.reserves as Question[]) expect(QuestionSchema.safeParse(q).success, q.id).toBe(true);
});
