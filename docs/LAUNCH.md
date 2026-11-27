# Formal launch (Day 1) runbook

This page is the runbook for the one step that switches the official season on, and the record of where that step stands.

## Current state (2026-11-26)

| Item | State |
|---|---|
| `LAUNCH_DAY` | `'2026-11-30'`, committed in `src/engine/launch-config.ts` (merged to main in PR #32, `866902e`). |
| Scheduled activation | 12:00 AM Eastern on Monday 2026-11-30 (05:00 UTC): that day becomes "No. 1". Until then production numbers days as the beta. |
| Observed activation | Not yet. It counts as observed only once someone opens production on 2026-11-30 and sees "No. 1". Record the time and who checked here. |
| Production | The first build of the V5.1 merge (18:20 UTC, 2026-11-26) failed: `VITE_LAUNCH_DAY=2026-11-28 disagrees with LAUNCH_DAY=2026-11-30`. Production was redeployed with V5.1 at 19:05 UTC and that build passed, so no Production variable disagrees with the commit any more. |
| Preview environment | Still had `VITE_LAUNCH_DAY` and `LAUNCH_DAY` set to `2026-11-28` at last check. The owner asked for both to be deleted. Until they are, every Preview build fails `assertLaunchEnv`. |

**Delete `VITE_LAUNCH_DAY` and `LAUNCH_DAY` from every Vercel environment (Production, Preview and Development).** Nothing reads them any more. The launch day is the committed value, and `assertLaunchEnv` (called from `vite.config.ts`) fails any build whose environment sets either one to a different value. In Vercel → stat-window → Settings → Environment Variables, check each environment separately.

## How numbering works (`src/engine/season.ts`)

| Concept | Value | Changes at launch? |
|---|---|---|
| Canonical puzzle day | the Eastern calendar date of `content/days/<day>.json` | never |
| Content id / fingerprint | `content/published.lock.json` | never for a published day; unpublished days follow `data/nba` |
| Season | `beta`, then `s1` from the launch day | yes, by config |
| Public number | beta: days since 2026-11-15 + 1; launch: days since `LAUNCH_DAY` + 1 | yes |

- Before *L*, editorial may revise unpublished slates and regenerate their lock entries. Published days never change. The official launch day *L* must have a verified slate.
- From *L*, *L* is "No. 1", *L+1* "No. 2". The public archive starts empty and grows from *L* onward. Beta slates earlier than *L* are hidden from the archive and not playable through old `?day=`/`vs` challenge links. Retired links show an explicit message and open today's game without the old comparison score. Before *L*, the beta catalog behaves as before.
- Stats, streaks and averages count only the current season's runs. Historical beta saves remain stored but are no longer publicly playable after launch. A catalog reset is **not** permission to delete local data, percentile data, or participant erasure records.
- Score percentiles are partitioned by season on the server (`sw:v1:production:s1:<day>`), and analytics paths get an `/e/s1/…` prefix, so beta and launch numbers never mix.
- Rollover is at 12:00 AM Eastern (DST-aware); the results screen already shows the local time.

## Choosing L

- *L* must be a day that already has a published slate (or will, after the Question Factory), and must be after today. If *L* is past the last scheduled day (2027-01-27 on 2026-11-26), schedule more content first: `docs/QUESTION-FACTORY.md`.
- Pick *L* at least 2 days ahead so a deploy can go out before midnight Eastern.

## Launch inventory

Every unpublished day from *L* on is launch inventory. The V5.2 audit covers every official slot from `VARIETY_FROM` (2026-11-30) to 2027-01-27: 59 days, 295 slots, each 2/2/1 across recall, reference and missing-point (see [V5.2.md](V5.2.md)). Choosing L does not change content. Before activating, confirm `npm run content:publish:check` is clean and that `data/nba/editorial/v52-audit.json` still has one entry per official slot (the "V5.2 official-season audit" block in `scripts/nba/formats.test.ts`). Days added after the audit need their own editorial batch through `scripts/nba/revise.ts`. The V5.0 (`launch-audit.json`) and V5.1 (`v51-audit.json`) audits are frozen records.

## Preflight (the day before)

1. `npm ci && npm run content:check && npm test && npm run build`.
2. Dry run in a preview: build with `VITE_LAUNCH_PREVIEW=1` (Preview environment only) and open `/?launch-preview=<L>` with the clock on *L* and *L-1*. Check: header "No. 1" on *L*; beta catalog still works before *L*; on *L*, archive is empty, retired beta `?day=` links show a notice and today's game, results stats show only *L*, share text says "Stat Window No. 1"; on *L+1*, archive contains only *L*. Check valid s1 challenges, old saves, Eastern DST, Survival, and privacy remain unaffected.
3. Unit tests cover it with a synthetic launch day: `src/engine/season.test.ts`.

## The one activation step (V5.1: committed, not a dashboard variable)

The launch day lives in **`src/engine/launch-config.ts`** (`LAUNCH_DAY`), one value read by the client label, the score API's season and the CI gates. Activation is a reviewed commit to main that sets it to *L*; Vercel deploys main automatically.

- `npm run season:check -- --base origin/main` (CI runs it on every PR against main, and on every push to main against the commit before it) refuses a change unless *L* is a real date **at least 2 days after today (Eastern)** (so a PR that went green late in the evening still lands before the boundary if it is merged the next day), on or after `VARIETY_FROM` (2026-11-30, so every official slate passes the 2/2/1 format rule), with at least 28 consecutive official slates from *L*. A season that has started can't be moved or cancelled by an ordinary change.
- The build fails if `VITE_LAUNCH_DAY` or `LAUNCH_DAY` is still set in an environment to a different value (`assertLaunchEnv`), so a stale dashboard value can never split the client and server seasons. Delete both from every Vercel environment, Preview included (see Current state).
- **The production build guards the boundary itself**, because Vercel deploys main without waiting for CI. It does not repeat the whole season check (lead time, runway, moves); it checks one thing: with `VERCEL_ENV=production`, once `LAUNCH_DAY` has begun, `vite.config.ts` builds only if production already serves that same launch day (it reads `https://$VERCEL_PROJECT_PRODUCTION_URL/launch.json`). So whichever commit would switch a begun season on mid-day, the launch commit or any later one, is refused, and the previous deployment (beta) stays live. If production can't be read (an outage), the build is refused too; set `LAUNCH_GUARD_ACK=<L>` for that one deploy only after checking that production already shows No. 1. A preview switch (`VITE_LAUNCH_PREVIEW`) also fails a production build.
- Make the CI check a **required status** on main (GitHub → Settings → Branches → main → Require status checks: `check`), so a PR whose check went stale can't be merged without re-running it.
- Tabs opened before the activation deploy fetch `/launch.json` at the midnight rollover and reload if the deployed launch day differs from their bundle, so a long-open tab doesn't keep beta numbering on *L*.
- Merge before 12:00 AM Eastern on *L*. Until the boundary the merged build behaves exactly like beta (the same code path the launch e2e proves with a future launch day); at the boundary today becomes No. 1. This is **scheduled** activation; it is **observed** only after someone opens production on *L* and sees No. 1.
- **Never mid-day.** If the merge slips past midnight Eastern of *L*, the push check fails and the production build refuses to deploy it (and every later production build, since production still serves beta). Players are unaffected: the beta deployment stays live. To recover, commit `LAUNCH_DAY = null` with `SEASON_ROLLBACK_FROM = '<L>'` (the season never went live, so no `s1` data exists and no new season id is needed), then schedule a new future day in a following PR. The same applies after a Vercel Instant Rollback to a pre-launch deployment.
- `LAUNCH_GUARD_ACK` is a one-deploy override; delete it from the Vercel environment straight after (the build warns while it is set).

## Moving to a custom domain

Analytics only runs on its production hostnames (`docs/MEASUREMENT.md`). Before or with the domain change, in Vercel → stat-window → Settings → Environment Variables, **Production**:

- `VITE_ANALYTICS_HOSTS` = `<your-domain>,stat-window.vercel.app` (comma-separated exact hostnames; add `www.<your-domain>` too if it serves the game rather than redirecting),

then redeploy production. No code change is needed. Unset, the list is `stat-window.vercel.app` only, so a build served from the new domain would send nothing. The score API needs no change: it accepts requests whose `Origin` matches the host they were sent to (`server/api.ts`, `sameOrigin`). Check receipt as in `docs/MEASUREMENT.md`, "Turning it on", step 4, on the new domain.


## Rollback

- **Before *L*:** revert the commit (or set `LAUNCH_DAY = null`). Nothing has changed for players.
- **After *L* (emergency only):** in one reviewed commit, set `LAUNCH_DAY = null` and `SEASON_ROLLBACK_FROM = '<L>'` (both in `src/engine/launch-config.ts`). The season check accepts cancelling a started season only when the acknowledgement names it, so the step needs no CI secret and shows in review. Deletion keeps working: DELETE searches every season in `SEASONS`, whatever the launch day is now. Labels return to beta numbering and stats include all runs again. Season `s1` score, question-aggregate and analytics data stay in their own `s1` keys and paths (they never mixed with beta), so a later relaunch must use a **new season id** (`s2`), never re-open `s1`: add it to `SeasonId` in `src/engine/season.ts` and give it its own keys. Challenge links of `s1` days then retire like beta links did. Do not flush Redis or clear anyone's local data.

## What launch does not do

- It deletes no one's saved game or privacy data; it only retires the visible, playable beta catalog.
- It does not relabel beta share messages already posted (they keep saying "No. N").
