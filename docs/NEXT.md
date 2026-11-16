# Next milestones (design only, nothing here is built)

Written 2026-11-16 after the NBA-only Daily Five release PR. Order matters: each step needs the one before it.

## Launch-day reset (owner decision, 2026-11-16)
stat-window.vercel.app is a pre-launch test site. The NBA calendar runs there from 2026-11-17 for testers only. When the owner says the game is live on its real domain, re-date the calendar so the Wilt day (calendar day 1) and Puzzle No. 1 fall on the launch date. That means a one-time, deliberate override of the published lock for the test days (no real players' saves exist yet), moving `EPOCH_DAY` and `NBA_CUTOVER`, and regenerating the Survival catalog, whose beta-gate date (now projected 2026-12-05) moves with it: about 18 days after launch. Do it in one PR, with the critic, before the domain goes public.

## 0. Before anything new: one week of real numbers
**Depends on:** the owner enabling Vercel Web Analytics and `VITE_ANALYTICS=vercel` (docs/MEASUREMENT.md).
**Done when:** `scripts/analytics-readout.ts` prints real rates (not "not enough data") for daily start → round 1 → all five, and next-day return, for at least 7 days of the NBA calendar.
**Don't build:** an A/B framework, a dashboard, accounts, or a leaderboard.

## 1. Survival MVP: BUILT behind a flag (see docs/SURVIVAL.md, 2026-11-16)
What follows is the original design note, kept for history. Where they differ, docs/SURVIVAL.md is current: the shipped ladder is 20…80 by round, the pool gate is 100 questions with three runs' worth per tier (first expected 2026-12-05 UTC), and reserves are used without a separate sign-off flag but are then spent as daily backups.

One life, up to 20 rounds, best run kept in the browser, instant restart.

**Question supply.** A separate pool, never the future daily calendar:
- past Daily Five questions (from `content/days` with date < today, so the pool grows by five a day), plus
- reserve facts that a second reviewer has signed off for Survival (`data/nba` gets a `survival: true` flag; the daily validator must refuse a fact that is both scheduled for a future day and Survival-eligible).
- Need: at least 150 eligible questions before launch (enough that a 20-round run rarely repeats within a week). On today's numbers that is ~10 published NBA days plus the 26 reserve facts after review, so roughly early December.

**Pass rule, calibrated to the real scoring** (`src/engine/scoring.ts`: points = round(100·f²), f = share of the scale your window excludes, measured in steps). A round survives when points ≥ T(r):

| Rounds | T(r) | Widest window that can pass |
|---|---|---|
| 1–5 | 10 | about 68% of the scale |
| 6–10 | 25 | 50% |
| 11–15 | 45 | about 33% |
| 16–20 | 64 | 20% |

Hitting with a wide window early is safe; late rounds force a real commitment. Difficulty comes from the window, not from obscure facts: draw rounds 1–5 from easy/medium, 6–15 from medium/hard, 16–20 from hard/expert. Show T(r) on screen before each lock.

**Acceptance:** a seeded run is reproducible (seed in the URL for sharing); the pool test proves no question dated today or later can be drawn; storage tests for best run, mid-run refresh and blocked storage; mobile layout sweep at 320–1440; analytics adds at most `/e/survival/{start,round-bucket,end-bucket}`.
**Size:** about one sprint. **Risk:** pool too small early on; repeat fatigue. **Don't build:** lives for sale, timers, badges, daily Survival leaderboards.

## 2. Derived-stats database (only after a licensed source exists)
Questions like "How many assists did the 1995–96 Bulls' fourth-best passer have?" need complete player-season rows, not the 276 curated statements in `data/nba`.

**First step is legal, not technical:** find a source whose licence allows reuse of a full table in a game. Basketball-Reference and NBA.com are excluded (docs/NBA_DATA_RIGHTS.md); GitHub/Kaggle mirrors inherit their rights. Candidates to evaluate: Wikidata (CC0, but sparse for season stats), team-season tables in Wikipedia articles (CC BY-SA, adapted tables must keep the licence), or a paid licence (outside the $0 budget). Write the answer in `docs/NBA_DATA_RIGHTS.md` before any import.

**Schema sketch** (SQLite, next to `db/migrations/001_init.sql`): `players(id, name)`, `teams(id, franchise_id, season, name)` (franchise vs team identity), `player_seasons(player_id, team_id, season, scope regular|playoffs, games, minutes, pts, reb, ast, stl, blk, tov, fg3m …, source_id, source_rev)`, a row per stint for traded players plus a `TOT` row; `NULL` (not 0) for stats not yet recorded in that era. Derived questions are saved SQL (`SELECT … ORDER BY ast DESC LIMIT 1 OFFSET 3`) with explicit tie rules, minimum games, and the query result frozen into the day file like today's facts.

**Proof of concept:** only if one team-season table can be sourced cleanly; otherwise stop at the rights memo. **Don't build:** bulk ingest, scraping, or a live stats API.

## 3. Three experiments, once step 0 has a baseline
1. **Theme hook vs plain opener.** Arm A shows the theme line above round 1, arm B hides it until results. Metric: first-touch ÷ start and round 1 → all five. Same questions for both.
2. **Share call to action.** "Challenge a friend" vs "Send these five to a friend". Metric: share attempts ÷ completions, and challenge starts ÷ share attempts.
3. **Next-day return.** A spoiler-free "Tomorrow: <theme title>" line on results (titles are already public in the static files). Metric: `visit/return/…/day1` ÷ `visit/new`. Guardrail: never a question, answer or countdown pressure.

Assign the arm per browser in localStorage and add it as a path segment (`/e/x/<test>/<arm>/…`); stop when each arm has at least 200 completions, or after two weeks.
