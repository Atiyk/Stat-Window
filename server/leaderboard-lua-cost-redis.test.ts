/**
 * Local Redis 7 billing probe: count each redis.call reached by the actual Lua
 * script on successful and denied branches. Upstash documents EVAL + nested
 * redis.call as billable commands. This does NOT verify hosted Upstash pricing,
 * strict key locking, deployment firewalls or a global spend guarantee.
 *
 * REDIS_URL must point to disposable local/CI Redis, never participant data.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Eval } from './store.ts';
import { respClient } from './resp.ts';
import { LB_COST, PERIODS, blockExpiry, blockLedger, blockNumber, boards, erasureBoardKeys, expiryFor, revocationKey } from './leaderboard.ts';
import { READ_LUA, REMOVE_LUA, SUBMIT_LUA, leaderboardRedis } from './leaderboard-store.ts';

const url = process.env.REDIS_URL;
const root = 'sw:v3:cost-qa-' + Date.now().toString(36);
const day = '2027-11-18';
const person = 'a'.repeat(40);
const caps = [10_000, 20_000, 10_000];

type MeterSample = { kind: 'read' | 'submit' | 'remove'; result: string; commands: number };

/**
 * Use local helper functions rather than replacing the Redis global table.
 * The meter writes its count through the original native call, which is
 * deliberately excluded; the counted cost includes the outer EVAL itself.
 * All current script exits are scalar or one-line table returns. Fail if
 * this invariant changes, so tests cannot silently miss an early denial.
 */
