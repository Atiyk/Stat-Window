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
  /** `minute`: the per-minute rate; `day`: one of the per-network daily caps (retrying before 00:00 UTC can't help). */
  | { status: 'limited'; until: 'minute' | 'day' }
  | { status: 'paused'; scope: 'day' | 'month' };

/**
 * The cost ceiling: counters of *estimated Upstash commands*, shared by every environment on the database.
 * `day` and `month` pause submissions and reads; `erase` is deletion's own monthly counter, so deleting
 * can never spend the budget everyone else plays on.
 */
export type BudgetKeys = { day: string; month: string; erase: string };

/** Per-client keys for deletion: the one-minute rate counter and today's count of deletions from this network. */
export type RemoveKeys = { rate: string; ipDay: string };

export type SubmitKeys = {
  /** One record per hashed browser key per puzzle day and season. */
  sub: string;
  /** Hash of score -> count. */
  dist: string;
  /** Short-lived per-client counter (hashed IP prefix, one minute). */
  rate: string;
  /** Scores stored from one hashed IP prefix today. */
  ipDay: string;
  /** Submissions from one hashed IP prefix today that got past the rate limit (stored, duplicate or capped). */
  ipCalls: string;
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
  /** Monthly commands deletion may use, on its own counter, so erasure still works when everything else is paused. */
  eraseReserve: number;
  /** Requests allowed per client per minute (POST and DELETE). */
  ratePerMinute: number;
  /** Scores that may be stored from one IP prefix per UTC day. */
  ipDailyStored: number;
  /** Submissions allowed from one IP prefix per UTC day, whatever their outcome (checked before anything is charged). */
  ipDailyCalls: number;
  /** Deletion requests allowed from one IP prefix per UTC day (checked before anything is charged). */
  ipDailyDeletes: number;
};

export type ScoreStore = {
  submit(keys: SubmitKeys, total: number, limits: Limits): Promise<SubmitOutcome>;
  /** Returns raw counts (index = score) and n, or 'paused' when the budget is spent. */
  read(dist: string, budget: BudgetKeys, limits: Limits): Promise<{ counts: number[]; n: number } | { paused: 'day' | 'month' }>;
  /** Removes browser-linked submissions and their contributions in one call. Returns how many existed. */
  removeMany(
    pairs: readonly { sub: string; dist: string }[],
    client: RemoveKeys,
    budget: BudgetKeys,
    limits: Limits,
  ): Promise<number | 'paused' | { limited: 'minute' | 'day' }>;
};

/**
 * Upstash bills an EVAL as one command plus one per redis.call it runs
 * (https://upstash.com/docs/redis/overall/billing, "Lua scripts"). These are upper bounds
 * per script, charged up front, so the counters never under-count.
 */
export const COST = {
  submit: 20,
  /** A resend of a run already stored: checked before the full charge, and it stops after the GET and HGETALL. */
  duplicate: 13,
  read: 8,
  /** Deletion's upper bound, checked against the erase reserve before any record is read. */
  remove: (pairs: number) => 8 + 4 * pairs,
  /** What deletion actually spends: a GET per pair, plus DEL, HINCRBY and HDEL for each record that existed. */
  removeSpent: (pairs: number, removed: number) => 8 + pairs + 3 * removed,
} as const;
const DAY_TTL = 2 * 86_400;
const MONTH_TTL = 32 * 86_400;
const IP_DAY_TTL = 26 * 3_600;

/**
 * KEYS: sub, dist, rate, ipDay, budgetDay, budgetMonth, ipCalls.
 * ARGV: total, subTtl, distTtl, dailyBudget, monthlyBudget, ratePerMinute, ipDailyStored, cost, dayTtl, monthTtl, ipDayTtl,
 *       ipDailyCalls, duplicateCost.
 * The per-minute rate and the per-network daily call cap run first, and the duplicate check before the charge,
 * so neither a flood nor endless resends of one run can spend more than a small, fixed share of the shared budget.
 */
export const SUBMIT_LUA = `
local r = redis.call('INCR', KEYS[3])
if r == 1 then redis.call('EXPIRE', KEYS[3], 120) end
if r > tonumber(ARGV[6]) then return {'limited', 'minute'} end
local c = redis.call('INCR', KEYS[7])
if c == 1 then redis.call('EXPIRE', KEYS[7], ARGV[11]) end
if c > tonumber(ARGV[12]) then return {'limited', 'day'} end
local prev = redis.call('GET', KEYS[1])
local cost = tonumber(ARGV[8])
if prev then cost = tonumber(ARGV[13]) end
-- Read first: a paused call charges nothing, so it can't eat the deletion reserve.
if tonumber(redis.call('GET', KEYS[6]) or '0') + cost > tonumber(ARGV[5]) then return {'paused', 'month'} end
if tonumber(redis.call('GET', KEYS[5]) or '0') + cost > tonumber(ARGV[4]) then return {'paused', 'day'} end
if redis.call('INCRBY', KEYS[5], cost) == cost then redis.call('EXPIRE', KEYS[5], ARGV[9]) end
if redis.call('INCRBY', KEYS[6], cost) == cost then redis.call('EXPIRE', KEYS[6], ARGV[10]) end
if prev then return {'duplicate', tonumber(prev), redis.call('HGETALL', KEYS[2])} end
local s = tonumber(redis.call('GET', KEYS[4]) or '0')
if s >= tonumber(ARGV[7]) then return {'limited', 'day'} end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('EXPIRE', KEYS[2], ARGV[3])
if redis.call('INCR', KEYS[4]) == 1 then redis.call('EXPIRE', KEYS[4], ARGV[11]) end
return {'stored', tonumber(ARGV[1]), redis.call('HGETALL', KEYS[2])}
`;

