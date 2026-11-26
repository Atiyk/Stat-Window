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
function emptyTally() {
	return {
		scoring: Array.from({ length: 101 }, () => 0),
		zero: 0,
		miss: 0,
		timeout: 0
	};
}
function tallySize(t) {
	return t.zero + t.miss + t.timeout + t.scoring.reduce((a, b) => a + b, 0);
}
var share = (part, n) => part >= 5 && n - part >= 5 ? Math.round(100 * part / n) : void 0;
function summarizeQuestion(id, t, minSample = 100) {
	const n = tallySize(t);
	if (n < minSample || n === 0) return {
		id,
		n,
		ready: false
	};
	const counts = [t.zero + t.miss + t.timeout, ...t.scoring.slice(1)];
	const pct = [];
	let below = 0;
	for (let p = 0; p <= 100; p++) {
		const equal = counts[p];
		pct.push(Math.min(100, Math.max(0, Math.round(100 * (below + .5 * equal) / n))));
		below += equal;
	}
	const scored = share(n - counts[0], n);
	const missed = share(t.miss, n);
	return {
		id,
		n,
		ready: true,
		pct,
		...scored !== void 0 ? { scored } : {},
		...missed !== void 0 ? { missed } : {}
	};
}
var easternParts = new Intl.DateTimeFormat("en-US", {
	timeZone: "America/New_York",
	year: "numeric",
	month: "2-digit",
	day: "2-digit"
});
var DAY_MS = 864e5;
function puzzleDay(now) {
	const parts = easternParts.formatToParts(now);
	const value = (type) => parts.find((part) => part.type === type)?.value;
	return `${value("year")}-${value("month")}-${value("day")}`;
}
function dayToUtcMs(day) {
	const ms = Date.parse(`${day}T00:00:00Z`);
	if (Number.isNaN(ms)) throw new RangeError(`Not a day: ${day}`);
	return ms;
}
function addDays$1(day, n) {
	return new Date(dayToUtcMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}
/** Exact midnight in New York for an ISO day, including the spring/fall DST boundaries. */
function puzzleStartUtcMs(day) {
	const utc = dayToUtcMs(day);
	for (let hour = 1; hour <= 12; hour++) {
		const candidate = utc + hour * 36e5;
		if (puzzleDay(new Date(candidate)) === day) return candidate;
	}
	throw new RangeError(`Cannot find Eastern midnight for ${day}`);
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
	readsPausedUntil: 0,
	limitedUntil: /* @__PURE__ */ new Map()
});
/**
* Budgets are in estimated Upstash commands (store.ts COST). Upstash Free allows 500K a month;
* 380K leaves room for the deletion reserve, rate-limited and paused calls, and the export script.
* Inside the daily budget, reads may spend at most `readDailyBudget`, and the question comparison
* pauses first (`question*Ceiling`), so near capacity the overall percentile keeps working longest.
* Cost model and capacity: docs/PERCENTILES.md "Cost".
*/
var DEFAULT_LIMITS = {
	subTtl: 604800,
	distTtl: 3456e4,
	dailyBudget: 14e3,
	monthlyBudget: 38e4,
	eraseReserve: 2e4,
	ratePerMinute: 6,
	ipDailyStored: 30,
	ipDailyCalls: 40,
	ipDailyDeletes: 5,
	readDailyBudget: 4e3,
	questionDailyCeiling: 12e3,
	questionMonthlyCeiling: 34e4
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
	const today = puzzleDay(now);
	if (day === today) return true;
	const sinceMidnight = (now.getTime() - puzzleStartUtcMs(today)) / 1e3;
	return day === addDays$1(today, -1) && sinceMidnight < graceSeconds;
}
function keyPrefix(ctx, season, day) {
	return `sw:v1:${ctx.env}:${season}:${day}`;
}
function budgetKeys(ctx, now) {
	const month = utcDay(now).slice(0, 7);
	return {
		day: `${ctx.budgetPrefix}:d:${utcDay(now)}`,
		month: `${ctx.budgetPrefix}:m:${month}`,
		erase: `${ctx.budgetPrefix}:e:${month}`,
		reads: `${ctx.budgetPrefix}:r:${utcDay(now)}`
	};
}
var nextUtcMidnight = (now) => Date.parse(`${addDays(utcDay(now), 1)}T00:00:00Z`);
var nextUtcMonth = (now) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
function rememberPause(ctx, now, scope) {
	ctx.memo.pausedUntil = scope === "month" ? nextUtcMonth(now) : nextUtcMidnight(now);
}
function rememberLimited(ctx, client, now, until = "minute") {
	if (ctx.memo.limitedUntil.size > 5e3) ctx.memo.limitedUntil.clear();
	ctx.memo.limitedUntil.set(client, until === "day" ? nextUtcMidnight(now) : (Math.floor(now.getTime() / 6e4) + 1) * 6e4);
}
var isLimited = (ctx, client, now) => (ctx.memo.limitedUntil.get(client) ?? 0) > now.getTime();
/** IPv4 as is; IPv6 cut to its /64, so one home or phone network is one client. */
function ipPrefix(ip) {
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
	if (mapped) return mapped[1];
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
	return ipPrefix((req.headers.get("x-real-ip") ?? "unknown").trim() || "unknown");
}
function sameOrigin(req, ctx) {
	if (req.headers.get("sec-fetch-site") === "cross-site") return false;
	const origin = req.headers.get("origin");
	if (!origin) return true;
	try {
		const supplied = new URL(origin).origin;
		return supplied === new URL(req.url).origin || ctx.allowedOrigins.includes(supplied);
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
/**
* The verified total and, per question, how the window counts (percentile.ts QuestionOutcome).
* Only these five outcomes are kept, never the windows: `t` is the full scale (how every client
* records a shot-clock violation; a player can't lock the full scale), `m` a window that misses
* the answer, `z` a catch too wide to score, otherwise the points.
*/
function verifyRun(slate, rounds) {
	if (!Array.isArray(rounds) || rounds.length !== 5 || slate.questions.length !== 5) return null;
	const ids = /* @__PURE__ */ new Set();
	const outcomes = [];
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
		const scored = scoreWindow(q, w);
		total += scored.points;
		outcomes.push(lo === 0 && hi === rangeSteps(q) ? "t" : !scored.hit ? "m" : scored.points === 0 ? "z" : scored.points);
	}
	return {
		total,
		outcomes
	};
}
/** The question statistics for a day's slate, in slate order. Null when the comparison is paused or the slate is unknown. */
function questionBody(slate, tallies, minSample) {
	if (!slate || tallies === "paused" || slate.questions.length !== 5) return null;
	return slate.questions.map((q) => summarizeQuestion(q.id, tallies.get(q.id) ?? emptyTally(), minSample));
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
	const today = puzzleDay(now);
	const budget = budgetKeys(ctx, now);
	const paused = req.method !== "DELETE" && ctx.memo.pausedUntil > now.getTime();
	try {
		if (req.method === "GET") {
			const url = new URL(req.url);
			const day = url.searchParams.get("day");
			if (!isIsoDay(day) || url.search !== `?day=${day}`) return json(422, { status: "invalid" });
			if (day > today || day < addDays(today, -1)) return json(200, {
				status: "ineligible",
				reason: "not-today",
				asOf
			});
			if (paused || ctx.memo.readsPausedUntil > now.getTime()) return json(503, { status: "paused" });
			const season = seasonOf(day, { launchDay: ctx.launchDay });
			const p = keyPrefix(ctx, season, day);
			const read = await ctx.store.read({
				dist: `${p}:dist`,
				q: `${p}:q`
			}, budget, ctx.limits);
			if ("paused" in read) {
				if (read.paused === "reads") ctx.memo.readsPausedUntil = nextUtcMidnight(now);
				else rememberPause(ctx, now, read.paused);
				return json(503, { status: "paused" });
			}
			const ready = read.n >= ctx.minSample;
			const counts = ready ? Object.fromEntries(read.counts.flatMap((c, s) => c > 0 ? [[s, c]] : [])) : void 0;
			const questions = questionBody(await ctx.loadSlate(day).catch(() => null), read.questions, ctx.minSample);
			return json(200, {
				status: "ok",
				day,
				season,
				n: read.n,
				threshold: ctx.minSample,
				ready,
				counts,
				questions,
				asOf
			}, { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" });
		}
		const body = await readBody(req);
		if (!body || typeof body !== "object" || Array.isArray(body)) return json(422, { status: "invalid" });
		const ipHash = await hmac(ctx.secret, `ip:${today}:${clientIp(req)}`, 16);
		if (isLimited(ctx, ipHash, now)) return json(429, { status: "limited" }, { "Retry-After": "60" });
		const untilMidnight = { "Retry-After": String(Math.ceil((nextUtcMidnight(now) - now.getTime()) / 1e3)) };
		const rate = `sw:v1:${ctx.env}:rl:${ipHash}:${Math.floor(now.getTime() / 6e4)}`;
		if (req.method === "DELETE") {
			const player = body.player;
			if (typeof player !== "string" || !PLAYER.test(player)) return json(422, { status: "invalid" });
			const delClient = `del:${ipHash}`;
			if (isLimited(ctx, delClient, now)) return json(429, { status: "limited" }, untilMidnight);
			const days = Array.from({ length: 9 }, (_, i) => addDays(today, -i));
			const pairs = [];
			for (const day of days) for (const season of /* @__PURE__ */ new Set([seasonOf(day, { launchDay: ctx.launchDay }), "qa"])) {
				const p = keyPrefix(ctx, season, day);
				pairs.push({
					sub: `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`,
					dist: `${p}:dist`,
					q: `${p}:q`
				});
			}
			const r = await ctx.store.removeMany(pairs, {
				rate,
				ipDay: `sw:v1:${ctx.env}:ipdel:${ipHash}`,
				revocation: `sw:v1:${ctx.env}:revoked:${await hmac(ctx.secret, `score-browser:${player}`, 32)}`
			}, budget, ctx.limits);
			if (typeof r === "object") {
				if (r.limited === "day") {
					rememberLimited(ctx, delClient, now, "day");
					return json(429, { status: "limited" }, untilMidnight);
				}
				rememberLimited(ctx, ipHash, now);
				return json(429, { status: "limited" }, { "Retry-After": "60" });
			}
			if (r === "paused") return json(503, { status: "paused" });
			return json(200, {
				status: "ok",
				removed: r
			});
		}
		const postClient = `post:${ipHash}`;
		if (isLimited(ctx, postClient, now)) return json(429, { status: "limited" }, untilMidnight);
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
		const run = verifyRun(slate, body.rounds);
		if (run === null || body.total !== void 0 && body.total !== run.total) return json(422, { status: "invalid" });
		const { total } = run;
		if (paused) return json(503, { status: "paused" });
		const season = body.test === true ? "qa" : seasonOf(day, { launchDay: ctx.launchDay });
		const p = keyPrefix(ctx, season, day);
		const out = await ctx.store.submit({
			sub: `${p}:sub:${await hmac(ctx.secret, `${season}:${day}:${player}`, 32)}`,
			dist: `${p}:dist`,
			q: `${p}:q`,
			rate,
			ipDay: `sw:v1:${ctx.env}:ipd:${ipHash}`,
			ipCalls: `sw:v1:${ctx.env}:ipc:${ipHash}`,
			revocation: `sw:v1:${ctx.env}:revoked:${await hmac(ctx.secret, `score-browser:${player}`, 32)}`,
			budget
		}, total, ctx.limits, run.outcomes.map((o, i) => `${slate.questions[i].id}:${o}`));
		if (out.status === "limited") {
			if (out.until === "day") {
				rememberLimited(ctx, postClient, now, "day");
				return json(429, { status: "limited" }, untilMidnight);
			}
			rememberLimited(ctx, ipHash, now);
			return json(429, { status: "limited" }, { "Retry-After": "60" });
		}
		if (out.status === "revoked") return json(409, { status: "revoked" });
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
	const lowSampleForTests = env.SCORES_TEST_LOW_SAMPLE === "1" && env.VERCEL_ENV !== "production" && ns !== "production";
	const requested = num(env.PERCENTILE_MIN_SAMPLE, 100);
	const minSample = lowSampleForTests ? requested : Math.max(100, requested);
	const dailyBudget = num(env.SCORES_DAILY_BUDGET, DEFAULT_LIMITS.dailyBudget);
	const monthlyBudget = Math.min(num(env.SCORES_MONTHLY_BUDGET, DEFAULT_LIMITS.monthlyBudget), DEFAULT_LIMITS.monthlyBudget);
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
			dailyBudget,
			monthlyBudget,
			readDailyBudget: Math.min(DEFAULT_LIMITS.readDailyBudget, Math.floor(dailyBudget * 2 / 7)),
			questionDailyCeiling: Math.min(DEFAULT_LIMITS.questionDailyCeiling, Math.floor(dailyBudget * 6 / 7)),
			questionMonthlyCeiling: Math.min(DEFAULT_LIMITS.questionMonthlyCeiling, Math.floor(monthlyBudget * 17 / 19))
		},
		graceSeconds: 7200,
		minSample,
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
* Durable store for daily score distributions. Spec: docs/PERCENTILES.md.
*
* Production uses Upstash Redis over its REST API (plain fetch, no SDK). Every
* write is one Lua script, so the duplicate check, the bucket increment and the
* caps run atomically: two tabs or a retried request can never count twice.
* `memoryStore()` implements the same contract in-process for tests and local
* preview; `scripts` are exported so the integration test can run them on a real
* redis-server.
*/
/**
* Upstash bills an EVAL as one command plus one per redis.call it runs
* (https://upstash.com/docs/redis/overall/billing, "Lua scripts"). These are upper bounds
* per script, charged up front, so the counters never under-count.
*/
var COST = {
	/** A first completion with its five question outcomes: 21 for the total, plus 5 HINCRBY and 1 EXPIRE. */
	submit: 27,
	/** A first completion stored total-only because the question ceiling was reached: 21 plus HSET and EXPIRE of the pause flag. */
	submitTotalOnly: 23,
	/** A resend of a run already stored: checked before the full charge, and it stops after the GET and HGETALL. */
	duplicate: 14,
	/** Three counter GETs, three INCRBY+EXPIRE, HGETALL of the totals and of the question tally. */
	read: 12,
	/** Deletion's upper bound, checked against the erase reserve before any record is read: per pair GET, DEL, 2 for the total, 2 per question. */
	remove: (pairs) => 9 + 14 * pairs,
	/**
	* What deletion actually spends: a GET per pair, DEL + HINCRBY + HDEL for each record that existed,
	* and HINCRBY + HDEL for each of its question outcomes (only records stored with questions have any).
	*/
	removeSpent: (pairs, removed, questionFields = 0) => 9 + pairs + 3 * removed + 2 * questionFields
};
var DAY_TTL = 172800;
var MONTH_TTL = 2764800;
var IP_DAY_TTL = 93600;
/** Beyond the 7-day linked-score TTL so a delayed POST cannot recreate deleted data. */
var REVOKED_TTL = 777600;
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
var SUBMIT_LUA = `
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
var READ_LUA = `
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
var REMOVE_LUA = `
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
var QUESTION_FIELD = /^([a-z0-9-]{1,80}):(t|m|z|[1-9]\d{0,2})$/;
/**
* Question tallies from the flat HGETALL of the `q` hash, or 'paused' when the day was flagged incomplete.
* Malformed fields and non-positive counts are ignored, as for the totals.
*/
function questionsFromHash(flat) {
	const out = /* @__PURE__ */ new Map();
	for (let i = 0; i + 1 < flat.length; i += 2) {
		const field = String(flat[i]);
		if (field === "!") return "paused";
		const value = Number(flat[i + 1]);
		const m = QUESTION_FIELD.exec(field);
		if (!m || !Number.isInteger(value) || value <= 0) continue;
		const t = out.get(m[1]) ?? emptyTally();
		out.set(m[1], t);
		const o = m[2];
		if (o === "t") t.timeout += value;
		else if (o === "m") t.miss += value;
		else if (o === "z") t.zero += value;
		else if (Number(o) <= 100) t.scoring[Number(o)] = value;
	}
	return out;
}
function redisStore(evaluate) {
	return {
		async submit(keys, total, limits, fields = []) {
			const [status, second, flat] = await evaluate(SUBMIT_LUA, [
				keys.sub,
				keys.dist,
				keys.rate,
				keys.ipDay,
				keys.budget.day,
				keys.budget.month,
				keys.ipCalls,
				keys.revocation,
				keys.q
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
				IP_DAY_TTL,
				limits.ipDailyCalls,
				COST.duplicate,
				COST.submitTotalOnly,
				limits.questionDailyCeiling,
				limits.questionMonthlyCeiling,
				...fields
			]);
			if (status === "stored" || status === "duplicate") return {
				status,
				total: Number(second),
				...countsFromHash(flat ?? [])
			};
			if (status === "limited") return {
				status,
				until: second === "day" ? "day" : "minute"
			};
			if (status === "revoked") return { status: "revoked" };
			return {
				status: "paused",
				scope: second === "month" ? "month" : "day"
			};
		},
		async read(keys, budget, limits) {
			const out = await evaluate(READ_LUA, [
				keys.dist,
				budget.day,
				budget.month,
				budget.reads,
				keys.q
			], [
				limits.dailyBudget,
				limits.monthlyBudget,
				COST.read,
				DAY_TTL,
				MONTH_TTL,
				limits.readDailyBudget,
				limits.questionDailyCeiling,
				limits.questionMonthlyCeiling
			]);
			if (out[0] !== "ok") return { paused: out[1] === "month" ? "month" : out[1] === "reads" ? "reads" : "day" };
			const q = out[2];
			return {
				...countsFromHash(out[1] ?? []),
				questions: Array.isArray(q) ? questionsFromHash(q) : "paused"
			};
		},
		async removeMany(pairs, client, budget, limits) {
			const out = await evaluate(REMOVE_LUA, [
				client.rate,
				client.ipDay,
				budget.erase,
				client.revocation,
				...pairs.flatMap((p) => [
					p.sub,
					p.dist,
					p.q
				])
			], [
				limits.eraseReserve,
				limits.ratePerMinute,
				COST.remove(pairs.length),
				MONTH_TTL,
				limits.ipDailyDeletes,
				IP_DAY_TTL,
				pairs.length,
				REVOKED_TTL
			]);
			if (out[0] === "limited") return { limited: out[1] === "day" ? "day" : "minute" };
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
