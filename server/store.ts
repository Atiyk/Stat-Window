/**
 * Durable store for daily score distributions. Spec: docs/PERCENTILES.md.
 *
 * Production uses Upstash Redis over its REST API (plain fetch, no SDK). Every
 * write is one Lua script, so the duplicate check, the bucket increment and the
 * caps run atomically: two tabs or a retried request can never count twice.
 * `memoryStore()` implements the same contract in-process for tests and local
 * preview; `scripts` are exported so the integration test can run them on a real
 * redis-server.
 */

export type SubmitOutcome =
  | { status: 'stored' | 'duplicate'; total: number; counts: number[]; n: number }
  | { status: 'limited' }
  | { status: 'paused'; scope: 'day' | 'month' };

/** The cost ceiling: two counters of *estimated Upstash commands*, shared by every environment on the database. */
export type BudgetKeys = { day: string; month: string };

export type SubmitKeys = {
  /** One record per hashed browser key per puzzle day and season. */
  sub: string;
  /** Hash of score -> count. */
  dist: string;
  /** Short-lived per-client counter (hashed IP prefix, one minute). */
  rate: string;
  /** Scores stored from one hashed IP prefix today. */
  ipDay: string;
  budget: BudgetKeys;
};

export type Limits = {
  /** Seconds a browser-linked submission record is kept (dedupe + deletion window). */
  subTtl: number;
  /** Seconds an anonymous distribution is kept. */
  distTtl: number;
  /** Estimated commands allowed per UTC day before submissions and reads pause. */
  dailyBudget: number;
  /** Estimated commands allowed per calendar month (UTC) before submissions and reads pause. */
  monthlyBudget: number;
  /** Extra monthly commands only deletion may use, so erasure still works when everything else is paused. */
  eraseReserve: number;
  /** Requests allowed per client per minute (POST and DELETE). */
  ratePerMinute: number;
  /** Scores that may be stored from one IP prefix per UTC day. */
  ipDailyStored: number;
};

export type ScoreStore = {
  submit(keys: SubmitKeys, total: number, limits: Limits): Promise<SubmitOutcome>;
  /** Returns raw counts (index = score) and n, or 'paused' when the budget is spent. */
  read(dist: string, budget: BudgetKeys, limits: Limits): Promise<{ counts: number[]; n: number } | { paused: 'day' | 'month' }>;
  /** Removes browser-linked submissions and their contributions in one call. Returns how many existed. */
  removeMany(pairs: readonly { sub: string; dist: string }[], rate: string, budget: BudgetKeys, limits: Limits): Promise<number | 'paused' | 'limited'>;
};

/**
 * Upstash bills an EVAL as one command plus one per redis.call it runs
 * (https://upstash.com/docs/redis/overall/billing, "Lua scripts"). These are upper bounds
 * per script, charged up front, so the counters never under-count.
 */
export const COST = { submit: 16, read: 6, remove: (pairs: number) => 6 + 4 * pairs } as const;
const DAY_TTL = 2 * 86_400;
const MONTH_TTL = 32 * 86_400;
const IP_DAY_TTL = 26 * 3_600;

/**
 * KEYS: sub, dist, rate, ipDay, budgetDay, budgetMonth.
 * ARGV: total, subTtl, distTtl, dailyBudget, monthlyBudget, ratePerMinute, ipDailyStored, cost, dayTtl, monthTtl, ipDayTtl.
 * The rate check runs first, so a flooding client is turned away before it can spend the shared budget.
 */
export const SUBMIT_LUA = `
local r = redis.call('INCR', KEYS[3])
if r == 1 then redis.call('EXPIRE', KEYS[3], 120) end
if r > tonumber(ARGV[6]) then return {'limited'} end
local cost = tonumber(ARGV[8])
local d = redis.call('INCRBY', KEYS[5], cost)
if d == cost then redis.call('EXPIRE', KEYS[5], ARGV[9]) end
local m = redis.call('INCRBY', KEYS[6], cost)
if m == cost then redis.call('EXPIRE', KEYS[6], ARGV[10]) end
if m > tonumber(ARGV[5]) then return {'paused', 'month'} end
if d > tonumber(ARGV[4]) then return {'paused', 'day'} end
local prev = redis.call('GET', KEYS[1])
if prev then return {'duplicate', tonumber(prev), redis.call('HGETALL', KEYS[2])} end
local s = tonumber(redis.call('GET', KEYS[4]) or '0')
if s >= tonumber(ARGV[7]) then return {'limited'} end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('EXPIRE', KEYS[2], ARGV[3])
if redis.call('INCR', KEYS[4]) == 1 then redis.call('EXPIRE', KEYS[4], ARGV[11]) end
return {'stored', tonumber(ARGV[1]), redis.call('HGETALL', KEYS[2])}
`;