function instrument(source: string): string {
  const returns = source.match(/\breturn (?:\{[^\n]*\}|'[^']*')/g) ?? [];
  const changed = source
    .replaceAll('redis.call(', '__charged(')
    .replace(/\breturn (\{[^\n]*\}|'[^']*')/g, 'return __finish($1)');
  if (returns.length === 0 || (changed.match(/__finish\(/g) ?? []).length !== returns.length) {
    throw new Error('Lua billing meter did not instrument every return');
  }
  return [
    'local __native = redis.call',
    'local __count = 0',
    'local function __charged(...) __count = __count + 1; return __native(...) end',
    'local function __finish(value) __native("SET", KEYS[#KEYS], tostring(__count)); return value end',
    changed,
  ].join('\n');
}

function budget(scope: string): string[] {
  return [
    scope + ':budget:day', scope + ':budget:month',
    scope + ':budget:erase', scope + ':budget:lb-month',
  ];
}
function writeKeys(scope: string, currentDay: string, rateId: string): string[] {
  const b = budget(scope);
  return [
    blockLedger(scope, person, blockNumber(currentDay)),
    ...boards(scope, currentDay, null),
    b[0]!, b[1]!, scope + ':submit:minute:' + rateId,
    b[3]!, scope + ':submit:day:' + rateId,
    revocationKey(scope, person),
  ];
}
function expiry(currentDay: string): number[] {
  return [
    ...PERIODS.map(period => expiryFor(period, currentDay)),
    blockExpiry(blockNumber(currentDay)),
  ];
}
function removeKeys(scope: string, rateId: string): string[] {
  const b = budget(scope);
  return [
    blockLedger(scope, person, blockNumber(day)),
    blockLedger(scope, person, blockNumber(day) - 1),
    b[2]!, scope + ':delete:minute:' + rateId,
    scope + ':delete:day:' + rateId, scope + ':delete:lb-budget',
    revocationKey(scope, person),
    ...erasureBoardKeys(scope, day),
  ];
}

describe.skipIf(!url)('leaderboard Redis Lua command accounting (disposable Redis only)', () => {
  let client: ReturnType<typeof respClient>;
  const samples: MeterSample[] = [];
  let serial = 0;

  beforeAll(() => { client = respClient(url!); });
  afterAll(() => client?.close());

  const evaluate: Eval = async (script, keys, args) => {
    const kind = script === READ_LUA ? 'read' : script === SUBMIT_LUA ? 'submit' : script === REMOVE_LUA ? 'remove' : null;
    if (!kind) throw new Error('Unexpected Lua script passed to billing probe');
    const countKey = root + ':meter:' + serial++;
    const out = await client.evaluate(instrument(script), [...keys, countKey], args);
    const nested = Number(await client.command(['GET', countKey]));
    if (!Number.isInteger(nested) || nested < 1) throw new Error('Invalid or absent billing count');
    const result = kind === 'read' ? String((out as unknown[])[0]) : String(out);
    samples.push({ kind, result, commands: nested + 1 });
    return out;
  };

  it('covers a real score, duplicate, personal/public read, deletion, empty erasure and revocation', async () => {
    const scope = root + ':happy';
    const store = leaderboardRedis(evaluate);
    const b = budget(scope);

    expect(await store.submit(writeKeys(scope, day, 'first'), person, day, 90, caps, expiry(day))).toBe('stored');
    expect(await store.submit(writeKeys(scope, day, 'dup'), person, day, 90, caps, expiry(day))).toBe('duplicate');

    const publicBoard = boards(scope, day, null)[0]!;
    const anonymous = await store.read(publicBoard, b, caps,
      [scope + ':read:minute:anon', scope + ':read:day:anon'],
      [blockLedger(scope, 'anonymous', blockNumber(day)), blockLedger(scope, 'anonymous', blockNumber(day) - 1)], null);
    expect(anonymous).not.toBe('paused');
    expect(anonymous).not.toBe('limited');

    const own = await store.read(publicBoard, b, caps,
      [scope + ':read:minute:own', scope + ':read:day:own'],
      [blockLedger(scope, person, blockNumber(day)), blockLedger(scope, person, blockNumber(day) - 1)], person);
    if (typeof own === 'string') throw new Error('Expected a personal leaderboard');
    expect(own.mine).toMatchObject({ score: 90, rank: 1, days: 1 });

    expect(await store.remove(removeKeys(scope, '1'), person, caps)).toBe('removed');
    expect(await store.remove(removeKeys(scope, '2'), person, caps)).toBe('nothing');
    expect(await store.submit(writeKeys(scope, day, 'after-delete'), person, day, 90, caps, expiry(day))).toBe('revoked');

    expect(samples.map(s => s.result)).toEqual(['stored', 'duplicate', 'ok', 'ok', 'removed', 'nothing', 'revoked']);
    for (const s of samples) {
      const ceiling = s.kind === 'read' ? LB_COST.read
        : s.kind === 'submit' ? LB_COST.submit
        : s.result === 'nothing' ? 18 : 21 + 3 * 4;
      expect(s.commands, s.kind + '/' + s.result + ': exceeded its precharged Redis budget').toBeLessThanOrEqual(ceiling);
    }
  });

  it('meters repeated rate-limit denials, which still use billable Redis calls', async () => {
    const scope = root + ':denials';
    const store = leaderboardRedis(evaluate);
    const b = budget(scope);
    const profile = [blockLedger(scope, person, blockNumber(day)), blockLedger(scope, person, blockNumber(day) - 1)];
    const rate = [scope + ':read:minute:flood', scope + ':read:day:flood'];
    const start = samples.length;
    for (let i = 0; i < 12; i++) {
      expect(await store.read(boards(scope, day, null)[0]!, b, caps, rate, profile, null)).not.toBe('limited');
    }
    expect(await store.read(boards(scope, day, null)[0]!, b, caps, rate, profile, null)).toBe('limited');
    const readSamples = samples.slice(start);
    expect(readSamples).toHaveLength(13);
    expect(readSamples.at(-1)?.result).toBe('limited');
    for (const s of readSamples) expect(s.commands).toBeLessThanOrEqual(LB_COST.read);
    expect(readSamples.at(-1)?.commands).toBeGreaterThan(1); // 429 is not free

    const removalStart = samples.length;
    expect(await store.remove(removeKeys(scope, 'same'), person, caps)).toBe('nothing');
    expect(await store.remove(removeKeys(scope, 'same'), person, caps)).toBe('nothing');
    expect(await store.remove(removeKeys(scope, 'same'), person, caps)).toBe('limited');
    const removeSamples = samples.slice(removalStart);
    expect(removeSamples.map(s => s.result)).toEqual(['nothing', 'nothing', 'limited']);
    for (const s of removeSamples) expect(s.commands).toBeLessThanOrEqual(18);
    expect(removeSamples[2]!.commands).toBeGreaterThan(1); // denied EVAL + GET
  });
});
