/**
 * Score submission and daily percentile API (one Vercel Function at /api/scores).
 * Spec, threat model and limits: docs/PERCENTILES.md. Privacy: docs/PRIVACY.md.
 *
 *   POST   /api/scores                    submit today's first completed daily run
 *   GET    /api/scores?day=YYYY-MM-DD     today's distribution (only once n >= threshold)
 *   DELETE /api/scores                    delete this browser's submissions
 *
 * Nothing from the client is trusted: the server re-scores the five windows against
 * the published slate with the shared scoring code, decides eligibility from its own
 * clock, and derives the season from its own config. A browser key is never stored;
 * only a salted hash per day and season is, for at most a week.
 */
import { scoreWindow, toSteps, rangeSteps, type Window } from '../src/engine/scoring.ts';
import { midrankPercentile, PERCENTILE_MIN_SAMPLE } from '../src/engine/percentile.ts';
import { isIsoDay, parseLaunchDay, seasonOf } from '../src/engine/season.ts';
import type { BudgetKeys, Limits, ScoreStore } from './store.ts';

export type ServerSlate = { date: string; questions: { id: string; answer: number; min: number; max: number; step: number }[] };

export type ApiContext = {
  enabled: boolean;
  store: ScoreStore | null;
  /** HMAC key for hashing browser keys and IPs (a server-only secret). */
  secret: string;
  /** Namespaces production, preview and development data so tests never mix with real players. */
  env: string;
  launchDay: string | null;
  loadSlate: (day: string) => Promise<ServerSlate | null>;
  now: () => Date;
  limits: Limits;
  /** Seconds after 00:00 UTC that yesterday's run still counts (started before midnight). */
  graceSeconds: number;
  minSample: number;
  allowedOrigins: readonly string[];
  /** Prefix of the shared cost counters (one budget per database, whatever the environment). */
  budgetPrefix: string;
  /** Per-instance memory, so a paused budget or a limited client stops costing store commands at all. */
  memo: Memo;
};

export type Memo = { pausedUntil: number; limitedUntil: Map<string, number> };
export const newMemo = (): Memo => ({ pausedUntil: 0, limitedUntil: new Map() });

/**
 * Budgets are in estimated Upstash commands (store.ts COST). Upstash Free allows 500K a month;
 * 380K leaves room for the deletion reserve, rate-limited and paused calls, and the export script.
 */
export const DEFAULT_LIMITS: Limits = {
  subTtl: 7 * 86_400,
  distTtl: 400 * 86_400,
  dailyBudget: 14_000,
  monthlyBudget: 380_000,
  eraseReserve: 20_000,
  ratePerMinute: 6,
  ipDailyStored: 30,
  ipDailyCalls: 40,
  ipDailyDeletes: 5,
};
/** Days back that DELETE looks (submission records live 7 days; one more for the grace period). */
const DELETE_DAYS = 8;
export const MAX_BODY = 2_048;
const PLAYER = /^[A-Za-z0-9_-]{22}$/;
const ID = /^[a-z0-9-]{1,80}$/;

/**
 * EU/EEA, UK and Switzerland, including territories with their own ISO codes (Åland, the
 * French outermost regions, Gibraltar and the Crown Dependencies): score submission there needs an explicit yes.
 */
export const CONSENT_COUNTRIES = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH AX GF GP MQ RE YT MF GI JE GG IM'.split(' '),
);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));

async function hmac(secret: string, message: string, hexChars: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, hexChars);
}

/** Today's official day, or yesterday's during the grace period after midnight. */
export function eligibleDay(day: string, now: Date, graceSeconds: number): boolean {
  const today = utcDay(now);
  if (day === today) return true;
  const sinceMidnight = (now.getTime() - Date.parse(`${today}T00:00:00Z`)) / 1000;
  return day === addDays(today, -1) && sinceMidnight < graceSeconds;
}

function keyPrefix(ctx: ApiContext, season: string, day: string) {
  return `sw:v1:${ctx.env}:${season}:${day}`;
}

function budgetKeys(ctx: ApiContext, now: Date): BudgetKeys {
  const month = utcDay(now).slice(0, 7);
  return { day: `${ctx.budgetPrefix}:d:${utcDay(now)}`, month: `${ctx.budgetPrefix}:m:${month}`, erase: `${ctx.budgetPrefix}:e:${month}` };
}

const nextUtcMidnight = (now: Date) => Date.parse(`${addDays(utcDay(now), 1)}T00:00:00Z`);
const nextUtcMonth = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);

