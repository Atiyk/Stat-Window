> **Superseded on 2026-11-16 by PR #6** (integration with main, cutover 2026-11-17, one lock in `content/published.lock.json`, audit in `AUDIT-2026-11-16.md`). Kept below as the branch's original handoff.

# NBA database: parked work (not merged)

Status on 2026-11-16: **paused by the owner's scope change.** Nothing here is on `main` or in production. This branch (`content/nba-50-days`) is kept so the NBA-only transition can be picked up later. Do not merge it as-is: the cutover date (2026-11-18) is two days away and would need to move.

## What exists
- `data/nba/`: 279 facts (one question each), all sourced to single Wikipedia articles; 50 themed days (2026-11-18 → 2027-01-06, easy/medium/hard/hard/expert) plus 29 in reserve; rights register; 19 rejected examples.
- `db/migrations/001_init.sql` + `scripts/nba/db.ts`: reproducible SQLite build (same dump hash on every run) with uniqueness, ladder and stat-era triggers.
- `scripts/nba/model.ts`: the validator (sources, quotes, scope, seasons, stat first-recorded seasons, ranges and fairness, near-duplicates, daily and 7-day editorial mix, theme spoilers, present-tense record claims).
- `scripts/nba/publish.ts` + `content/lock.json`: writes `content/days` from `data/nba` and refuses to change published days.
- `scripts/nba/nba.test.ts`: 44 tests, one per gate. `e2e/nba.spec.ts` and an extended layout sweep (320–1440 px) for the first, middle and last NBA days.
- UI: a subtle difficulty label under the round count, the theme title above the question, the recap on results; Help text and source label credit Wikipedia contributors with a CC BY-SA 4.0 link.
- Docs: `docs/NBA_DATA_RIGHTS.md`, the NBA section of `docs/CONTENT.md`, generated `docs/nba/{questions.csv,calendar.md,validation.md}`.
- The old mixed-sport days 2026-11-18 … 11-27 were moved to `content/retired/` on this branch only. On `main` they are untouched.

## Verification so far
- Unit tests 105/105, browser tests 53/53, `content:check`, typecheck and build all passed on this branch.
- Independent critic sampled 33 facts (seed 20261116): every number matched its page. It vetoed on 4 issues (a theme title that gave away an answer, an unsupported "record" claim, a reworded quote, present-tense record claims without an as-of date). All four were fixed and validator rules added; **the critic has not re-reviewed yet.**
- Quote recheck against the live pages via WebFetch: 277 of 280 facts checked, 275 verbatim, 2 reworded (both corrected). Not yet rechecked: the 2 remaining facts in the second half of the list (run the check again before release).

## Open items before this could ship
1. Pick a new cutover date; the days before it must not change (the lock enforces this).
2. Critic re-review after the fixes; finish the quote recheck.
3. A person should read Wikipedia's reuse guideline once (could not be fetched from the build environment).
4. Editorial nice-to-haves from the critic: repeated pages (the Wilt 100-point game supplies 10 questions), the 1990s Bulls and 2013 Heat appear twice within a month, a few clunky prompts.
