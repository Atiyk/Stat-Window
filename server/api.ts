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
import { emptyTally, midrankPercentile, PERCENTILE_MIN_SAMPLE, summarizeQuestion, type QuestionOutcome, type QuestionStat } from '../src/engine/percentile.ts';
import { isIsoDay, parseLaunchDay, seasonOf, SEASONS } from '../src/engine/season.ts';
import { LAUNCH_DAY } from '../src/engine/launch-config.ts';
import { puzzleDay, puzzleStartUtcMs, addDays as addPuzzleDays } from '../src/engine/daily.ts';
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
  /** Seconds after 00:00 Eastern that yesterday's run still counts (started before midnight). */
  graceSeconds: number;
  minSample: number;
  allowedOrigins: readonly string[];
  /** Prefix of the shared cost counters (one budget per database, whatever the environment). */
  budgetPrefix: string;
  /** Per-instance memory, so a paused budget or a limited client stops costing store commands at all. */
  memo: Memo;
};

/** `readsPausedUntil`: only GET is paused (its own daily ceiling); submissions and deletion carry on. */
export type Memo = { pausedUntil: number; readsPausedUntil: number; limitedUntil: Map<string, number> };
export const newMemo = (): Memo => ({ pausedUntil: 0, readsPausedUntil: 0, limitedUntil: new Map() });

/**
 * Budgets are in estimated Upstash commands (store.ts COST). Upstash Free allows 500K a month;
 * 380K leaves room for the deletion reserve, rate-limited and paused calls, and the export script.
 * Inside the daily budget, reads may spend at most `readDailyBudget`, and the question comparison
 * pauses first (`question*Ceiling`), so near capacity the overall percentile keeps working longest.
 * Cost model and capacity: docs/PERCENTILES.md "Cost".
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
  readDailyBudget: 4_000,
  questionDailyCeiling: 12_000,
  questionMonthlyCeiling: 340_000,
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
  const today = puzzleDay(now);
  if (day === today) return true;
  const sinceMidnight = (now.getTime() - puzzleStartUtcMs(today)) / 1000;
  return day === addPuzzleDays(today, -1) && sinceMidnight < graceSeconds;
}

function keyPrefix(ctx: ApiContext, season: string, day: string) {
  return `sw:v1:${ctx.env}:${season}:${day}`;
}

function budgetKeys(ctx: ApiContext, now: Date): BudgetKeys {
  const month = utcDay(now).slice(0, 7);
  return {
    day: `${ctx.budgetPrefix}:d:${utcDay(now)}`,
    month: `${ctx.budgetPrefix}:m:${month}`,
    erase: `${ctx.budgetPrefix}:e:${month}`,
    reads: `${ctx.budgetPrefix}:r:${utcDay(now)}`,
  };
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
  // X-Forwarded-For's leftmost address may be supplied by a client and must
  // never grant a new rate-limit bucket. Vercel overwrites X-Real-IP at edge;
  // when it is absent, fall back to one conservative shared bucket.
  return ipPrefix((req.headers.get('x-real-ip') ?? 'unknown').trim() || 'unknown');
}

function sameOrigin(req: Request, ctx: ApiContext): boolean {
  if (req.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    // The Request URL is canonical. Forwarded-Host and Host are client
    // supplied; comparing against either allows a forged origin bypass.
    const supplied = new URL(origin).origin;
    return supplied === new URL(req.url).origin || ctx.allowedOrigins.includes(supplied);
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
  return verifyRun(slate, rounds)?.total ?? null;
}

/**
 * The verified total and, per question, how the window counts (percentile.ts QuestionOutcome).
 * Only these five outcomes are kept, never the windows: `t` is the full scale (how every client
 * records a shot-clock violation; a player can't lock the full scale), `m` a window that misses
 * the answer, `z` a catch too wide to score, otherwise the points.
 */
export function verifyRun(slate: ServerSlate, rounds: unknown): { total: number; outcomes: QuestionOutcome[] } | null {
  if (!Array.isArray(rounds) || rounds.length !== 5 || slate.questions.length !== 5) return null;
  const ids = new Set<string>();
  const outcomes: QuestionOutcome[] = [];
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
    const scored = scoreWindow(q, w);
    total += scored.points;
    outcomes.push(lo === 0 && hi === rangeSteps(q) ? 't' : !scored.hit ? 'm' : scored.points === 0 ? 'z' : scored.points);
  }
  return { total, outcomes };
}