function rememberPause(ctx: ApiContext, now: Date, scope: 'day' | 'month') {
  ctx.memo.pausedUntil = scope === 'month' ? nextUtcMonth(now) : nextUtcMidnight(now);
}

function rememberLimited(ctx: ApiContext, client: string, now: Date, until: 'minute' | 'day' = 'minute') {
  if (ctx.memo.limitedUntil.size > 5_000) ctx.memo.limitedUntil.clear();
  ctx.memo.limitedUntil.set(client, until === 'day' ? nextUtcMidnight(now) : (Math.floor(now.getTime() / 60_000) + 1) * 60_000);
}

const isLimited = (ctx: ApiContext, client: string, now: Date) => (ctx.memo.limitedUntil.get(client) ?? 0) > now.getTime();

/** IPv4 as is; IPv6 cut to its /64, so one home or phone network is one client. */
export function ipPrefix(ip: string): string {
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is an IPv4 client.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = ip.includes('::') && tail ? tail.split(':') : [];
  const full = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return full.slice(0, 4).map((h) => h.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

function clientIp(req: Request): string {
  return ipPrefix((req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown');
}

function sameOrigin(req: Request, ctx: ApiContext): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
    return o.host === host || ctx.allowedOrigins.includes(o.origin);
  } catch {
    return false;
  }
}

async function readBody(req: Request): Promise<unknown | undefined> {
  if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return undefined;
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY || !req.body) return undefined;
  // Read at most MAX_BODY bytes, even when no length was declared.
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** Re-scores five windows against the slate. Null when anything doesn't match the published puzzle exactly. */
export function verifyRounds(slate: ServerSlate, rounds: unknown): number | null {
  if (!Array.isArray(rounds) || rounds.length !== 5 || slate.questions.length !== 5) return null;
  const ids = new Set<string>();
  let total = 0;
  for (const [i, q] of slate.questions.entries()) {
    const r = rounds[i] as { id?: unknown; lo?: unknown; hi?: unknown } | undefined;
    if (!r || typeof r.id !== 'string' || !ID.test(r.id) || r.id !== q.id || ids.has(r.id)) return null;
    ids.add(r.id);
    if (typeof r.lo !== 'number' || typeof r.hi !== 'number' || !Number.isFinite(r.lo) || !Number.isFinite(r.hi)) return null;
    const w: Window = { lo: r.lo, hi: r.hi };
    const lo = toSteps(q, w.lo);
    const hi = toSteps(q, w.hi);
    // On the step grid, inside the scale, at least one step wide (the game's own rules).
    const onGrid = (v: number, steps: number) => Math.abs(q.min + steps * q.step - v) <= q.step * 1e-6;
    if (!onGrid(w.lo, lo) || !onGrid(w.hi, hi) || lo < 0 || hi > rangeSteps(q) || hi - lo < 1) return null;
    total += scoreWindow(q, w).points;
  }
  return total;
}

function percentileBody(counts: number[], n: number, score: number | null, ctx: ApiContext) {
  const ready = n >= ctx.minSample;
  const p = ready && score !== null ? midrankPercentile(counts, score) : null;
  return { n, threshold: ctx.minSample, ready, percentile: p ? { rounded: p.rounded, exact: Number(p.exact.toFixed(2)) } : null };
}

export async function handle(req: Request, ctx: ApiContext): Promise<Response> {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return json(405, { status: 'method' }, { Allow: 'GET, POST, DELETE' });
  // The emergency switch stops collection and reads, never deletion (as long as a store and the secret exist).
  if (!ctx.store || !ctx.secret || (!ctx.enabled && req.method !== 'DELETE')) return json(503, { status: 'disabled' });
  if (!sameOrigin(req, ctx)) return json(403, { status: 'origin' });
  const now = ctx.now();
  const asOf = now.toISOString();
  const today = utcDay(now);
  const budget = budgetKeys(ctx, now);
  const paused = req.method !== 'DELETE' && ctx.memo.pausedUntil > now.getTime();
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const day = url.searchParams.get('day');
      // Exactly one parameter, so the edge cache can't be bypassed with junk query strings.
      // The raw query must be exactly ?day=YYYY-MM-DD: the edge cache keys on the raw string, so `&`, `%64ay` and friends would each miss it.
      if (!isIsoDay(day) || url.search !== `?day=${day}` || day > today || day < addDays(today, -1)) return json(422, { status: 'invalid' });
      if (paused) return json(503, { status: 'paused' });
      const season = seasonOf(day, { launchDay: ctx.launchDay });
      const read = await ctx.store.read(`${keyPrefix(ctx, season, day)}:dist`, budget, ctx.limits);
      if ('paused' in read) {
        rememberPause(ctx, now, read.paused);
        return json(503, { status: 'paused' });
      }
      const ready = read.n >= ctx.minSample;
      const counts = ready ? Object.fromEntries(read.counts.flatMap((c, s) => (c > 0 ? [[s, c]] : []))) : undefined;
      // Aggregates only, and only past the threshold, so a tiny day can't reveal one player's score.
      return json(200, { status: 'ok', day, season, n: read.n, threshold: ctx.minSample, ready, counts, asOf }, {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
      });
    }

    const body = (await readBody(req)) as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(422, { status: 'invalid' });
    const ipHash = await hmac(ctx.secret, `ip:${today}:${clientIp(req)}`, 16);
    if (isLimited(ctx, ipHash, now)) return json(429, { status: 'limited' }, { 'Retry-After': '60' });
    const untilMidnight = { 'Retry-After': String(Math.ceil((nextUtcMidnight(now) - now.getTime()) / 1000)) };
    const rate = `sw:v1:${ctx.env}:rl:${ipHash}:${Math.floor(now.getTime() / 60_000)}`;

    if (req.method === 'DELETE') {
      const player = body.player;
      if (typeof player !== 'string' || !PLAYER.test(player)) return json(422, { status: 'invalid' });
      // A network that used up today's deletions is turned away here, before any hashing or store call.
      // Its own memo key, so it never blocks that network's submissions.
      const delClient = `del:${ipHash}`;
      if (isLimited(ctx, delClient, now)) return json(429, { status: 'limited' }, untilMidnight);
      const oldest = addDays(today, -DELETE_DAYS);
      // Only days whose records can still exist; older ones were already unlinked by their TTL.
      const days = [...new Set(Array.isArray(body.days) ? body.days.filter(isIsoDay) : [])].filter((d) => d >= oldest && d <= today).slice(0, DELETE_DAYS + 1);
      const pairs: { sub: string; dist: string }[] = [];
      for (const day of days) {
        for (const season of new Set([seasonOf(day, { launchDay: ctx.launchDay }), 'qa'])) {
          const p = keyPrefix(ctx, season, day);
          pairs.push({ sub: `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`, dist: `${p}:dist` });
        }
      }
      if (pairs.length === 0) return json(200, { status: 'ok', removed: 0 });
      const r = await ctx.store.removeMany(pairs, { rate, ipDay: `sw:v1:${ctx.env}:ipdel:${ipHash}` }, budget, ctx.limits);
      if (typeof r === 'object') {
        if (r.limited === 'day') {
          rememberLimited(ctx, delClient, now, 'day');
          return json(429, { status: 'limited' }, untilMidnight);
        }
        rememberLimited(ctx, ipHash, now);
        return json(429, { status: 'limited' }, { 'Retry-After': '60' });
      }
      if (r === 'paused') return json(503, { status: 'paused' });
      return json(200, { status: 'ok', removed: r });
    }

    // POST: one eligible first completion of today's official puzzle.
    // A network that used up today's submissions is turned away before any store call (its own memo key, so deletion still works).
    const postClient = `post:${ipHash}`;
    if (isLimited(ctx, postClient, now)) return json(429, { status: 'limited' }, untilMidnight);
    const day = body.day;
    if (!isIsoDay(day)) return json(422, { status: 'invalid' });
    if (!eligibleDay(day, now, ctx.graceSeconds)) return json(200, { status: 'ineligible', reason: 'not-today', asOf });
    const country = (req.headers.get('x-vercel-ip-country') ?? '').toUpperCase();
    // Checked before anything identifying is read: where consent is needed, the client asks
    // first and sends no key or windows until the player says yes. Unknown location counts as such a place.
    if (body.consent !== 'granted' && (!country || CONSENT_COUNTRIES.has(country))) {
      return json(409, { status: 'consent-required' });
    }
    // A consent probe (no key yet): the client may now make one and send the run.
    if (body.player === undefined && body.rounds === undefined) return json(200, { status: 'proceed' });
    const player = body.player;
    if (typeof player !== 'string' || !PLAYER.test(player)) return json(422, { status: 'invalid' });
    const slate = await ctx.loadSlate(day);
    if (!slate || slate.date !== day) return json(200, { status: 'ineligible', reason: 'no-puzzle', asOf });
    const total = verifyRounds(slate, body.rounds);
    if (total === null || (body.total !== undefined && body.total !== total)) return json(422, { status: 'invalid' });
    if (paused) return json(503, { status: 'paused' });
    const season = body.test === true ? 'qa' : seasonOf(day, { launchDay: ctx.launchDay });
    const p = keyPrefix(ctx, season, day);
    const out = await ctx.store.submit(
      {
        sub: `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`,
        dist: `${p}:dist`,
        rate,
        ipDay: `sw:v1:${ctx.env}:ipd:${ipHash}`,
        ipCalls: `sw:v1:${ctx.env}:ipc:${ipHash}`,
        budget,
      },
      total,
      ctx.limits,
    );
    if (out.status === 'limited') {
      if (out.until === 'day') {
        rememberLimited(ctx, postClient, now, 'day');
        return json(429, { status: 'limited' }, untilMidnight);
      }
      rememberLimited(ctx, ipHash, now);
      return json(429, { status: 'limited' }, { 'Retry-After': '60' });
    }
    if (out.status === 'paused') {
      rememberPause(ctx, now, out.scope);
      return json(503, { status: 'paused' });
    }
    // First completion wins: a duplicate reports the score that was stored first.
    return json(200, { status: out.status, day, season, score: out.total, ...percentileBody(out.counts, out.n, out.total, ctx), asOf });
  } catch {
    return json(503, { status: 'unavailable' });
  }
}