/** KEYS: dist, budgetDay, budgetMonth. ARGV: dailyBudget, monthlyBudget, cost, dayTtl, monthTtl. */
export const READ_LUA = `
local cost = tonumber(ARGV[3])
if tonumber(redis.call('GET', KEYS[3]) or '0') + cost > tonumber(ARGV[2]) then return {'paused', 'month'} end
if tonumber(redis.call('GET', KEYS[2]) or '0') + cost > tonumber(ARGV[1]) then return {'paused', 'day'} end
if redis.call('INCRBY', KEYS[2], cost) == cost then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
if redis.call('INCRBY', KEYS[3], cost) == cost then redis.call('EXPIRE', KEYS[3], ARGV[5]) end
return {'ok', redis.call('HGETALL', KEYS[1])}
`;

/**
 * KEYS: rate, ipDay (deletions from this network today), budgetErase, then (sub, dist) pairs.
 * ARGV: eraseReserve, ratePerMinute, maxCost, monthTtl, ipDailyDeletes, ipDayTtl, pairs.
 * Deletion never touches the shared day/month counters: it spends its own monthly counter (capped at the
 * erase reserve), so a deletion flood can only use up deletion, and only a few calls a day per network.
 * Both per-client caps run before anything is charged; the charge is what the call really cost.
 */
export const REMOVE_LUA = `
local r = redis.call('INCR', KEYS[1])
if r == 1 then redis.call('EXPIRE', KEYS[1], 120) end
if r > tonumber(ARGV[2]) then return {'limited', 'minute'} end
local d = redis.call('INCR', KEYS[2])
if d == 1 then redis.call('EXPIRE', KEYS[2], ARGV[6]) end
if d > tonumber(ARGV[5]) then return {'limited', 'day'} end
if tonumber(redis.call('GET', KEYS[3]) or '0') + tonumber(ARGV[3]) > tonumber(ARGV[1]) then return {'paused'} end
local removed = 0
for i = 4, #KEYS, 2 do
  local prev = redis.call('GET', KEYS[i])
  if prev then
    redis.call('DEL', KEYS[i])
    local left = redis.call('HINCRBY', KEYS[i + 1], prev, -1)
    if left <= 0 then redis.call('HDEL', KEYS[i + 1], prev) end
    removed = removed + 1
  end
end
local cost = 8 + tonumber(ARGV[7]) + 3 * removed
if redis.call('INCRBY', KEYS[3], cost) == cost then redis.call('EXPIRE', KEYS[3], ARGV[4]) end
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
      const out = (await evaluate(SUBMIT_LUA, [keys.sub, keys.dist, keys.rate, keys.ipDay, keys.budget.day, keys.budget.month, keys.ipCalls], [
        total, limits.subTtl, limits.distTtl, limits.dailyBudget, limits.monthlyBudget, limits.ratePerMinute, limits.ipDailyStored,
        COST.submit, DAY_TTL, MONTH_TTL, IP_DAY_TTL, limits.ipDailyCalls, COST.duplicate,
      ])) as [string, unknown?, unknown[]?];
      const [status, second, flat] = out;
      if (status === 'stored' || status === 'duplicate') return { status, total: Number(second), ...countsFromHash(flat ?? []) };
      if (status === 'limited') return { status, until: second === 'day' ? 'day' : 'minute' };
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
    async removeMany(pairs, client, budget, limits) {
      const keys = [client.rate, client.ipDay, budget.erase, ...pairs.flatMap((p) => [p.sub, p.dist])];
      const out = (await evaluate(REMOVE_LUA, keys, [
        limits.eraseReserve, limits.ratePerMinute, COST.remove(pairs.length), MONTH_TTL, limits.ipDailyDeletes, IP_DAY_TTL, pairs.length,
      ])) as [string, unknown?];
      if (out[0] === 'limited') return { limited: out[1] === 'day' ? 'day' : 'minute' };
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
    const used = (k: string) => (get(k) as number | undefined) ?? 0;
    if (used(budget.month) + cost > limits.monthlyBudget) return 'month';
    if (used(budget.day) + cost > limits.dailyBudget) return 'day';
    incrBy(budget.day, cost, DAY_TTL);
    incrBy(budget.month, cost, MONTH_TTL);
    return null;
  };
  return {
    dump: () => new Map([...data].map(([k, e]) => [k, e.v])),
    async submit(keys, total, limits) {
      if (incrBy(keys.rate, 1, 120) > limits.ratePerMinute) return { status: 'limited', until: 'minute' };
      if (incrBy(keys.ipCalls, 1, IP_DAY_TTL) > limits.ipDailyCalls) return { status: 'limited', until: 'day' };
      const prev = get(keys.sub) as number | undefined;
      const paused = spend(keys.budget, prev !== undefined ? COST.duplicate : COST.submit, limits);
      if (paused) return { status: 'paused', scope: paused };
      if (prev !== undefined) return { status: 'duplicate', total: prev, ...countsFromHash([...hash(keys.dist)].flat()) };
      if (((get(keys.ipDay) as number | undefined) ?? 0) >= limits.ipDailyStored) return { status: 'limited', until: 'day' };
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
    async removeMany(pairs, client, budget, limits) {
      if (incrBy(client.rate, 1, 120) > limits.ratePerMinute) return { limited: 'minute' };
      if (incrBy(client.ipDay, 1, IP_DAY_TTL) > limits.ipDailyDeletes) return { limited: 'day' };
      if (((get(budget.erase) as number | undefined) ?? 0) + COST.remove(pairs.length) > limits.eraseReserve) return 'paused';
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
      incrBy(budget.erase, COST.removeSpent(pairs.length, removed), MONTH_TTL);
      return removed;
    },
  };
}
