# Leaderboard hardening status (not approved for activation)

The opt-in leaderboard remains disabled by default. The worker fixes the shared command ceiling: all leaderboard reads and submissions atomically check the existing percentile budget counters (380,000 monthly and daily cap) and their own separate monthly suballocation (at most 20,000). Both are charged in the same Lua script. This is a suballocation **inside** the existing 380,000, not an extra 20,000. Existing percentile deletions continue to use their separate 20,000 reserve. Upstash Free's 500,000 monthly command quota includes operations outside these scripts; budget accounting and real Redis tests remain mandatory before activation.

Linked player hashes and ranked period keys now use a 400-day TTL rather than 90 days. This avoids prematurely losing the browser-to-score link during a conventional NBA season, but **does not prove complete deletion or full-season semantics** if the configured season lasts more than 400 days. Full season, deletion and expiry guarantees require a formal bounded season end and expiration policy before activation. Scores are not verified against cheating; no prizes.

## Remaining blockers

- A 400-day TTL alone is not a complete lifecycle design: require bounded season lengths, per-period retention and deletion of all retained linked scores, including long inactivity and late submissions.
- Need real Redis Lua integration tests for 20-way same-member races, rollovers, deletion, TTL and budgets. No tests or CI are claimed green by this worker.
- Need days-played counts and securely authenticated own-rank; currently public top-20 only.
- Need stronger GET/POST/DELETE network rate caps, GPC/DNT handling and privacy copy aligned with actual retention.
- Need independent security/privacy/cost PASS on the exact integration SHA, plus verified Upstash billing and aggregate quota headroom.

Do not enable LEADERBOARDS_ENABLED or merge as release-ready on this evidence alone.
