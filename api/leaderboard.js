import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
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
function addDays(day, n) {
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
* The launch day is committed in src/engine/launch-config.ts (one value for the client and
* the score API). Null means beta: the live game behaves exactly as before. Non-production builds can preview a launch with
* `?launch-preview=YYYY-MM-DD` when VITE_LAUNCH_PREVIEW=1 (never in production).
*/
var DAY$1 = /^\d{4}-\d{2}-\d{2}$/;
function isIsoDay(s) {
	if (typeof s !== "string" || !DAY$1.test(s)) return false;
	const d = /* @__PURE__ */ new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
/** A config is only accepted with a real date on or after the beta epoch. */
function parseLaunchDay(raw) {
	return isIsoDay(raw) && raw > "2026-11-15" ? raw : null;
}
// src/engine/launch-config.ts
/**
* The official season's launch day, the single source of truth for the client label,
* the score API's season and the CI release gates (docs/LAUNCH.md).
*
* `null` keeps the public beta. Setting a date schedules the restarted official season:
* that canonical Eastern day becomes "No. 1" at 12:00 AM Eastern. It is changed only by a
* reviewed commit, and `scripts/season-check.ts` refuses a change unless the new day is
* still in the future (Eastern), is on or after VARIETY_FROM and has enough validated
* official slates. The old VITE_LAUNCH_DAY / LAUNCH_DAY environment variables are no
* longer read; a build fails if either is set to a different value, so a stale
* dashboard setting can never split the client and server seasons.
*/
var LAUNCH_DAY = "2026-11-28";
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
var ID = /^[a-z0-9-]{1,80}$/;
new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH AX GF GP MQ RE YT MF GI JE GG IM".split(" "));
/** Today's official day, or yesterday's during the grace period after midnight. */
function eligibleDay(day, now, graceSeconds) {
	const today = puzzleDay(now);
	if (day === today) return true;
	const sinceMidnight = (now.getTime() - puzzleStartUtcMs(today)) / 1e3;
	return day === addDays(today, -1) && sinceMidnight < graceSeconds;
}
/** Re-scores five windows against the slate. Null when anything doesn't match the published puzzle exactly. */
function verifyRounds(slate, rounds) {
	return verifyRun(slate, rounds)?.total ?? null;
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
// server/leaderboard.ts
/** Separate opt-in leaderboard API; deliberately disabled until its shared Upstash cost budget is approved. */
/**
* Cheap, per-warm-function protection against repeatedly billing Redis for
* responses its *own* atomic limiter already denied. This is NOT an edge
* firewall, shared counter, or proof of an Upstash monthly spend ceiling.
*
* Redis keys use fixed-minute buckets, so a 429 is only remembered through
* the end of that same minute. A cold instance rechecks Redis normally.
* A WeakMap keeps unrelated stores/isolated test contexts independent.
*/
var warmLimited = /* @__PURE__ */ new WeakMap();
var WARM_LIMIT_CACHE_MAX = 512;
function cachedLimited(store, key, nowMs) {
	const cache = warmLimited.get(store), expiry = cache?.get(key);
	if (expiry === void 0) return false;
	if (nowMs >= expiry) {
		cache.delete(key);
		return false;
	}
	return true;
}
function rememberLimited(store, key, nowMs) {
	let cache = warmLimited.get(store);
	if (!cache) {
		cache = /* @__PURE__ */ new Map();
		warmLimited.set(store, cache);
	}
	if (!cache.has(key) && cache.size >= WARM_LIMIT_CACHE_MAX) {
		for (const [old, expiry] of cache) if (expiry <= nowMs) cache.delete(old);
		if (cache.size >= WARM_LIMIT_CACHE_MAX) {
			const oldest = cache.keys().next().value;
			if (oldest !== void 0) cache.delete(oldest);
		}
	}
	cache.set(key, (Math.floor(nowMs / 6e4) + 1) * 6e4);
}
var PERIODS = [
	"day",
	"week",
	"month",
	"season"
];
var PLAYER = /^[A-Za-z0-9_-]{22}$/;
var DAY = /^\d{4}-\d{2}-\d{2}$/;
function expiryFor(period, day) {
	const start = Date.parse(day + "T00:00:00Z") / 1e3;
	const d = /* @__PURE__ */ new Date(day + "T00:00:00Z");
	let end;
	if (period === "day") end = start + 86400;
	else if (period === "week") end = start + (7 - (d.getUTCDay() + 6) % 7) * 86400;
	else if (period === "month") end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1e3;
	else {
		const anchor = Date.parse("2026-01-01T00:00:00Z") / 1e3;
		end = anchor + (Math.floor((start - anchor) / 10368e3) + 1) * 120 * 86400;
	}
	return end + 2592e3;
}
var LB_COST = {
	read: 24,
	submit: 55,
	remove: 21
};
function blockNumber(day) {
	return Number(periodKey("season", day, null).slice(6));
}
function blockLedger(prefix, member, block) {
	return prefix + ":player:" + member + ":block-" + block;
}
/** 48-hour, HMAC-only revocation marker blocks late POSTs after erasure. */
function revocationKey(prefix, member) {
	return prefix + ":revoked:" + member;
}
/** Finite lifetime for a 120-day ledger, including month/week overlap. */
function blockExpiry(block) {
	const anchor = Date.parse("2026-01-01T00:00:00Z");
	let expiry = 0;
	for (let i = 0; i < 120; i++) {
		const day = new Date(anchor + (block * 120 + i) * 864e5).toISOString().slice(0, 10);
		for (const period of PERIODS) expiry = Math.max(expiry, expiryFor(period, day));
	}
	return expiry;
}
function periodKey(period, day, launchDay) {
	if (!DAY.test(day) || Number.isNaN(Date.parse(day + "T00:00:00Z"))) throw new RangeError("invalid day");
	if (period === "day") return day;
	if (period === "month") return day.slice(0, 7);
	if (period === "season") {
		const anchor = Date.parse("2026-01-01T00:00:00Z");
		return "block-" + Math.floor((Date.parse(day + "T00:00:00Z") - anchor) / 10368e6);
	}
	return addDays(day, -(((/* @__PURE__ */ new Date(day + "T00:00:00Z")).getUTCDay() + 6) % 7));
}
function boards(prefix, day, launchDay) {
	return PERIODS.map((p) => prefix + ":board:" + p + ":" + periodKey(p, day, launchDay));
}
/**
* Explicitly declare every board a retained two-block player ledger may cite.
* Upstash strict Lua locking rejects writes to keys absent from EVAL's KEYS.
* The bound is two fixed 120-day blocks; never scan Redis or trust client keys.
*/
function erasureBoardKeys(prefix, day) {
	const anchor = Date.parse("2026-01-01T00:00:00Z");
	const current = blockNumber(day), result = /* @__PURE__ */ new Set();
	for (let block = current - 1; block <= current; block++) for (let i = 0; i < 120; i++) {
		const date = new Date(anchor + (block * 120 + i) * 864e5).toISOString().slice(0, 10);
		for (const board of boards(prefix, date, null)) result.add(board);
	}
	return [...result];
}
function pseudonym(member) {
	return [
		"Quiet",
		"Swift",
		"Clever",
		"Steady",
		"Sharp",
		"Lucky",
		"Calm",
		"Bold"
	][parseInt(member.slice(0, 4), 16) % 8] + [
		"Hooper",
		"Shooter",
		"Playmaker",
		"Rookie",
		"Veteran",
		"Closer",
		"Defender",
		"Coach"
	][parseInt(member.slice(4, 8), 16) % 8] + "-" + member.slice(-4).toUpperCase();
}
function hash(secret, value) {
	return createHmac("sha256", secret).update(value).digest("hex").slice(0, 40);
}
function json(status, body) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			...status === 429 ? { "Retry-After": "120" } : {}
		}
	});
}
async function readBody(req) {
	if (!(req.headers.get("content-type") ?? "").startsWith("application/json") || Number(req.headers.get("content-length") ?? 0) > 2048) return null;
	try {
		const text = await req.text();
		if (new TextEncoder().encode(text).length > 2048) return null;
		const x = JSON.parse(text);
		return x && typeof x === "object" && !Array.isArray(x) ? x : null;
	} catch {
		return null;
	}
}
async function handleLeaderboard(req, ctx) {
	if (![
		"GET",
		"POST",
		"DELETE"
	].includes(req.method)) return json(405, { status: "method" });
	if (req.headers.get("sec-fetch-site") === "cross-site") return json(403, { status: "origin" });
	const origin = req.headers.get("origin");
	if (origin) try {
		const supplied = new URL(origin).origin;
		if (supplied !== new URL(req.url).origin && !ctx.allowedOrigins.includes(supplied)) return json(403, { status: "origin" });
	} catch {
		return json(403, { status: "origin" });
	}
	if (!ctx.store || !ctx.secret || !ctx.env || (req.method === "DELETE" ? !ctx.eraseEnabled : !ctx.enabled)) return json(503, { status: "disabled" });
	const now = ctx.now(), today = puzzleDay(now), prefix = "sw:v3:" + ctx.env, utc = now.toISOString().slice(0, 10);
	const budget = [
		"sw:v1:budget:d:" + utc,
		"sw:v1:budget:m:" + utc.slice(0, 7),
		"sw:v1:budget:e:" + utc.slice(0, 7),
		prefix + ":budget:m:" + utc.slice(0, 7)
	];
	const ip = (req.headers.get("x-real-ip") ?? "unknown").trim().slice(0, 128);
	const network = hash(ctx.secret, "lb-ip:" + ip);
	const localLimit = prefix + ":" + req.method + ":" + network + ":" + Math.floor(now.getTime() / 6e4);
	try {
		if (req.method === "GET") {
			const u = new URL(req.url), period = u.searchParams.get("period");
			if (!PERIODS.includes(period) || u.search !== "?period=" + period) return json(422, { status: "invalid" });
			const key = periodKey(period, today, ctx.launchDay);
			const code = req.headers.get("x-stat-window-player");
			if (code !== null && !PLAYER.test(code)) return json(422, { status: "invalid" });
			const privateRead = req.headers.get("sec-gpc") === "1" || req.headers.get("dnt") === "1";
			const member = code === null || privateRead ? null : hash(ctx.secret, "lb-player:" + code);
			const board = prefix + ":board:" + period + ":" + key;
			if (cachedLimited(ctx.store, localLimit, now.getTime())) return json(429, { status: "limited" });
			const r = await ctx.store.read(board, budget, ctx.caps, [prefix + ":read:minute:" + network + ":" + Math.floor(now.getTime() / 6e4), prefix + ":read:day:" + network + ":" + utc], [blockLedger(prefix, member ?? "anonymous", blockNumber(today)), blockLedger(prefix, member ?? "anonymous", blockNumber(today) - 1)], member);
			if (r === "limited") {
				rememberLimited(ctx.store, localLimit, now.getTime());
				return json(429, { status: "limited" });
			}
			if (r === "paused") return json(503, { status: "paused" });
			let topRank = 0;
			const entries = r.rows.map(([id, score], index) => {
				if (index === 0 || r.rows[index - 1][1] !== score) topRank = index + 1;
				return {
					rank: topRank,
					name: pseudonym(id),
					score
				};
			});
			const mine = r.mine && member ? {
				...r.mine,
				name: pseudonym(member)
			} : void 0;
			return json(200, {
				status: "ok",
				period,
				periodKey: key,
				entries,
				totalPlayers: r.count,
				asOf: now.toISOString(),
				unverified: true,
				...mine ? { mine } : {}
			});
		}
		const body = await readBody(req);
		if (!body || typeof body.player !== "string" || !PLAYER.test(body.player)) return json(422, { status: "invalid" });
		if (req.method === "POST" && (body.consent !== "granted" || req.headers.get("sec-gpc") === "1" || req.headers.get("dnt") === "1")) return json(409, { status: "consent-required" });
		const member = hash(ctx.secret, "lb-player:" + body.player);
		const rate = prefix + ":rate:" + network + ":" + Math.floor(now.getTime() / 6e4);
		if (req.method === "DELETE") {
			if (cachedLimited(ctx.store, localLimit, now.getTime())) return json(429, { status: "limited" });
			const result = await ctx.store.remove([
				blockLedger(prefix, member, blockNumber(today)),
				blockLedger(prefix, member, blockNumber(today) - 1),
				budget[2],
				rate,
				prefix + ":delete:day:" + network + ":" + utc,
				prefix + ":budget:erase:" + utc.slice(0, 7),
				revocationKey(prefix, member),
				...erasureBoardKeys(prefix, today)
			], member, ctx.caps);
			if (result === "limited") rememberLimited(ctx.store, localLimit, now.getTime());
			return result === "limited" ? json(429, { status: "limited" }) : result === "paused" ? json(503, { status: "paused" }) : json(200, {
				status: "ok",
				removed: result === "removed" ? 1 : 0
			});
		}
		const submittedDay = body.day;
		if (body.test === true || typeof submittedDay !== "string" || !DAY.test(submittedDay) || !eligibleDay(submittedDay, now, 7200)) return json(200, { status: "ineligible" });
		const slate = await ctx.loadSlate(submittedDay);
		if (!slate || slate.date !== submittedDay) return json(200, { status: "ineligible" });
		const score = verifyRounds(slate, body.rounds);
		if (score === null || body.total !== void 0 && body.total !== score) return json(422, { status: "invalid" });
		if (cachedLimited(ctx.store, localLimit, now.getTime())) return json(429, { status: "limited" });
		const result = await ctx.store.submit([
			blockLedger(prefix, member, blockNumber(submittedDay)),
			...boards(prefix, submittedDay, ctx.launchDay),
			budget[0],
			budget[1],
			rate,
			budget[3],
			prefix + ":submit:day:" + network + ":" + utc,
			revocationKey(prefix, member)
		], member, submittedDay, score, ctx.caps, [...PERIODS.map((p) => expiryFor(p, submittedDay)), blockExpiry(blockNumber(submittedDay))]);
		if (result === "limited") rememberLimited(ctx.store, localLimit, now.getTime());
		if (result === "revoked") return json(409, { status: "revoked" });
		return result === "limited" ? json(429, { status: "limited" }) : result === "paused" ? json(503, { status: "paused" }) : json(200, {
			status: result,
			day: body.day,
			score
		});
	} catch {
		return json(503, { status: "unavailable" });
	}
}
function leaderboardContext(env, store, loadSlate) {
	const ns = env.VERCEL_ENV === "production" ? "production" : env.VERCEL_ENV === "preview" ? "preview" : env.VERCEL === "1" ? "" : "development";
	const secret = env.SCORE_HASH_SECRET && (env.VERCEL !== "1" || env.SCORE_HASH_SECRET.length >= 32) ? env.SCORE_HASH_SECRET : env.VERCEL === "1" ? "" : "local-dev-only";
	const day = Math.min(1e3, Number(env.LEADERBOARDS_DAILY_BUDGET) || 0), month = Math.min(2e4, Number(env.LEADERBOARDS_MONTHLY_BUDGET) || 0), erase = Math.min(1e4, Number(env.LEADERBOARDS_ERASE_BUDGET) || 0);
	const enabled = env.LEADERBOARDS_ENABLED === "1" && env.SCORES_ENABLED === "1" && !!ns && !!secret && day >= LB_COST.submit && month >= LB_COST.submit && erase >= 5e3;
	return {
		enabled,
		eraseEnabled: enabled || env.LEADERBOARDS_ERASURE_ENABLED === "1" && !!ns && !!secret && erase >= 5e3,
		store,
		secret: ns ? secret : "",
		env: ns,
		launchDay: parseLaunchDay(LAUNCH_DAY),
		now: () => /* @__PURE__ */ new Date(),
		loadSlate,
		allowedOrigins: (env.SCORES_ALLOWED_ORIGINS ?? "https://stat-window.vercel.app").split(",").map((s) => s.trim()).filter(Boolean),
		caps: [
			day,
			month,
			erase
		]
	};
}
// server/leaderboard-store.ts
var READ_LUA = `
if tonumber(redis.call('GET',KEYS[5]) or '0')>=12 then return {'limited'} end
local minute=redis.call('INCR',KEYS[5])
if minute==1 then redis.call('EXPIRE',KEYS[5],120) end
if minute>12 then return {'limited'} end
if tonumber(redis.call('GET',KEYS[6]) or '0')>=60 then return {'limited'} end
local daily=redis.call('INCR',KEYS[6])
if daily==1 then redis.call('EXPIRE',KEYS[6],93600) end
if daily>60 then return {'limited'} end
local own=tonumber(redis.call('GET',KEYS[4]) or '0')
if own+24>tonumber(ARGV[2]) then return {'paused'} end
local d=tonumber(redis.call('GET',KEYS[2]) or '0')
local m=tonumber(redis.call('GET',KEYS[3]) or '0')
if d+24>tonumber(ARGV[1]) or m+24>380000 then return {'paused'} end
redis.call('INCRBY',KEYS[4],24) redis.call('EXPIRE',KEYS[4],2764800)
redis.call('INCRBY',KEYS[2],24) redis.call('EXPIRE',KEYS[2],172800)
redis.call('INCRBY',KEYS[3],24) redis.call('EXPIRE',KEYS[3],2764800)
local n=redis.call('ZCARD',KEYS[1])
local top=redis.call('ZREVRANGE',KEYS[1],0,19,'WITHSCORES')
local mine={}
if ARGV[3] and ARGV[3]~='' then
  local myScore=redis.call('ZSCORE',KEYS[1],ARGV[3])
  if myScore then
    -- Share the same place among tied scores; never enumerate other players.
    local higher=redis.call('ZCOUNT',KEYS[1],'('..myScore,'+inf')
    -- A participant can play at most once per day. Their bounded player hash
    -- already stores exactly which boards each of those days contributes to.
    local days=0
    for k=7,8 do
      local ownDays=redis.call('HGETALL',KEYS[k])
      for i=2,#ownDays,2 do
        local item=cjson.decode(ownDays[i])
        for j=2,5 do
          if item[j]==KEYS[1] then days=days+1 break end
        end
      end
    end
    mine={tonumber(higher)+1,tonumber(myScore),days}
  end
end
return {'ok',n,top,mine}
`;
var SUBMIT_LUA = `
if tonumber(redis.call('GET',KEYS[8]) or '0')>=4 then return 'limited' end
local rate=redis.call('INCR',KEYS[8])
if rate==1 then redis.call('EXPIRE',KEYS[8],120) end
if rate>4 then return 'limited' end
if tonumber(redis.call('GET',KEYS[10]) or '0')>=20 then return 'limited' end
local daily=redis.call('INCR',KEYS[10])
if daily==1 then redis.call('EXPIRE',KEYS[10],93600) end
if daily>20 then return 'limited' end
-- A prior DELETE locks this browser code out, even if a late POST arrives
-- from a second tab after the corresponding score/ledger has been removed.
if redis.call('EXISTS',KEYS[11])==1 then return 'revoked' end
if redis.call('HEXISTS',KEYS[1],ARGV[2])==1 then return 'duplicate' end
if tonumber(redis.call('GET',KEYS[9]) or '0')+55>tonumber(ARGV[4]) or tonumber(redis.call('GET',KEYS[6]) or '0')+55>tonumber(ARGV[3]) or tonumber(redis.call('GET',KEYS[7]) or '0')+55>380000 then return 'paused' end
redis.call('INCRBY',KEYS[9],55) redis.call('EXPIRE',KEYS[9],2764800)
redis.call('INCRBY',KEYS[6],55) redis.call('EXPIRE',KEYS[6],172800)
redis.call('INCRBY',KEYS[7],55) redis.call('EXPIRE',KEYS[7],2764800)
redis.call('HSET',KEYS[1],ARGV[2],cjson.encode({tonumber(ARGV[1]),KEYS[2],KEYS[3],KEYS[4],KEYS[5]}))
local hashExpiry=tonumber(ARGV[10])
if redis.call('TTL',KEYS[1])==-1 then redis.call('EXPIREAT',KEYS[1],hashExpiry)
else redis.call('EXPIREAT',KEYS[1],hashExpiry,'GT') end
for i=2,5 do redis.call('ZINCRBY',KEYS[i],tonumber(ARGV[1]),ARGV[5]) redis.call('EXPIREAT',KEYS[i],tonumber(ARGV[i+4])) end
return 'stored'
`;
var REMOVE_LUA = `
if tonumber(redis.call('GET',KEYS[4]) or '0')>=2 then return 'limited' end
local rate=redis.call('INCR',KEYS[4])
if rate==1 then redis.call('EXPIRE',KEYS[4],120) end
if rate>2 then return 'limited' end
if tonumber(redis.call('GET',KEYS[5]) or '0')>=6 then return 'limited' end
local daily=redis.call('INCR',KEYS[5])
if daily==1 then redis.call('EXPIRE',KEYS[5],93600) end
if daily>6 then return 'limited' end
-- KEYS[7] is the revocation tombstone; KEYS[8+] declare the complete
-- deterministic board universe for both
-- retained 120-day ledger blocks. Under Upstash Lua strict locking every
-- mutated board must have been declared in the EVAL key list.
local declared={}
for k=8,#KEYS do declared[KEYS[k]]=k end
local totalByBoard={}
local uniqueBoards=0
local count=0
for k=1,2 do
  local all=redis.call('HGETALL',KEYS[k])
  for i=2,#all,2 do
    count=count+1
    if count>240 then return 'paused' end
    local item=cjson.decode(all[i])
    if type(item)~='table' or #item~=5 or type(item[1])~='number' or item[1]<0 then return 'paused' end
    -- Preflight every ledger row before touching any public ranking.
    for j=2,5 do
      local board=item[j]
      if not declared[board] then return 'paused' end
      if totalByBoard[board]==nil then
        totalByBoard[board]=0
        uniqueBoards=uniqueBoards+1
      end
      totalByBoard[board]=totalByBoard[board]+item[1]
    end
  end
end
-- Even an empty DELETE must atomically block any in-flight POST that
-- would otherwise resurrect a score after successful erasure.
-- Reserve for EVAL, throttling, both budget counters and the tombstone SET.
-- One ZSCORE and at most one ZREM/ZINCRBY per distinct board.
local cost=count==0 and 18 or 21+3*uniqueBoards
if tonumber(redis.call('GET',KEYS[3]) or '0')+cost>20000 or
   tonumber(redis.call('GET',KEYS[6]) or '0')+cost>tonumber(ARGV[1]) then return 'paused' end
redis.call('INCRBY',KEYS[3],cost) redis.call('EXPIRE',KEYS[3],2764800)
redis.call('INCRBY',KEYS[6],cost) redis.call('EXPIRE',KEYS[6],2764800)
redis.call('SET',KEYS[7],'1','EX',172800)
if count==0 then return 'nothing' end
for name,score in pairs(totalByBoard) do
  local board=KEYS[declared[name]]
  -- Never recreate a board that already expired; mutate a member once.
  local current=redis.call('ZSCORE',board,ARGV[2])
  if current then
    if tonumber(current)<=score then
      redis.call('ZREM',board,ARGV[2])
    else
      redis.call('ZINCRBY',board,-score,ARGV[2])
    end
  end
end
redis.call('DEL',KEYS[1],KEYS[2])
return 'removed'
`;
function leaderboardRedis(evaluate) {
	return {
		async read(board, budget, caps, rateKeys, profileKeys, member) {
			const out = await evaluate(READ_LUA, [
				board,
				budget[0],
				budget[1],
				budget[3],
				...rateKeys,
				...profileKeys
			], [
				caps[0],
				caps[1],
				member ?? ""
			]);
			if (out[0] === "paused") return "paused";
			if (out[0] === "limited") return "limited";
			const flat = out[2];
			const rows = [];
			for (let i = 0; i < flat.length; i += 2) rows.push([String(flat[i]), Number(flat[i + 1])]);
			const own = out[3];
			const mine = Array.isArray(own) && own.length === 3 ? {
				rank: Number(own[0]),
				score: Number(own[1]),
				days: Number(own[2])
			} : void 0;
			return {
				rows,
				count: Number(out[1]),
				...mine ? { mine } : {}
			};
		},
		async submit(keys, member, day, score, caps, expiries) {
			return String(await evaluate(SUBMIT_LUA, keys, [
				score,
				day,
				caps[0],
				caps[1],
				member,
				...expiries
			]));
		},
		async remove(keys, member, caps) {
			return String(await evaluate(REMOVE_LUA, keys, [caps[2], member]));
		}
	};
}
// server/store.ts
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
// server/vercel-leaderboard-entry.ts
var context = null;
var vercel_leaderboard_entry_default = { fetch(request) {
	if (!context) {
		const env = process.env, url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL, token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
		context = leaderboardContext(env, url && token ? leaderboardRedis(upstashEval(url, token)) : null, fileSlates());
	}
	return handleLeaderboard(request, context);
} };
export { vercel_leaderboard_entry_default as default };