/** KEYS: dist, budgetDay, budgetMonth. ARGV: dailyBudget, monthlyBudget, cost, dayTtl, monthTtl. */
export const READ_LUA = `
local cost = tonumber(ARGV[3])
local d = redis.call('INCRBY', KEYS[2], cost)
if d == cost then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
local m = redis.call('INCRBY', KEYS[3], cost)
if m == cost then redis.call('EXPIRE', KEYS[3], ARGV[5]) end
if m > tonumber(ARGV[2]) then return {'paused', 'month'} end
if d > tonumber(ARGV[1]) then return {'paused', 'day'} end
return {'ok', redis.call('HGETALL', KEYS[1])}
`;

/**
 * KEYS: rate, budgetMonth, then (sub, dist) pairs. ARGV: monthlyBudget + eraseReserve, ratePerMinute, cost, monthTtl.
 * Deletion ignores the daily budget and has its own monthly reserve, so it keeps working when submissions are paused.
 */
export const REMOVE_LUA = `
local r = redis.call('INCR', KEYS[1])
if r == 1 then redis.call('EXPIRE', KEYS[1], 120) end
if r > tonumber(ARGV[2]) then return {'limited'} end
local cost = tonumber(ARGV[3])
local m = redis.call('INCRBY', KEYS[2], cost)
if m == cost then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
if m > tonumber(ARGV[1]) then return {'paused'} end
local removed = 0
for i = 3, #KEYS, 2 do
  local prev = redis.call('GET', KEYS[i])
  if prev then
    redis.call('DEL', KEYS[i])
    local left = redis.call('HINCRBY', KEYS[i + 1], prev, -1)
    if left <= 0 then redis.call('HDEL', KEYS[i + 1], prev) end
    removed = removed + 1
  end
end
return {'ok', removed}
`;

export function countsFromHash(flat: readonly unknown[]): { counts: number[]; n: number } {
  const counts = Array.from({ length: 501 }, () => 0);
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const field = String(flat[i]);
    const value = Number(flat[i + 1]);
    if (!/^\d{1,3}$/.test(field) || !Number.isInteger(value) || value <= 0) continue;
    const s = Number(field);
    if (s <= 500) counts[s] = value;
  }
  // `n` is recomputed from the buckets rather than trusted, so a drifted counter can't skew a percentile.
  return { counts, n: counts.reduce((a, b) => a + b, 0) };
}

export type Eval = (script: string, keys: readonly string[], args: readonly (string | number)[]) => Promise<unknown>;

export function redisStore(evaluate: Eval): ScoreStore {
  return {
    async submit(keys, total, limits) {
      const out = (await evaluate(SUBMIT_LUA, [keys.sub, keys.dist, keys.rate, keys.ipDay, keys.budget.day, keys.budget.month], [
        total, limits.subTtl, limits.distTtl, limits.dailyBudget, limits.monthlyBudget, limits.ratePerMinute, limits.ipDailyStored,
        COST.submit, DAY_TTL, MONTH_TTL, IP_DAY_TTL,
      ])) as [string, unknown?, unknown[]?];
      const [status, second, flat] = out;
      if (status === 'stored' || status === 'duplicate') return { status, total: Number(second), ...countsFromHash(flat ?? []) };
      if (status === 'limited') return { status };
      return { status: 'paused', scope: second === 'month' ? 'month' : 'day' };
    },
    async read(dist, budget, limits) {
      const out = (await evaluate(READ_LUA, [dist, budget.day, budget.month], [limits.dailyBudget, limits.monthlyBudget, COST.read, DAY_TTL, MONTH_TTL])) as [
        string,
        unknown?,
      ];
      if (out[0] !== 'ok') return { paused: out[1] === 'month' ? 'month' : 'day' };
      return countsFromHash((out[1] as unknown[] | undefined) ?? []);
    },
    async removeMany(pairs, rate, budget, limits) {
      const keys = [rate, budget.month, ...pairs.flatMap((p) => [p.sub, p.dist])];
      const out = (await evaluate(REMOVE_LUA, keys, [limits.monthlyBudget + limits.eraseReserve, limits.ratePerMinute, COST.remove(pairs.length), MONTH_TTL])) as [
        string,
        unknown?,
      ];
      if (out[0] === 'limited') return 'limited';
      if (out[0] !== 'ok') return 'paused';
      return Number(out[1]);
    },
  };
}

