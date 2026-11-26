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

import { emptyTally, MAX_ROUND_POINTS, type QuestionTally } from '../src/engine/percentile.ts';

export type SubmitOutcome =
  | { status: 'stored' | 'duplicate'; total: number; counts: number[]; n: number }
  /** `minute`: the per-minute rate; `day`: one of the per-network daily caps (retrying before 00:00 UTC can't help). */
  | { status: 'limited'; until: 'minute' | 'day' }
  | { status: 'paused'; scope: 'day' | 'month' }
  | { status: 'revoked' };

/**
 * The cost ceiling: counters of *estimated Upstash commands*, shared by every environment on the database.
 * `day` and `month` pause submissions and reads; `erase` is deletion's own monthly counter, so deleting
 * can never spend the budget everyone else plays on.
 */
export type BudgetKeys = {
  day: string;
  month: string;
  erase: string;
  /** Commands spent by reads (GET) today: reads have their own ceiling so they can never starve submissions. */
  reads: string;
};

/** Per-client keys for deletion: the one-minute rate counter and today's count of deletions from this network. */
export type RemoveKeys = { rate: string; ipDay: string; revocation: string };

export type SubmitKeys = {
  /** One record per hashed browser key per puzzle day and season. */
  sub: string;
  /** Hash of score -> count. */
  dist: string;
  /** Hash of `{questionId}:{outcome}` -> count for the same day and season (question comparison). */
  q: string;
  /** Short-lived per-client counter (hashed IP prefix, one minute). */
  rate: string;
  /** Scores stored from one hashed IP prefix today. */
  ipDay: string;
  /** Submissions from one hashed IP prefix today that got past the rate limit (stored, duplicate or capped). */
  ipCalls: string;
  /** HMAC-only tombstone for the random browser code across all days/seasons. */
  revocation: string;
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
  /** Commands reads may spend per UTC day (inside dailyBudget); past it GET pauses, submissions go on. */
  readDailyBudget: number;
  /**
   * Question comparison pauses first: once the day (or month) counter would pass these ceilings, submissions
   * are stored total-only (cheaper) and that day's question statistics are withheld, and reads skip them.
   */
  questionDailyCeiling: number;
  questionMonthlyCeiling: number;
};

/** Raw read: overall buckets, plus the question tallies unless the question comparison is paused. */
export type ReadOutcome = { counts: number[]; n: number; questions: Map<string, QuestionTally> | 'paused' };
export type ReadKeys = { dist: string; q: string };
/** One day/season a browser may have a linked record for. */
export type RemoveTarget = { sub: string; dist: string; q: string };

