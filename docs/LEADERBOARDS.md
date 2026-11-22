# Leaderboard hardening status (not approved for activation)

The opt-in leaderboard remains disabled by default. The worker fixes the shared command ceiling: all leaderboard reads and submissions atomically check the existing percentile budget counters (380,000 monthly and daily cap) and their own separate monthly suballocation (at most 20,000). Both are charged in the same Lua script. This is a suballocation **inside** the existing 380,000, not an extra 20,000. Existing percentile deletions continue to use their separate 20,000 reserve. Upstash Free's 500,000 monthly command quota includes operations outside these scripts; budget accounting and real Redis tests remain mandatory before activation.

Ranking seasons are fixed 120-day UTC blocks anchored to 2026-01-01, rather than the unbounded beta/s1 game season. Day/week/month/120-day-season boards expire 30 days after the end of their respective periods. The browser-linked hash expires at the latest of those four fixed deadlines; this prevents the hash expiring before a still-retained season board when another player refreshes the board. Scores are not verified against cheating; no prizes.

GET requests have atomic per-network limits of 12 per two-minute bucket and 60 per UTC day; POST has 4 per two-minute bucket and 20 per UTC day; DELETE has 2 per two-minute bucket and 6 per UTC day, returning 429 with Retry-After. These counters are Redis operations and need vendor command-cost validation; they are not yet accounted in the existing estimate.

## Remaining blockers

- Validate fixed EXPIREAT lifecycle in real Redis, including post-inactivity erasure and all-period deletion. Existing pre-migration keys require a migration/cleanup plan before activation.
- Need real Redis Lua integration tests for 20-way same-member races, rollovers, deletion, TTL and budgets. No tests or CI are claimed green by this worker.
- Need days-played counts and securely authenticated own-rank; currently public top-20 only.
- Need stronger GET/POST/DELETE network rate caps, GPC/DNT handling and privacy copy aligned with actual retention.
- Need independent security/privacy/cost PASS on the exact integration SHA, plus verified Upstash billing and aggregate quota headroom.

Do not enable LEADERBOARDS_ENABLED or merge as release-ready on this evidence alone.

Redis 7 `EXPIREAT ... GT` prevents late submissions from shortening the owner hash's existing expiry. A disposable Redis integration suite now covers concurrency, deletion, budgets, read caps, monotonic expiration and POST daily caps; it must run with `REDIS_URL` against an isolated local/CI Redis 7 service before any release approval. Daily rate-limit counters themselves are not included in the vendor command cost proof. Keep feature disabled.

## Read-only personal rank and participation days (unverified implementation)

The leaderboard GET endpoint accepts an optional random 22-character browser code in the `X-Stat-Window-Player` request header; it never places the code into a URL, analytics or ranking payload. The backend hashes the code and uses a bounded per-player hash to compute the caller's own rank and number of accepted daily scores for the selected day/week/month/120-day season. Tied total scores share the same rank, and the public list uses the same tie convention. Client UI surfaces this only when someone has explicitly opted in. No personal rank is returned for a public anonymous GET. The response remains non-cacheable. Because this is a client-generated code without accounts, rankings are **unverified** and may be manipulated; do not award prizes.

The component suppresses the opt-in Join button while the backend is disabled or unavailable, avoiding the appearance that an offline ranking is live. Existing participant deletion remains available even if new submissions are disabled, subject to the separate deletion safeguards. This code change needs executable real Redis and browser CI plus security/cost critic approval before activation. 

## P0 block-ledger design (worker implementation, not yet independently verified)

Each participant's accepted dates are stored in a separate hash per fixed 120-day season (`player:<HMAC>:block-N`), rather than a single continuously renewed hash. Each hash expires at the latest expiry of any day/week/month/season board to which its 120 days can contribute. At most the current and preceding blocks are read or erased, with a hard 240-record limit. This accommodates a Monday week crossing a season boundary and the 30-day retention grace period. The legacy unpartitioned hash format was never approved for activation; if any environment has real legacy data, **do not enable this code** without a verified cleanup/migration.

Erasure uses two fixed ledger keys and an atomic Lua script. The ledger records contain derived board names; Redis calls against those names are dynamic keys in Lua, which **requires independent Upstash REST Lua compatibility and command-cost verification** before activation. An erasure of N retained dates reserves `20 + 14*N` estimated commands (N <= 240), charged atomically to both the existing shared 20,000 monthly erasure reserve and a distinct leaderboard subcap (maximum 10,000, minimum 5,000 to enable). No-record deletion does not debit either erasure counter, but is still network-rate-limited. Two deletions per network per minute and six per day remain. A paused or limited erasure returns an error, never a success acknowledgment.

**Unverified:** The worker has added real Redis 7 regression scenarios, but has not executed Redis tests or vendor compatibility checks in this run. Keep the service disabled pending those gates and independent review.