/** Builds the context from environment variables (server-only; never VITE_-prefixed). */
export function contextFromEnv(env: Record<string, string | undefined>, deps: { store: ScoreStore | null; loadSlate: ApiContext['loadSlate'] }): ApiContext {
  const num = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
  const onVercel = env.VERCEL === '1';
  // Fail closed on Vercel: without a known environment (or an explicit namespace) nothing is
  // collected, so preview or test traffic can never land in the production cohort by accident.
  const named = env.SCORES_NAMESPACE && /^[a-z0-9-]{1,24}$/.test(env.SCORES_NAMESPACE) ? env.SCORES_NAMESPACE : null;
  const ns = named ?? (env.VERCEL_ENV === 'production' ? 'production' : env.VERCEL_ENV === 'preview' ? 'preview' : onVercel ? '' : 'development');
  // On Vercel the hash secret must be its own long random value (never a database token, which rotates).
  const secret = env.SCORE_HASH_SECRET && (!onVercel || env.SCORE_HASH_SECRET.length >= 32) ? env.SCORE_HASH_SECRET : onVercel ? '' : 'local-development-only';
  // The 100-game floor holds everywhere, whatever the namespace is called. Only the explicit test-only
  // switch lowers it, and that switch is ignored on a production deployment or in the production namespace.
  const lowSampleForTests = env.SCORES_TEST_LOW_SAMPLE === '1' && env.VERCEL_ENV !== 'production' && ns !== 'production';
  const requested = num(env.PERCENTILE_MIN_SAMPLE, PERCENTILE_MIN_SAMPLE);
  const minSample = lowSampleForTests ? requested : Math.max(PERCENTILE_MIN_SAMPLE, requested);
  return {
    enabled: env.SCORES_ENABLED === '1' && ns !== '',
    store: deps.store,
    secret: ns === '' ? '' : secret,
    env: ns,
    launchDay: parseLaunchDay(env.LAUNCH_DAY ?? env.VITE_LAUNCH_DAY),
    loadSlate: deps.loadSlate,
    now: () => new Date(),
    limits: {
      ...DEFAULT_LIMITS,
      dailyBudget: num(env.SCORES_DAILY_BUDGET, DEFAULT_LIMITS.dailyBudget),
      // Can only be lowered: the monthly ceiling is what keeps Upstash Free inside its 500K commands.
      monthlyBudget: Math.min(num(env.SCORES_MONTHLY_BUDGET, DEFAULT_LIMITS.monthlyBudget), DEFAULT_LIMITS.monthlyBudget),
    },
    graceSeconds: 2 * 3600,
    // Production can never show a percentile (or return buckets) from fewer than 100 games.
    minSample,
    allowedOrigins: (env.SCORES_ALLOWED_ORIGINS ?? 'https://stat-window.vercel.app').split(',').map((s) => s.trim()).filter(Boolean),
    budgetPrefix: 'sw:v1:budget',
    memo: newMemo(),
  };
}
