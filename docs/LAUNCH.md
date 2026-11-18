# Formal launch (Day 1) runbook

**Phase 1 does not switch the launch on.** Production stays in the public beta: same numbers ("No. 4" on 2026-11-18), same slates, same links, same saved games. This page describes the one step that switches it on.

## How numbering works (`src/engine/season.ts`)

| Concept | Value | Changes at launch? |
|---|---|---|
| Canonical puzzle day | the UTC date of `content/days/<day>.json` | never |
| Content id / fingerprint | `content/published.lock.json` | never |
| Season | `beta`, then `s1` from the launch day | yes, by config |
| Public number | beta: days since 2026-11-15 + 1; launch: days since `LAUNCH_DAY` + 1 | yes |

- The slate for launch day *L* is simply the slate already scheduled at *L*. Nothing in the content is renumbered or republished, and no released date gets a different puzzle. Only the label changes, which keeps the risk low.
- From *L*, *L* is "No. 1", *L+1* "No. 2"; every earlier day shows as "Beta No. N" in the header, results, share text and archive. Old `?day=` links still open the same five questions with the same answers.
- Stats, streaks and averages on the results screen count only the current season's runs, so beta games never inflate an official streak. Beta history stays saved and playable.
- Score percentiles are partitioned by season on the server (`sw:v1:production:s1:<day>`), and analytics paths get an `/e/s1/…` prefix, so beta and launch numbers never mix.
- Rollover stays at 00:00 UTC; the results screen already shows the local time.

## Choosing L

- *L* must be a day that already has a published slate (or will, after the Question Factory), and must be after today. If *L* is past the last scheduled day (`2027-01-27` today), schedule more content first: `docs/QUESTION-FACTORY.md`.
- Pick *L* at least 2 days ahead so a deploy can go out before midnight UTC.

## Preflight (the day before)

1. `npm ci && npm run content:check && npm test && npm run build`.
2. Dry run in a preview: build with `VITE_LAUNCH_PREVIEW=1` (Preview environment only) and open `/?launch-preview=<L>` with the clock on *L* and *L-1*. Check: header "No. 1" on *L*, "Beta No. N" on *L-1*; results stats show only *L*; share text says "Stat Window No. 1"; archive labels; Survival unaffected.
3. Unit tests cover it with a synthetic launch day: `src/engine/season.test.ts`.

## The one activation step

In Vercel → stat-window → Settings → Environment Variables, **Production**:

- `VITE_LAUNCH_DAY` = `<L>` (the client label), and
- `LAUNCH_DAY` = `<L>` (the score API's season),

then redeploy production (or merge anything) **before** 00:00 UTC on *L*. Both must match.

## Rollback

Delete both variables and redeploy. Labels return to beta numbering, stats include all runs again, and season-`s1` score data stays in its own keys (it never mixed with beta).

## Left out of Phase 1

- No reset of anyone's saved games, ever.
- No public "Day 1" announcement or numbering change in production.
- No relabelling of existing beta share messages already posted (they keep saying "No. N").
