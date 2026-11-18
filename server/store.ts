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
  | { status: 'paused' };

export type SubmitKeys = {
  /** One record per hashed browser key per puzzle day and season. */
  sub: string;
  /** Hash of score -> count, plus field `n`. */
  dist: string;
  /** Per-UTC-day operation counter shared by all endpoints (the hard cost ceiling). */
  budget: string;
  /** Short-lived per-client counter (hashed IP, one minute). */
  rate: string;
};

export type Limits = {
  /** Seconds a browser-linked submission record is kept (dedupe + deletion window). */
  subTtl: number;
  /** Seconds an anonymous distribution is kept. */
  distTtl: number;
  /** Store operations allowed per UTC day before every endpoint pauses. */
  dailyBudget: number;
  /** Submissions allowed per client per minute. */
  ratePerMinute: number;
};

export type ScoreStore = {
  submit(keys: SubmitKeys, total: number, limits: Limits): Promise<SubmitOutcome>;
  /** Returns raw counts (index = score) and n, or 'paused' when the budget is spent. */
  read(dist: string, budget: string, limits: Limits): Promise<{ counts: number[]; n: number } | 'paused'>;
  /** Removes one browser-linked submission and its contribution. Returns whether one existed. */
  remove(sub: string, dist: string, budget: string, limits: Limits): Promise<boolean | 'paused'>;
};

const BUDGET_TTL = 2 * 86_400;

/** KEYS: sub, dist, budget, rate. ARGV: total, subTtl, distTtl, dailyBudget, ratePerMinute, budgetTtl. */
export const SUBMIT_LUA = `
local b = redis.call('INCR', KEYS[3])
if b == 1 then redis.call('EXPIRE', KEYS[3], ARGV[6]) end
if b > tonumber(ARGV[4]) then return {'paused', -1} end
local r = redis.call('INCR', KEYS[4])
if r == 1 then redis.call('EXPIRE', KEYS[4], 120) end
if r > tonumber(ARGV[5]) then return {'limited', -1} end
local prev = redis.call('GET', KEYS[1])
if prev then return {'duplicate', tonumber(prev), redis.call('HGETALL', KEYS[2])} end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('HINCRBY', KEYS[2], 'n', 1)
redis.call('EXPIRE', KEYS[2], ARGV[3])
return {'stored', tonumber(ARGV[1]), redis.call('HGETALL', KEYS[2])}
`;

/** KEYS: dist, budget. ARGV: dailyBudget, budgetTtl. */
export const READ_LUA = `
local b = redis.call('INCR', KEYS[2])
if b == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end
if b > tonumber(ARGV[1]) then return {'paused'} end
return {'ok', redis.call('HGETALL', KEYS[1])}
`;

/** KEYS: sub, dist, budget. ARGV: dailyBudget, budgetTtl. */
export const REMOVE_LUA = `
local b = redis.call('INCR', KEYS[3])
if b == 1 then redis.call('EXPIRE', KEYS[3], ARGV[2]) end
if b > tonumber(ARGV[1]) then return {'paused'} end
local prev = redis.call('GET', KEYS[1])
if not prev then return {'none'} end
redis.call('DEL', KEYS[1])
local left = redis.call('HINCRBY', KEYS[2], prev, -1)
if left <= 0 then redis.call('HDEL', KEYS[2], prev) end
redis.call('HINCRBY', KEYS[2], 'n', -1)
return {'removed'}
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
      const out = (await evaluate(SUBMIT_LUA, [keys.sub, keys.dist, keys.budget, keys.rate], [
        total, limits.subTtl, limits.distTtl, limits.dailyBudget, limits.ratePerMinute, BUDGET_TTL,
      ])) as [string, number, unknown[]?];
      const [status, stored, flat] = out;
      if (status === 'stored' || status === 'duplicate') return { status, total: Number(stored), ...countsFromHash(flat ?? []) };
      if (status === 'limited') return { status };
      return { status: 'paused' };
    },
    async read(dist, budget, limits) {
      const out = (await evaluate(READ_LUA, [dist, budget], [limits.dailyBudget, BUDGET_TTL])) as [string, unknown[]?];
      if (out[0] !== 'ok') return 'paused';
      return countsFromHash(out[1] ?? []);
    },
    async remove(sub, dist, budget, limits) {
      const out = (await evaluate(REMOVE_LUA, [sub, dist, budget], [limits.dailyBudget, BUDGET_TTL])) as [string];
      if (out[0] === 'paused') return 'paused';
      return out[0] === 'removed';
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
  const incr = (k: string, ttl: number) => {
    const n = ((get(k) as number | undefined) ?? 0) + 1;
    if (n === 1) set(k, n, ttl);
    else set(k, n);
    return n;
  };
  const hash = (k: string) => (get(k) as Map<string, number> | undefined) ?? new Map<string, number>();
  const spend = (budget: string, limits: Limits) => incr(budget, BUDGET_TTL) > limits.dailyBudget;
  return {
    dump: () => new Map([...data].map(([k, e]) => [k, e.v])),
    async submit(keys, total, limits) {
      if (spend(keys.budget, limits)) return { status: 'paused' };
      if (incr(keys.rate, 120) > limits.ratePerMinute) return { status: 'limited' };
      const prev = get(keys.sub) as number | undefined;
      if (prev !== undefined) return { status: 'duplicate', total: prev, ...countsFromHash([...hash(keys.dist)].flat()) };
      set(keys.sub, total, limits.subTtl);
      const h = new Map(hash(keys.dist));
      h.set(String(total), (h.get(String(total)) ?? 0) + 1);
      h.set('n', (h.get('n') ?? 0) + 1);
      set(keys.dist, h, limits.distTtl);
      return { status: 'stored', total, ...countsFromHash([...h].flat()) };
    },
    async read(dist, budget, limits) {
      if (spend(budget, limits)) return 'paused';
      return countsFromHash([...hash(dist)].flat());
    },
    async remove(sub, dist, budget, limits) {
      if (spend(budget, limits)) return 'paused';
      const prev = get(sub) as number | undefined;
      if (prev === undefined) return false;
      data.delete(sub);
      const h = new Map(hash(dist));
      const left = (h.get(String(prev)) ?? 0) - 1;
      if (left <= 0) h.delete(String(prev));
      else h.set(String(prev), left);
      h.set('n', (h.get('n') ?? 1) - 1);
      set(dist, h);
      return true;
    },
  };
}