/** Upstash REST: POST the command as a JSON array, Bearer token. Times out fast so a slow store never stalls a player. */
export function upstashEval(url: string, token: string, fetchImpl: typeof fetch = fetch, timeoutMs = 2500): Eval {
  return async (script, keys, args) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, keys.length, ...keys, ...args.map(String)]),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!res.ok || !body || body.error !== undefined) throw new Error(`store error ${res.status}`);
    return body.result;
  };
}

/** Same contract as the Lua scripts, in memory. TTLs use the injected clock. */
export function memoryStore(now: () => number = Date.now): ScoreStore & { dump(): Map<string, unknown> } {
  const data = new Map<string, { v: unknown; exp: number }>();
  const get = (k: string) => {
    const e = data.get(k);
    if (!e) return undefined;
    if (e.exp && e.exp <= now()) {
      data.delete(k);
      return undefined;
    }
    return e.v;
  };
  const set = (k: string, v: unknown, ttl = 0) => data.set(k, { v, exp: ttl ? now() + ttl * 1000 : (data.get(k)?.exp ?? 0) });
  const incrBy = (k: string, by: number, ttl: number) => {
    const n = ((get(k) as number | undefined) ?? 0) + by;
    if (n === by) set(k, n, ttl);
    else set(k, n);
    return n;
  };
  const hash = (k: string) => (get(k) as Map<string, number> | undefined) ?? new Map<string, number>();
  const spend = (budget: BudgetKeys, cost: number, limits: Limits): 'day' | 'month' | null => {
    const d = incrBy(budget.day, cost, DAY_TTL);
    const m = incrBy(budget.month, cost, MONTH_TTL);
    return m > limits.monthlyBudget ? 'month' : d > limits.dailyBudget ? 'day' : null;
  };
  return {
    dump: () => new Map([...data].map(([k, e]) => [k, e.v])),
    async submit(keys, total, limits) {
      if (incrBy(keys.rate, 1, 120) > limits.ratePerMinute) return { status: 'limited' };
      const paused = spend(keys.budget, COST.submit, limits);
      if (paused) return { status: 'paused', scope: paused };
      const prev = get(keys.sub) as number | undefined;
      if (prev !== undefined) return { status: 'duplicate', total: prev, ...countsFromHash([...hash(keys.dist)].flat()) };
      if (((get(keys.ipDay) as number | undefined) ?? 0) >= limits.ipDailyStored) return { status: 'limited' };
      set(keys.sub, total, limits.subTtl);
      const h = new Map(hash(keys.dist));
      h.set(String(total), (h.get(String(total)) ?? 0) + 1);
      set(keys.dist, h, limits.distTtl);
      incrBy(keys.ipDay, 1, IP_DAY_TTL);
      return { status: 'stored', total, ...countsFromHash([...h].flat()) };
    },
    async read(dist, budget, limits) {
      const paused = spend(budget, COST.read, limits);
      if (paused) return { paused };
      return countsFromHash([...hash(dist)].flat());
    },
    async removeMany(pairs, rate, budget, limits) {
      if (incrBy(rate, 1, 120) > limits.ratePerMinute) return 'limited';
      if (incrBy(budget.month, COST.remove(pairs.length), MONTH_TTL) > limits.monthlyBudget + limits.eraseReserve) return 'paused';
      let removed = 0;
      for (const { sub, dist } of pairs) {
        const prev = get(sub) as number | undefined;
        if (prev === undefined) continue;
        data.delete(sub);
        const h = new Map(hash(dist));
        const left = (h.get(String(prev)) ?? 0) - 1;
        if (left <= 0) h.delete(String(prev));
        else h.set(String(prev), left);
        set(dist, h);
        removed++;
      }
      return removed;
    },
  };
}
