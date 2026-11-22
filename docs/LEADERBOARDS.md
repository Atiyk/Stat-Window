# Leaderboard hardening status (not approved for activation)

The opt-in leaderboard remains disabled by default. The worker fixes the shared command ceiling: all leaderboard reads and submissions atomically check the existing percentile budget counters (380,000 monthly and daily cap) and their own separate monthly suballocation (at most 20,000). Both are charged in the same Lua script. This is a suballocation **inside** the existing 380,000, not an extra 20,000. Existing percentile deletions continue to use their separate 20,000 reserve. Upstash Free's 500,000 monthly command quota includes operations outside these scripts; budget accounting and real Redis tests remain mandatory before activation.

Ranking seasons are fixed 120-day UTC blocks anchored to 2026-01-01, rather than the unbounded beta/s1 game season. Day/week/month/120-day-season boards expire 30 days after the end of their respective periods. The browser-linked hash expires at the latest of those four fixed deadlines; this prevents the hash expiring before a still-retained season board when another player refreshes the board. Scores are not verified against cheating; no prizes. Scores are not verified against cheating; no prizes.

## Remaining blockers

- Validate fixed EXPIREAT lifecycle in real Redis, including post-inactivity erasure and all-period deletion. Existing pre-migration keys require a migration/cleanup plan before activation.
- Need real Redis Lua integration tests for 20-way same-member races, rollovers, deletion, TTL and budgets. No tests or CI are claimed green by this worker.
- Need days-played counts and securely authenticated own-rank; currently public top-20 only.
- Need stronger GET/POST/DELETE network rate caps, GPC/DNT handling and privacy copy aligned with actual retention.
- Need independent security/privacy/cost PASS on the exact integration SHA, plus verified Upstash billing and aggregate quota headroom.

Do not enable LEADERBOARDS_ENABLED or merge as release-ready on this evidence alone.
