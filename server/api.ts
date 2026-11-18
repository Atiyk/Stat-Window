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
import type { Limits, ScoreStore } from './store.ts';

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
};

export const DEFAULT_LIMITS: Limits = { subTtl: 7 * 86_400, distTtl: 400 * 86_400, dailyBudget: 1_500, ratePerMinute: 6 };
export const MAX_BODY = 2_048;
const PLAYER = /^[A-Za-z0-9_-]{22}$/;
const ID = /^[a-z0-9-]{1,80}$/;

/** EU/EEA, UK and Switzerland: score submission there needs an explicit yes. */
export const CONSENT_COUNTRIES = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH'.split(' '),
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
  if (declared > MAX_BODY) return undefined;
  const text = await req.text();
  if (text.length > MAX_BODY) return undefined;
  try {
    return JSON.parse(text);
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
  if (!ctx.enabled || !ctx.store || !ctx.secret) return json(503, { status: 'disabled' });
  if (!sameOrigin(req, ctx)) return json(403, { status: 'origin' });
  const now = ctx.now();
  const asOf = now.toISOString();
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const day = url.searchParams.get('day');
      if (!isIsoDay(day) || day > utcDay(now) || day < addDays(utcDay(now), -1)) return json(422, { status: 'invalid' });
      const season = seasonOf(day, { launchDay: ctx.launchDay });
      const p = keyPrefix(ctx, season, day);
      const read = await ctx.store.read(`${p}:dist`, `sw:v1:${ctx.env}:budget:${utcDay(now)}`, ctx.limits);
      if (read === 'paused') return json(503, { status: 'paused' });
      const ready = read.n >= ctx.minSample;
      const counts = ready ? Object.fromEntries(read.counts.flatMap((c, s) => (c > 0 ? [[s, c]] : []))) : undefined;
      // Aggregates only, and only past the threshold, so a tiny day can't reveal one player's score.
      return json(200, { status: 'ok', day, season, n: read.n, threshold: ctx.minSample, ready, counts, asOf }, {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
      });
    }

    const body = (await readBody(req)) as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') return json(422, { status: 'invalid' });
    const player = body.player;
    if (typeof player !== 'string' || !PLAYER.test(player)) return json(422, { status: 'invalid' });
    const budget = `sw:v1:${ctx.env}:budget:${utcDay(now)}`;

    if (req.method === 'DELETE') {
      const days = Array.isArray(body.days) ? body.days.filter(isIsoDay).slice(0, 60) : [];
      let removed = 0;
      for (const day of new Set(days)) {
        for (const season of new Set([seasonOf(day, { launchDay: ctx.launchDay }), 'qa'])) {
          const p = keyPrefix(ctx, season, day);
          const sub = `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`;
          const r = await ctx.store.remove(sub, `${p}:dist`, budget, ctx.limits);
          if (r === 'paused') return json(503, { status: 'paused' });
          if (r) removed++;
        }
      }
      return json(200, { status: 'ok', removed });
    }

    // POST: one eligible first completion of today's official puzzle.
    const day = body.day;
    if (!isIsoDay(day)) return json(422, { status: 'invalid' });
    if (!eligibleDay(day, now, ctx.graceSeconds)) return json(200, { status: 'ineligible', reason: 'not-today', asOf });
    const country = (req.headers.get('x-vercel-ip-country') ?? '').toUpperCase();
    // Unknown location is treated like a consent-required one.
    if (body.consent !== 'granted' && (!country || CONSENT_COUNTRIES.has(country))) {
      return json(409, { status: 'consent-required' });
    }
    const slate = await ctx.loadSlate(day);
    if (!slate || slate.date !== day) return json(200, { status: 'ineligible', reason: 'no-puzzle', asOf });
    const total = verifyRounds(slate, body.rounds);
    if (total === null || (body.total !== undefined && body.total !== total)) return json(422, { status: 'invalid' });
    const season = body.test === true ? 'qa' : seasonOf(day, { launchDay: ctx.launchDay });
    const p = keyPrefix(ctx, season, day);
    const ip = (req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'unknown';
    const out = await ctx.store.submit(
      {
        sub: `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`,
        dist: `${p}:dist`,
        budget,
        rate: `sw:v1:${ctx.env}:rl:${await hmac(ctx.secret, `ip:${utcDay(now)}:${ip}`, 16)}:${Math.floor(now.getTime() / 60_000)}`,
      },
      total,
      ctx.limits,
    );
    if (out.status === 'limited') return json(429, { status: 'limited' }, { 'Retry-After': '60' });
    if (out.status === 'paused') return json(503, { status: 'paused' });
    // First completion wins: a duplicate reports the score that was stored first.
    return json(200, { status: out.status, day, season, score: out.total, ...percentileBody(out.counts, out.n, out.total, ctx), asOf });
  } catch {
    return json(503, { status: 'unavailable' });
  }
}

/** Builds the context from environment variables (server-only; never VITE_-prefixed). */
export function contextFromEnv(env: Record<string, string | undefined>, deps: { store: ScoreStore | null; loadSlate: ApiContext['loadSlate'] }): ApiContext {
  const num = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);
  return {
    enabled: env.SCORES_ENABLED === '1',
    store: deps.store,
    secret: env.SCORE_HASH_SECRET ?? env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN ?? '',
    env: env.VERCEL_ENV === 'production' ? 'production' : env.VERCEL_ENV === 'preview' ? 'preview' : 'development',
    launchDay: parseLaunchDay(env.LAUNCH_DAY ?? env.VITE_LAUNCH_DAY),
    loadSlate: deps.loadSlate,
    now: () => new Date(),
    limits: { ...DEFAULT_LIMITS, dailyBudget: num(env.SCORES_DAILY_BUDGET, DEFAULT_LIMITS.dailyBudget) },
    graceSeconds: 2 * 3600,
    minSample: num(env.PERCENTILE_MIN_SAMPLE, PERCENTILE_MIN_SAMPLE),
    allowedOrigins: (env.SCORES_ALLOWED_ORIGINS ?? 'https://stat-window.vercel.app').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
