import { readFile } from "node:fs/promises";
import path from "node:path";
/** Number of decimals implied by a step (0.01 -> 2). */
function stepDecimals(step) {
	const s = String(step);
	const dot = s.indexOf(".");
	return dot === -1 ? 0 : s.length - dot - 1;
}
/** Converts a value to integer steps above `min`. */
function toSteps(scale, value) {
	return Math.round((value - scale.min) / scale.step);
}
function rangeSteps(scale) {
	return toSteps(scale, scale.max);
}
function assertLegalWindow(scale, w) {
	const lo = toSteps(scale, w.lo);
	const hi = toSteps(scale, w.hi);
	if (lo < 0 || hi > rangeSteps(scale)) throw new RangeError("Window is outside the scale");
	if (hi - lo < 1) throw new RangeError("Window must be at least one step wide");
}
function isHit(q, w) {
	const f = 10 ** stepDecimals(q.step);
	const a = Math.round(q.answer * f);
	return Math.round(w.lo * f) <= a && a <= Math.round(w.hi * f);
}
function potentialPoints(scale, w) {
	assertLegalWindow(scale, w);
	const range = rangeSteps(scale);
	const fraction = (range - (toSteps(scale, w.hi) - toSteps(scale, w.lo))) / (range - 1);
	return Math.round(100 * fraction * fraction);
}
function scoreWindow(q, w) {
	const points = potentialPoints(q, w);
	if (isHit(q, w)) return {
		hit: true,
		points,
		missBy: 0
	};
	const d = stepDecimals(q.step);
	const gap = q.answer < w.lo ? w.lo - q.answer : q.answer - w.hi;
	return {
		hit: false,
		points: 0,
		missBy: Number(gap.toFixed(d))
	};
}
/** A valid distribution has exactly 501 non-negative integer buckets. */
function isDistribution(x) {
	return Array.isArray(x) && x.length === 501 && x.every((c) => Number.isInteger(c) && c >= 0);
}
function sampleSize(counts) {
	let n = 0;
	for (const c of counts) n += c;
	return n;
}
/**
* Midrank percentile of `score` within `counts`. Returns null for an empty
* population or a score outside 0..500. The player's own submission is expected
* to already be inside `counts` (it was counted when it was stored).
*/
function midrankPercentile(counts, score) {
	if (!Number.isInteger(score) || score < 0 || score > 500) return null;
	if (!isDistribution(counts)) return null;
	const n = sampleSize(counts);
	if (n === 0) return null;
	let below = 0;
	for (let s = 0; s < score; s++) below += counts[s];
	const equal = counts[score];
	const exact = 100 * (below + .5 * equal) / n;
	return {
		exact,
		rounded: Math.min(100, Math.max(0, Math.round(exact))),
		n,
		below,
		equal
	};
}
// src/engine/season.ts
/**
* Public numbering and seasons. Runbook: docs/LAUNCH.md.
*
* Three ideas are kept apart:
* - the canonical puzzle day: the UTC date a slate lives at (content/days/<day>.json).
*   It never changes, so saved runs, published locks and ?day= links stay valid;
* - the season: `beta` (everything today) or the formal launch season `s1`;
* - the public number shown to players. In beta it is the day count from EPOCH_DAY
*   (unchanged from before this module). Once a launch day is configured, that day is
*   "No. 1", the next "No. 2", and every earlier day becomes "Beta No. N".
*
* The launch day is fixed at build time (VITE_LAUNCH_DAY). Unset means beta: the live
* game behaves exactly as before. Non-production builds can preview a launch with
* `?launch-preview=YYYY-MM-DD` when VITE_LAUNCH_PREVIEW=1 (never in production).
*/
var DAY = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDay(s) {
	if (typeof s !== "string" || !DAY.test(s)) return false;
	const d = /* @__PURE__ */ new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
/** A config is only accepted with a real date on or after the beta epoch. */
function parseLaunchDay(raw) {
	return isIsoDay(raw) && raw > "2026-11-15" ? raw : null;
}
/** The season a canonical day belongs to under `config`. */
function seasonOf(day, config) {
	return config.launchDay !== null && day >= config.launchDay ? "s1" : "beta";
}
// server/api.ts
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
var newMemo = () => ({
	pausedUntil: 0,
	limitedUntil: /* @__PURE__ */ new Map()
});
/**
* Budgets are in estimated Upstash commands (store.ts COST). Upstash Free allows 500K a month;
* 380K leaves room for the deletion reserve, rate-limited and paused calls, and the export script.
*/
var DEFAULT_LIMITS = {
	subTtl: 604800,
	distTtl: 3456e4,
	dailyBudget: 14e3,
	monthlyBudget: 38e4,
	eraseReserve: 2e4,
	ratePerMinute: 6,
	ipDailyStored: 10
};
var PLAYER = /^[A-Za-z0-9_-]{22}$/;
var ID = /^[a-z0-9-]{1,80}$/;
/**
* EU/EEA, UK and Switzerland, including territories with their own ISO codes (Åland, the
* French outermost regions, Gibraltar and the Crown Dependencies): score submission there needs an explicit yes.
*/
var CONSENT_COUNTRIES = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH AX GF GP MQ RE YT MF GI JE GG IM".split(" "));
var json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
	status,
	headers: {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		...headers
	}
});
var utcDay = (d) => d.toISOString().slice(0, 10);
var addDays = (day, n) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5));
async function hmac(secret, message, hexChars) {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign"]);
	return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, hexChars);
}
/** Today's official day, or yesterday's during the grace period after midnight. */
function eligibleDay(day, now, graceSeconds) {
	const today = utcDay(now);
	if (day === today) return true;
	const sinceMidnight = (now.getTime() - Date.parse(`${today}T00:00:00Z`)) / 1e3;
	return day === addDays(today, -1) && sinceMidnight < graceSeconds;
}
function keyPrefix(ctx, season, day) {
	return `sw:v1:${ctx.env}:${season}:${day}`;
}
function budgetKeys(ctx, now) {
	return {
		day: `${ctx.budgetPrefix}:d:${utcDay(now)}`,
		month: `${ctx.budgetPrefix}:m:${utcDay(now).slice(0, 7)}`
	};
}
var nextUtcMidnight = (now) => Date.parse(`${addDays(utcDay(now), 1)}T00:00:00Z`);
var nextUtcMonth = (now) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
function rememberPause(ctx, now, scope) {
	ctx.memo.pausedUntil = scope === "month" ? nextUtcMonth(now) : nextUtcMidnight(now);
}
function rememberLimited(ctx, client, now) {
	if (ctx.memo.limitedUntil.size > 5e3) ctx.memo.limitedUntil.clear();
	ctx.memo.limitedUntil.set(client, (Math.floor(now.getTime() / 6e4) + 1) * 6e4);
}
/** IPv4 as is; IPv6 cut to its /64, so one home or phone network is one client. */
function ipPrefix(ip) {
	if (!ip.includes(":")) return ip;
	const [head = "", tail = ""] = ip.toLowerCase().split("::");
	const left = head ? head.split(":") : [];
	const right = ip.includes("::") && tail ? tail.split(":") : [];
	return (ip.includes("::") ? [
		...left,
		...Array(Math.max(0, 8 - left.length - right.length)).fill("0"),
		...right
	] : left).slice(0, 4).map((h) => h.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
function clientIp(req) {
	return ipPrefix((req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown");
}
function sameOrigin(req, ctx) {
	if (req.headers.get("sec-fetch-site") === "cross-site") return false;
	const origin = req.headers.get("origin");
	if (!origin) return true;
	try {
		const o = new URL(origin);
		const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
		return o.host === host || ctx.allowedOrigins.includes(o.origin);
	} catch {
		return false;
	}
}
async function readBody(req) {
	if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return void 0;
	if (Number(req.headers.get("content-length") ?? 0) > 2048 || !req.body) return void 0;
	const reader = req.body.getReader();
	const chunks = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > 2048) {
			await reader.cancel().catch(() => {});
			return;
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
		return;
	}
}
/** Re-scores five windows against the slate. Null when anything doesn't match the published puzzle exactly. */
function verifyRounds(slate, rounds) {
	if (!Array.isArray(rounds) || rounds.length !== 5 || slate.questions.length !== 5) return null;
	const ids = /* @__PURE__ */ new Set();
	let total = 0;
	for (const [i, q] of slate.questions.entries()) {
		const r = rounds[i];
		if (!r || typeof r.id !== "string" || !ID.test(r.id) || r.id !== q.id || ids.has(r.id)) return null;
		ids.add(r.id);
		if (typeof r.lo !== "number" || typeof r.hi !== "number" || !Number.isFinite(r.lo) || !Number.isFinite(r.hi)) return null;
		const w = {
			lo: r.lo,
			hi: r.hi
		};
		const lo = toSteps(q, w.lo);
		const hi = toSteps(q, w.hi);
		const onGrid = (v, steps) => Math.abs(q.min + steps * q.step - v) <= q.step * 1e-6;
		if (!onGrid(w.lo, lo) || !onGrid(w.hi, hi) || lo < 0 || hi > rangeSteps(q) || hi - lo < 1) return null;
		total += scoreWindow(q, w).points;
	}
	return total;
}
function percentileBody(counts, n, score, ctx) {
	const ready = n >= ctx.minSample;
	const p = ready && score !== null ? midrankPercentile(counts, score) : null;
	return {
		n,
		threshold: ctx.minSample,
		ready,
		percentile: p ? {
			rounded: p.rounded,
			exact: Number(p.exact.toFixed(2))
		} : null
	};
}
async function handle(req, ctx) {
	if (![
		"GET",
		"POST",
		"DELETE"
	].includes(req.method)) return json(405, { status: "method" }, { Allow: "GET, POST, DELETE" });
	if (!ctx.store || !ctx.secret || !ctx.enabled && req.method !== "DELETE") return json(503, { status: "disabled" });
	if (!sameOrigin(req, ctx)) return json(403, { status: "origin" });
	const now = ctx.now();
	const asOf = now.toISOString();
	const today = utcDay(now);
	const budget = budgetKeys(ctx, now);
	const paused = req.method !== "DELETE" && ctx.memo.pausedUntil > now.getTime();
	try {
		if (req.method === "GET") {
			const url = new URL(req.url);
			const day = url.searchParams.get("day");
			if ([...url.searchParams.keys()].length !== 1 || !isIsoDay(day) || day > today || day < addDays(today, -1)) return json(422, { status: "invalid" });
			if (paused) return json(503, { status: "paused" });
			const season = seasonOf(day, { launchDay: ctx.launchDay });
			const read = await ctx.store.read(`${keyPrefix(ctx, season, day)}:dist`, budget, ctx.limits);
			if ("paused" in read) {
				rememberPause(ctx, now, read.paused);
				return json(503, { status: "paused" });
			}
			const ready = read.n >= ctx.minSample;
			const counts = ready ? Object.fromEntries(read.counts.flatMap((c, s) => c > 0 ? [[s, c]] : [])) : void 0;
			return json(200, {
				status: "ok",
				day,
				season,
				n: read.n,
				threshold: ctx.minSample,
				ready,
				counts,
				asOf
			}, { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" });
		}
		const body = await readBody(req);
		if (!body || typeof body !== "object" || Array.isArray(body)) return json(422, { status: "invalid" });
		const ipHash = await hmac(ctx.secret, `ip:${today}:${clientIp(req)}`, 16);
		if ((ctx.memo.limitedUntil.get(ipHash) ?? 0) > now.getTime()) return json(429, { status: "limited" }, { "Retry-After": "60" });
		const rate = `sw:v1:${ctx.env}:rl:${ipHash}:${Math.floor(now.getTime() / 6e4)}`;
		if (req.method === "DELETE") {
			const player = body.player;
			if (typeof player !== "string" || !PLAYER.test(player)) return json(422, { status: "invalid" });
			const oldest = addDays(today, -8);
			const days = [...new Set(Array.isArray(body.days) ? body.days.filter(isIsoDay) : [])].filter((d) => d >= oldest && d <= today).slice(0, 9);
			const pairs = [];
			for (const day of days) for (const season of /* @__PURE__ */ new Set([seasonOf(day, { launchDay: ctx.launchDay }), "qa"])) {
				const p = keyPrefix(ctx, season, day);
				pairs.push({
					sub: `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`,
					dist: `${p}:dist`
				});
			}
			if (pairs.length === 0) return json(200, {
				status: "ok",
				removed: 0
			});
			const r = await ctx.store.removeMany(pairs, rate, budget, ctx.limits);
			if (r === "limited") {
				rememberLimited(ctx, ipHash, now);
				return json(429, { status: "limited" }, { "Retry-After": "60" });
			}
			if (r === "paused") return json(503, { status: "paused" });
			return json(200, {
				status: "ok",
				removed: r
			});
		}
		const day = body.day;
		if (!isIsoDay(day)) return json(422, { status: "invalid" });
		if (!eligibleDay(day, now, ctx.graceSeconds)) return json(200, {
			status: "ineligible",
			reason: "not-today",
			asOf
		});
		const country = (req.headers.get("x-vercel-ip-country") ?? "").toUpperCase();
		if (body.consent !== "granted" && (!country || CONSENT_COUNTRIES.has(country))) return json(409, { status: "consent-required" });
		if (body.player === void 0 && body.rounds === void 0) return json(200, { status: "proceed" });
		const player = body.player;
		if (typeof player !== "string" || !PLAYER.test(player)) return json(422, { status: "invalid" });
		const slate = await ctx.loadSlate(day);
		if (!slate || slate.date !== day) return json(200, {
			status: "ineligible",
			reason: "no-puzzle",
			asOf
		});
		const total = verifyRounds(slate, body.rounds);
		if (total === null || body.total !== void 0 && body.total !== total) return json(422, { status: "invalid" });
		if (paused) return json(503, { status: "paused" });
		const season = body.test === true ? "qa" : seasonOf(day, { launchDay: ctx.launchDay });
		const p = keyPrefix(ctx, season, day);
		const out = await ctx.store.submit({
			sub: `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`,
			dist: `${p}:dist`,
			rate,
			ipDay: `sw:v1:${ctx.env}:ipd:${ipHash}`,
			budget
		}, total, ctx.limits);
		if (out.status === "limited") {
			rememberLimited(ctx, ipHash, now);
			return json(429, { status: "limited" }, { "Retry-After": "60" });
		}
		if (out.status === "paused") {
			rememberPause(ctx, now, out.scope);
			return json(503, { status: "paused" });
		}
		return json(200, {
			status: out.status,
			day,
			season,
			score: out.total,
			...percentileBody(out.counts, out.n, out.total, ctx),
			asOf
		});
	} catch {
		return json(503, { status: "unavailable" });
	}
}
/** Builds the context from environment variables (server-only; never VITE_-prefixed). */
function contextFromEnv(env, deps) {
	const num = (v, d) => v && /^\d+$/.test(v) ? Number(v) : d;
	const onVercel = env.VERCEL === "1";
	const ns = (env.SCORES_NAMESPACE && /^[a-z0-9-]{1,24}$/.test(env.SCORES_NAMESPACE) ? env.SCORES_NAMESPACE : null) ?? (env.VERCEL_ENV === "production" ? "production" : env.VERCEL_ENV === "preview" ? "preview" : onVercel ? "" : "development");
	const secret = env.SCORE_HASH_SECRET && (!onVercel || env.SCORE_HASH_SECRET.length >= 32) ? env.SCORE_HASH_SECRET : onVercel ? "" : "local-development-only";
	const minSample = num(env.PERCENTILE_MIN_SAMPLE, 100);
	return {
		enabled: env.SCORES_ENABLED === "1" && ns !== "",
		store: deps.store,
		secret: ns === "" ? "" : secret,
		env: ns,
		launchDay: parseLaunchDay(env.LAUNCH_DAY ?? env.VITE_LAUNCH_DAY),
		loadSlate: deps.loadSlate,
		now: () => /* @__PURE__ */ new Date(),
		limits: {
			...DEFAULT_LIMITS,
			dailyBudget: num(env.SCORES_DAILY_BUDGET, DEFAULT_LIMITS.dailyBudget),
			monthlyBudget: Math.min(num(env.SCORES_MONTHLY_BUDGET, DEFAULT_LIMITS.monthlyBudget), DEFAULT_LIMITS.monthlyBudget)
		},
		graceSeconds: 7200,
		minSample: ns === "production" ? Math.max(100, minSample) : minSample,
		allowedOrigins: (env.SCORES_ALLOWED_ORIGINS ?? "https://stat-window.vercel.app").split(",").map((s) => s.trim()).filter(Boolean),
		budgetPrefix: "sw:v1:budget",
		memo: newMemo()
	};
}
// server/slates.ts
/** Reads a published day file (bundled into the function via vercel.json includeFiles). */
function fileSlates(root = process.cwd()) {
	const cache = /* @__PURE__ */ new Map();
	return async (day) => {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
		if (cache.has(day)) return cache.get(day);
		let slate = null;
		try {
			const raw = JSON.parse(await readFile(path.join(root, "content", "days", `${day}.json`), "utf8"));
			slate = raw.date === day && Array.isArray(raw.questions) && raw.questions.length === 5 && raw.questions.every((q) => typeof q.id === "string" && [
				q.answer,
				q.min,
				q.max,
				q.step
			].every((n) => typeof n === "number" && Number.isFinite(n)) && q.step > 0) ? {
				date: raw.date,
				questions: raw.questions.map(({ id, answer, min, max, step }) => ({
					id,
					answer,
					min,
					max,
					step
				}))
			} : null;
		} catch {
			slate = null;
		}
		cache.set(day, slate);
		return slate;
	};
}
// server/store.ts
/**
* Upstash bills an EVAL as one command plus one per redis.call it runs
* (https://upstash.com/docs/redis/overall/billing, "Lua scripts"). These are upper bounds
* per script, charged up front, so the counters never under-count.
*/
var COST = {
	submit: 16,
	read: 6,
	remove: (pairs) => 6 + 4 * pairs
};
var DAY_TTL = 172800;
var MONTH_TTL = 2764800;
var IP_DAY_TTL = 93600;
/**
* KEYS: sub, dist, rate, ipDay, budgetDay, budgetMonth.
* ARGV: total, subTtl, distTtl, dailyBudget, monthlyBudget, ratePerMinute, ipDailyStored, cost, dayTtl, monthTtl, ipDayTtl.
* The rate check runs first, so a flooding client is turned away before it can spend the shared budget.
*/
var SUBMIT_LUA = `
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
var READ_LUA = `
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
var REMOVE_LUA = `
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
function countsFromHash(flat) {
	const counts = Array.from({ length: 501 }, () => 0);
	for (let i = 0; i + 1 < flat.length; i += 2) {
		const field = String(flat[i]);
		const value = Number(flat[i + 1]);
		if (!/^\d{1,3}$/.test(field) || !Number.isInteger(value) || value <= 0) continue;
		const s = Number(field);
		if (s <= 500) counts[s] = value;
	}
	return {
		counts,
		n: counts.reduce((a, b) => a + b, 0)
	};
}
function redisStore(evaluate) {
	return {
		async submit(keys, total, limits) {
			const [status, second, flat] = await evaluate(SUBMIT_LUA, [
				keys.sub,
				keys.dist,
				keys.rate,
				keys.ipDay,
				keys.budget.day,
				keys.budget.month
			], [
				total,
				limits.subTtl,
				limits.distTtl,
				limits.dailyBudget,
				limits.monthlyBudget,
				limits.ratePerMinute,
				limits.ipDailyStored,
				COST.submit,
				DAY_TTL,
				MONTH_TTL,
				IP_DAY_TTL
			]);
			if (status === "stored" || status === "duplicate") return {
				status,
				total: Number(second),
				...countsFromHash(flat ?? [])
			};
			if (status === "limited") return { status };
			return {
				status: "paused",
				scope: second === "month" ? "month" : "day"
			};
		},
		async read(dist, budget, limits) {
			const out = await evaluate(READ_LUA, [
				dist,
				budget.day,
				budget.month
			], [
				limits.dailyBudget,
				limits.monthlyBudget,
				COST.read,
				DAY_TTL,
				MONTH_TTL
			]);
			if (out[0] !== "ok") return { paused: out[1] === "month" ? "month" : "day" };
			return countsFromHash(out[1] ?? []);
		},
		async removeMany(pairs, rate, budget, limits) {
			const out = await evaluate(REMOVE_LUA, [
				rate,
				budget.month,
				...pairs.flatMap((p) => [p.sub, p.dist])
			], [
				limits.monthlyBudget + limits.eraseReserve,
				limits.ratePerMinute,
				COST.remove(pairs.length),
				MONTH_TTL
			]);
			if (out[0] === "limited") return "limited";
			if (out[0] !== "ok") return "paused";
			return Number(out[1]);
		}
	};
}
/** Upstash REST: POST the command as a JSON array, Bearer token. Times out fast so a slow store never stalls a player. */
function upstashEval(url, token, fetchImpl = fetch, timeoutMs = 2500) {
	return async (script, keys, args) => {
		const res = await fetchImpl(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify([
				"EVAL",
				script,
				keys.length,
				...keys,
				...args.map(String)
			]),
			signal: AbortSignal.timeout(timeoutMs)
		});
		const body = await res.json().catch(() => null);
		if (!res.ok || !body || body.error !== void 0) throw new Error(`store error ${res.status}`);
		return body.result;
	};
}
// server/vercel-entry.ts
/**
* Vercel Function entry, bundled by `npm run api:build` into api/scores.js (a single
* file with no imports beyond Node built-ins, so Vercel runs exactly the tested code).
*/
var ctx = null;
function context() {
	if (ctx) return ctx;
	const env = process.env;
	const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
	ctx = contextFromEnv(env, {
		store: url && token ? redisStore(upstashEval(url, token)) : null,
		loadSlate: fileSlates()
	});
	return ctx;
}
var vercel_entry_default = { fetch(request) {
	return handle(request, context());
} };
export { vercel_entry_default as default };