/** The question statistics for a day's slate, in slate order. Null when the comparison is paused or the slate is unknown. */
function questionBody(slate: ServerSlate | null, tallies: Map<string, ReturnType<typeof emptyTally>> | 'paused', minSample: number): QuestionStat[] | null {
  if (!slate || tallies === 'paused' || slate.questions.length !== 5) return null;
  return slate.questions.map((q) => summarizeQuestion(q.id, tallies.get(q.id) ?? emptyTally(), minSample));
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
  const today = puzzleDay(now);
  const budget = budgetKeys(ctx, now);
  const paused = req.method !== 'DELETE' && ctx.memo.pausedUntil > now.getTime();
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const day = url.searchParams.get('day');
      // Exactly one parameter, so the edge cache can't be bypassed with junk query strings.
      // The raw query must be exactly ?day=YYYY-MM-DD: the edge cache keys on the raw string, so `&`, `%64ay` and friends would each miss it.
      if (!isIsoDay(day) || url.search !== `?day=${day}`) return json(422, { status: 'invalid' });
      // A real day outside today/yesterday (a device with a wrong clock, an old tab): nothing to read, no store call,
      // answered like POST's not-today so the browser treats it as "no comparison" rather than an error.
      if (day > today || day < addDays(today, -1)) return json(200, { status: 'ineligible', reason: 'not-today', asOf });
      if (paused || ctx.memo.readsPausedUntil > now.getTime()) return json(503, { status: 'paused' });
      const season = seasonOf(day, { launchDay: ctx.launchDay });
      const p = keyPrefix(ctx, season, day);
      const read = await ctx.store.read({ dist: `${p}:dist`, q: `${p}:q` }, budget, ctx.limits);
      if ('paused' in read) {
        if (read.paused === 'reads') ctx.memo.readsPausedUntil = nextUtcMidnight(now);
        else rememberPause(ctx, now, read.paused);
        return json(503, { status: 'paused' });
      }
      const ready = read.n >= ctx.minSample;
      const counts = ready ? Object.fromEntries(read.counts.flatMap((c, s) => (c > 0 ? [[s, c]] : []))) : undefined;
      // Same read, same cache entry: the five question summaries (statistics only past the gate, per question).
      const questions = questionBody(await ctx.loadSlate(day).catch(() => null), read.questions, ctx.minSample);
      // Aggregates only, and only past the threshold, so a tiny day can't reveal one player's score.
      return json(200, { status: 'ok', day, season, n: read.n, threshold: ctx.minSample, ready, counts, questions, asOf }, {
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
      // Never trust a local day list as an exhaustive erasure ledger. Storage may
      // have been cleared, corrupted, or written by an older browser while the
      // score is still retained. Every DELETE checks this fixed nine-day window in
      // every season that has ever held records, plus QA, whatever the launch day is
      // configured to now: after an emergency rollback the launch day is null again
      // but `s1` records are still in `s1` keys. Bounded at 9 × 3 = 27 pairs.
      const days = Array.from({ length: DELETE_DAYS + 1 }, (_, i) => addDays(today, -i));
      const pairs: { sub: string; dist: string; q: string }[] = [];
      for (const day of days) {
        for (const season of [...SEASONS, 'qa'] as const) {
          const p = keyPrefix(ctx, season, day);
          pairs.push({ sub: `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`, dist: `${p}:dist`, q: `${p}:q` });
        }
      }
      // Still write the HMAC revocation marker when no linked score is found:
      // a delayed POST from another tab may already be in flight.
      const r = await ctx.store.removeMany(pairs, {
        rate, ipDay: `sw:v1:${ctx.env}:ipdel:${ipHash}`,
        revocation: `sw:v1:${ctx.env}:revoked:${await hmac(ctx.secret, `score-browser:${player}`, 32)}`,
      }, budget, ctx.limits);
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
    const run = verifyRun(slate, body.rounds);
    if (run === null || (body.total !== undefined && body.total !== run.total)) return json(422, { status: 'invalid' });
    const { total } = run;
    if (paused) return json(503, { status: 'paused' });
    const season = body.test === true ? 'qa' : seasonOf(day, { launchDay: ctx.launchDay });
    const p = keyPrefix(ctx, season, day);
    const out = await ctx.store.submit(
      {
        sub: `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`,
        dist: `${p}:dist`,
        q: `${p}:q`,
        rate,
        ipDay: `sw:v1:${ctx.env}:ipd:${ipHash}`,
        ipCalls: `sw:v1:${ctx.env}:ipc:${ipHash}`,
        revocation: `sw:v1:${ctx.env}:revoked:${await hmac(ctx.secret, `score-browser:${player}`, 32)}`,
        budget,
      },
      total,
      ctx.limits,
      run.outcomes.map((o, i) => `${slate.questions[i]!.id}:${o}`),
    );
    if (out.status === 'limited') {
      if (out.until === 'day') {
        rememberLimited(ctx, postClient, now, 'day');
        return json(429, { status: 'limited' }, untilMidnight);
      }
      rememberLimited(ctx, ipHash, now);
      return json(429, { status: 'limited' }, { 'Retry-After': '60' });
    }
    if (out.status === 'revoked') return json(409, { status: 'revoked' });
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
  const dailyBudget = num(env.SCORES_DAILY_BUDGET, DEFAULT_LIMITS.dailyBudget);
  // Can only be lowered: the monthly ceiling is what keeps Upstash Free inside its 500K commands.
  const monthlyBudget = Math.min(num(env.SCORES_MONTHLY_BUDGET, DEFAULT_LIMITS.monthlyBudget), DEFAULT_LIMITS.monthlyBudget);
  return {
    enabled: env.SCORES_ENABLED === '1' && ns !== '',
    store: deps.store,
    secret: ns === '' ? '' : secret,
    env: ns,
    // Committed (src/engine/launch-config.ts), so the API season always matches the client label.
    launchDay: parseLaunchDay(LAUNCH_DAY),
    loadSlate: deps.loadSlate,
    now: () => new Date(),
    limits: {
      ...DEFAULT_LIMITS,
      dailyBudget,
      monthlyBudget,
      // The sub-ceilings scale down with a lowered budget, so the question comparison always pauses first
      // and reads can never take the whole day.
      readDailyBudget: Math.min(DEFAULT_LIMITS.readDailyBudget, Math.floor(dailyBudget * 2 / 7)),
      questionDailyCeiling: Math.min(DEFAULT_LIMITS.questionDailyCeiling, Math.floor(dailyBudget * 6 / 7)),
      questionMonthlyCeiling: Math.min(DEFAULT_LIMITS.questionMonthlyCeiling, Math.floor(monthlyBudget * 17 / 19)),
    },
    graceSeconds: 2 * 3600,
    // Production can never show a percentile (or return buckets) from fewer than 100 games.
    minSample,
    allowedOrigins: (env.SCORES_ALLOWED_ORIGINS ?? 'https://stat-window.vercel.app').split(',').map((s) => s.trim()).filter(Boolean),
    budgetPrefix: 'sw:v1:budget',
    memo: newMemo(),
  };
}