export type ScoreStore = {
  /**
   * `fields` are the five verified per-question outcomes (`{questionId}:{t|m|z|1..100}`). They are added to the
   * question tally in the same script as the total, or not at all.
   */
  submit(keys: SubmitKeys, total: number, limits: Limits, fields?: readonly string[]): Promise<SubmitOutcome>;
  /** Returns raw counts (index = score) and n, or 'paused' when the budget is spent (`reads`: only reads are paused). */
  read(keys: ReadKeys, budget: BudgetKeys, limits: Limits): Promise<ReadOutcome | { paused: 'day' | 'month' | 'reads' }>;
  /** Removes browser-linked submissions and all their contributions in one call. Returns how many existed. */
  removeMany(
    pairs: readonly RemoveTarget[],
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
  /** A first completion with its five question outcomes: 21 for the total, plus 5 HINCRBY and 1 EXPIRE. */
  submit: 27,
  /** A first completion stored total-only because the question ceiling was reached: 21 plus HSET and EXPIRE of the pause flag. */
  submitTotalOnly: 23,
  /** A resend of a run already stored: checked before the full charge, and it stops after the GET and HGETALL. */
  duplicate: 14,
  /** Three counter GETs, three INCRBY+EXPIRE, HGETALL of the totals and of the question tally. */
  read: 12,
  /** Deletion's upper bound, checked against the erase reserve before any record is read: per pair GET, DEL, 2 for the total, 2 per question. */
  remove: (pairs: number) => 9 + 14 * pairs,
  /**
   * What deletion actually spends: a GET per pair, DEL + HINCRBY + HDEL for each record that existed,
   * and HINCRBY + HDEL for each of its question outcomes (only records stored with questions have any).
   */
  removeSpent: (pairs: number, removed: number, questionFields = 0) => 9 + pairs + 3 * removed + 2 * questionFields,
} as const;
const DAY_TTL = 2 * 86_400;
const MONTH_TTL = 32 * 86_400;
const IP_DAY_TTL = 26 * 3_600;
/** Beyond the 7-day linked-score TTL so a delayed POST cannot recreate deleted data. */
const REVOKED_TTL = 9 * 86_400;

/**
 * KEYS: sub, dist, rate, ipDay, budgetDay, budgetMonth, ipCalls, revocation, q.
 * ARGV: total, subTtl, distTtl, dailyBudget, monthlyBudget, ratePerMinute, ipDailyStored, cost, dayTtl, monthTtl, ipDayTtl,
 *       ipDailyCalls, duplicateCost, totalOnlyCost, questionDailyCeiling, questionMonthlyCeiling, then the question fields.
 * The per-minute rate and the per-network daily call cap run first, and the duplicate check before the charge,
 * so neither a flood nor endless resends of one run can spend more than a small, fixed share of the shared budget.
 * The record keeps the total and, when the questions were counted, the five fields it added, so DELETE can take
 * back exactly those (nothing else about the windows is stored). A record without fields (older versions, or the
 * ceiling) never touches the question tally.
 */
export const SUBMIT_LUA = `
local r = redis.call('INCR', KEYS[3])
if r == 1 then redis.call('EXPIRE', KEYS[3], 120) end
if r > tonumber(ARGV[6]) then return {'limited', 'minute'} end
local c = redis.call('INCR', KEYS[7])
if c == 1 then redis.call('EXPIRE', KEYS[7], ARGV[11]) end
if c > tonumber(ARGV[12]) then return {'limited', 'day'} end
-- A previously erased browser code cannot submit again, even if POST verification
-- started before an atomic DELETE on another tab/server instance.
if redis.call('GET', KEYS[8]) then return {'revoked'} end
local prev = redis.call('GET', KEYS[1])
local month = tonumber(redis.call('GET', KEYS[6]) or '0')
local day = tonumber(redis.call('GET', KEYS[5]) or '0')
local fields = #ARGV - 16
local withQ = false
local cost = tonumber(ARGV[14])
if prev then
  cost = tonumber(ARGV[13])
elseif fields > 0 and month + tonumber(ARGV[8]) <= tonumber(ARGV[16]) and day + tonumber(ARGV[8]) <= tonumber(ARGV[15]) then
  withQ = true
  cost = tonumber(ARGV[8])
end
-- Read first: a paused call charges nothing, so it can't eat the deletion reserve.
if month + cost > tonumber(ARGV[5]) then return {'paused', 'month'} end
if day + cost > tonumber(ARGV[4]) then return {'paused', 'day'} end
if redis.call('INCRBY', KEYS[5], cost) == cost then redis.call('EXPIRE', KEYS[5], ARGV[9]) end
if redis.call('INCRBY', KEYS[6], cost) == cost then redis.call('EXPIRE', KEYS[6], ARGV[10]) end
if prev then return {'duplicate', tonumber(string.match(prev, '^%d+')), redis.call('HGETALL', KEYS[2])} end
local s = tonumber(redis.call('GET', KEYS[4]) or '0')
if s >= tonumber(ARGV[7]) then return {'limited', 'day'} end
local value = ARGV[1]
if withQ then value = ARGV[1] .. ' ' .. table.concat(ARGV, ' ', 17) end
redis.call('SET', KEYS[1], value, 'EX', ARGV[2])
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('EXPIRE', KEYS[2], ARGV[3])
if withQ then
  for i = 17, #ARGV do redis.call('HINCRBY', KEYS[9], ARGV[i], 1) end
  redis.call('EXPIRE', KEYS[9], ARGV[3])
elseif fields > 0 then
  -- This day's question sample is now incomplete: its statistics stay withheld.
  redis.call('HSET', KEYS[9], '!', '1')
  redis.call('EXPIRE', KEYS[9], ARGV[3])
end
if redis.call('INCR', KEYS[4]) == 1 then redis.call('EXPIRE', KEYS[4], ARGV[11]) end
return {'stored', tonumber(ARGV[1]), redis.call('HGETALL', KEYS[2])}
`;

/**
 * KEYS: dist, budgetDay, budgetMonth, budgetReads, q.
 * ARGV: dailyBudget, monthlyBudget, cost, dayTtl, monthTtl, readDailyBudget, questionDailyCeiling, questionMonthlyCeiling.
 * Past the question ceiling the question tally is not read (the third element is 'paused').
 */
export const READ_LUA = `
local cost = tonumber(ARGV[3])
local month = tonumber(redis.call('GET', KEYS[3]) or '0')
if month + cost > tonumber(ARGV[2]) then return {'paused', 'month'} end
local day = tonumber(redis.call('GET', KEYS[2]) or '0')
if day + cost > tonumber(ARGV[1]) then return {'paused', 'day'} end
if tonumber(redis.call('GET', KEYS[4]) or '0') + cost > tonumber(ARGV[6]) then return {'paused', 'reads'} end
if redis.call('INCRBY', KEYS[2], cost) == cost then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
if redis.call('INCRBY', KEYS[3], cost) == cost then redis.call('EXPIRE', KEYS[3], ARGV[5]) end
if redis.call('INCRBY', KEYS[4], cost) == cost then redis.call('EXPIRE', KEYS[4], ARGV[4]) end
local dist = redis.call('HGETALL', KEYS[1])
if month + cost > tonumber(ARGV[8]) or day + cost > tonumber(ARGV[7]) then return {'ok', dist, 'paused'} end
return {'ok', dist, redis.call('HGETALL', KEYS[5])}
`;

/**
 * KEYS: rate, ipDay (deletions from this network today), budgetErase, revocation, then (sub, dist, q) triples.
 * ARGV: eraseReserve, ratePerMinute, maxCost, monthTtl, ipDailyDeletes, ipDayTtl, pairs, revokedTtl.
 * Deletion never touches the shared day/month counters: it spends its own monthly counter (capped at the
 * erase reserve), so a deletion flood can only use up deletion, and only a few calls a day per network.
 * Both per-client caps run before anything is charged; the charge is what the call really cost.
 * A record is `total` (older versions, or stored past the question ceiling) or `total field1 ... field5`;
 * each field is taken back out of the question tally it was added to.
 */
export const REMOVE_LUA = `
local r = redis.call('INCR', KEYS[1])
if r == 1 then redis.call('EXPIRE', KEYS[1], 120) end
if r > tonumber(ARGV[2]) then return {'limited', 'minute'} end
local d = redis.call('INCR', KEYS[2])
if d == 1 then redis.call('EXPIRE', KEYS[2], ARGV[6]) end
if d > tonumber(ARGV[5]) then return {'limited', 'day'} end
if tonumber(redis.call('GET', KEYS[3]) or '0') + tonumber(ARGV[3]) > tonumber(ARGV[1]) then return {'paused'} end
-- Delete and block any already-in-flight submission as ONE atomic operation.
-- Even an empty day list requires a tombstone: an old POST may arrive later.
redis.call('SET', KEYS[4], '1', 'EX', ARGV[8])
local removed = 0
local fields = 0
for i = 5, #KEYS, 3 do
  local prev = redis.call('GET', KEYS[i])
  if prev then
    redis.call('DEL', KEYS[i])
    local k = 0
    for tok in string.gmatch(prev, '%S+') do
      k = k + 1
      if k > 6 then break end
      local h = KEYS[i + 1]
      if k > 1 then
        h = KEYS[i + 2]
        fields = fields + 1
      end
      local left = redis.call('HINCRBY', h, tok, -1)
      if left <= 0 then redis.call('HDEL', h, tok) end
    end
    removed = removed + 1
  end
end
local cost = 9 + tonumber(ARGV[7]) + 3 * removed + 2 * fields
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

const QUESTION_FIELD = /^([a-z0-9-]{1,80}):(t|m|z|[1-9]\d{0,2})$/;

/**
 * Question tallies from the flat HGETALL of the `q` hash, or 'paused' when the day was flagged incomplete.
 * Malformed fields and non-positive counts are ignored, as for the totals.
 */
export function questionsFromHash(flat: readonly unknown[]): Map<string, QuestionTally> | 'paused' {
  const out = new Map<string, QuestionTally>();
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const field = String(flat[i]);
    if (field === '!') return 'paused';
    const value = Number(flat[i + 1]);
    const m = QUESTION_FIELD.exec(field);
    if (!m || !Number.isInteger(value) || value <= 0) continue;
    const t = out.get(m[1]!) ?? emptyTally();
    out.set(m[1]!, t);
    const o = m[2]!;
    if (o === 't') t.timeout += value;
    else if (o === 'm') t.miss += value;
    else if (o === 'z') t.zero += value;
    else if (Number(o) <= MAX_ROUND_POINTS) t.scoring[Number(o)] = value;
  }
  return out;
}

export type Eval = (script: string, keys: readonly string[], args: readonly (string | number)[]) => Promise<unknown>;

export function redisStore(evaluate: Eval): ScoreStore {
  return {
    async submit(keys, total, limits, fields = []) {
      const out = (await evaluate(SUBMIT_LUA, [keys.sub, keys.dist, keys.rate, keys.ipDay, keys.budget.day, keys.budget.month, keys.ipCalls, keys.revocation, keys.q], [
        total, limits.subTtl, limits.distTtl, limits.dailyBudget, limits.monthlyBudget, limits.ratePerMinute, limits.ipDailyStored,
        COST.submit, DAY_TTL, MONTH_TTL, IP_DAY_TTL, limits.ipDailyCalls, COST.duplicate, COST.submitTotalOnly,
        limits.questionDailyCeiling, limits.questionMonthlyCeiling, ...fields,
      ])) as [string, unknown?, unknown[]?];
      const [status, second, flat] = out;
      if (status === 'stored' || status === 'duplicate') return { status, total: Number(second), ...countsFromHash(flat ?? []) };
      if (status === 'limited') return { status, until: second === 'day' ? 'day' : 'minute' };
      if (status === 'revoked') return { status: 'revoked' };
      return { status: 'paused', scope: second === 'month' ? 'month' : 'day' };
    },
    async read(keys, budget, limits) {
      const out = (await evaluate(READ_LUA, [keys.dist, budget.day, budget.month, budget.reads, keys.q], [
        limits.dailyBudget, limits.monthlyBudget, COST.read, DAY_TTL, MONTH_TTL, limits.readDailyBudget, limits.questionDailyCeiling, limits.questionMonthlyCeiling,
      ])) as [string, unknown?, unknown?];
      if (out[0] !== 'ok') return { paused: out[1] === 'month' ? 'month' : out[1] === 'reads' ? 'reads' : 'day' };
      const q = out[2];
      return { ...countsFromHash((out[1] as unknown[] | undefined) ?? []), questions: Array.isArray(q) ? questionsFromHash(q) : 'paused' };
    },
    async removeMany(pairs, client, budget, limits) {
      const keys = [client.rate, client.ipDay, budget.erase, client.revocation, ...pairs.flatMap((p) => [p.sub, p.dist, p.q])];
      const out = (await evaluate(REMOVE_LUA, keys, [
        limits.eraseReserve, limits.ratePerMinute, COST.remove(pairs.length), MONTH_TTL, limits.ipDailyDeletes, IP_DAY_TTL, pairs.length, REVOKED_TTL,
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
  const used = (k: string) => (get(k) as number | undefined) ?? 0;
  const hash = (k: string) => (get(k) as Map<string, number> | undefined) ?? new Map<string, number>();
  const hincr = (k: string, field: string, by: number, ttl?: number) => {
    const h = new Map(hash(k));
    const left = (h.get(field) ?? 0) + by;
    if (left <= 0) h.delete(field);
    else h.set(field, left);
    if (h.size === 0) data.delete(k);
    else set(k, h, ttl);
  };
  const flat = (k: string) => [...hash(k)].flat();
  return {
    dump: () => new Map([...data].map(([k, e]) => [k, e.v])),
    async submit(keys, total, limits, fields = []) {
      if (incrBy(keys.rate, 1, 120) > limits.ratePerMinute) return { status: 'limited', until: 'minute' };
      if (incrBy(keys.ipCalls, 1, IP_DAY_TTL) > limits.ipDailyCalls) return { status: 'limited', until: 'day' };
      if (get(keys.revocation)) return { status: 'revoked' };
      const prev = get(keys.sub) as string | undefined;
      const month = used(keys.budget.month);
      const day = used(keys.budget.day);
      const withQ = prev === undefined && fields.length > 0
        && month + COST.submit <= limits.questionMonthlyCeiling && day + COST.submit <= limits.questionDailyCeiling;
      const cost = prev !== undefined ? COST.duplicate : withQ ? COST.submit : COST.submitTotalOnly;
      if (month + cost > limits.monthlyBudget) return { status: 'paused', scope: 'month' };
      if (day + cost > limits.dailyBudget) return { status: 'paused', scope: 'day' };
      incrBy(keys.budget.day, cost, DAY_TTL);
      incrBy(keys.budget.month, cost, MONTH_TTL);
      if (prev !== undefined) return { status: 'duplicate', total: Number(/^\d+/.exec(prev)?.[0]), ...countsFromHash(flat(keys.dist)) };
      if (used(keys.ipDay) >= limits.ipDailyStored) return { status: 'limited', until: 'day' };
      set(keys.sub, withQ ? [String(total), ...fields].join(' ') : String(total), limits.subTtl);
      hincr(keys.dist, String(total), 1, limits.distTtl);
      if (withQ) for (const f of fields) hincr(keys.q, f, 1, limits.distTtl);
      else if (fields.length > 0) hincr(keys.q, '!', 1, limits.distTtl);
      incrBy(keys.ipDay, 1, IP_DAY_TTL);
      return { status: 'stored', total, ...countsFromHash(flat(keys.dist)) };
    },
    async read(keys, budget, limits) {
      const month = used(budget.month);
      const day = used(budget.day);
      if (month + COST.read > limits.monthlyBudget) return { paused: 'month' };
      if (day + COST.read > limits.dailyBudget) return { paused: 'day' };
      if (used(budget.reads) + COST.read > limits.readDailyBudget) return { paused: 'reads' };
      incrBy(budget.day, COST.read, DAY_TTL);
      incrBy(budget.month, COST.read, MONTH_TTL);
      incrBy(budget.reads, COST.read, DAY_TTL);
      const paused = month + COST.read > limits.questionMonthlyCeiling || day + COST.read > limits.questionDailyCeiling;
      return { ...countsFromHash(flat(keys.dist)), questions: paused ? 'paused' : questionsFromHash(flat(keys.q)) };
    },
    async removeMany(pairs, client, budget, limits) {
      if (incrBy(client.rate, 1, 120) > limits.ratePerMinute) return { limited: 'minute' };
      if (incrBy(client.ipDay, 1, IP_DAY_TTL) > limits.ipDailyDeletes) return { limited: 'day' };
      if (used(budget.erase) + COST.remove(pairs.length) > limits.eraseReserve) return 'paused';
      set(client.revocation, 1, REVOKED_TTL);
      let removed = 0;
      let fields = 0;
      for (const { sub, dist, q } of pairs) {
        const prev = get(sub) as string | undefined;
        if (prev === undefined) continue;
        data.delete(sub);
        const [total, ...outcomes] = prev.split(' ').filter(Boolean).slice(0, 6);
        hincr(dist, total!, -1);
        for (const f of outcomes) hincr(q, f, -1);
        fields += outcomes.length;
        removed++;
      }
      incrBy(budget.erase, COST.removeSpent(pairs.length, removed, fields), MONTH_TTL);
      return removed;
    },
  };
}
