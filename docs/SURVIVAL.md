# Survival (built, behind a flag, not public)

Daily Five stays the main game: five questions, once a day. Survival is the optional extra for chasing a personal best: 20 NBA questions, one life, replayable.

**Status on 2026-11-16:** code is in `main`'s next release behind `VITE_SURVIVAL` (default `off`). With the flag off, the Survival screens, the question catalog and the pool logic are left out of the production bundle and nothing Survival-related is reachable (`e2e/survival.spec.ts` checks that no Survival chunk loads and no button appears). A few kilobytes of shared code stay in the main bundle: the event path names, the experiment helper, the results-button text and `Round.tsx`'s optional Survival display. It must not be switched on before the pool passes the beta gate, projected for **2026-12-05 UTC** (see "Question supply").

## Rules (ruleset `sv1`, `src/survival/rules.ts`)

- Same brackets, same lock, same reveal and the same scoring function as the Daily Five (`src/engine/scoring.ts`, unchanged). Each round reuses the daily state machine (`src/engine/game.ts`) on a one-question slate.
- A round survives only when the answer is **inside** the window **and** the window earned at least that round's minimum. A miss scores 0, so it always ends the run.
- The lock button is disabled while the window is worth less than the minimum ("Tighten to 40+ to lock"), so nobody loses a run to a lock that could never survive. The engine still enforces the rule on its own, and "inside, but short" is still handled if a save is edited.
- 20 rounds. Surviving round 20 is a win ("All twenty. You survived.") and the run ends there.
- Score: rounds survived, then points from survived rounds as the tiebreak. The round that ended the run banks nothing.
- Personal best is kept per ruleset, so bests are never compared across rule changes. **Bump `RULESET` whenever a threshold, the round count or the tier plan changes.**
- No timers, no extra lives, no purchases, no leaderboard, no global ranks.

| Rounds | Tier drawn from | Label on screen | Minimum points |
|---|---|---|---|
| 1–4 | easy | Easy | 20, 25, 30, 35 |
| 5–8 | medium | Medium | 40, 44, 48, 52 |
| 9–12 | hard | Hard | 55, 58, 61, 63 |
| 13–16 | hard | Very hard | 65, 67, 69, 71 |
| 17–20 | expert | Expert | 73, 75, 78, 80 |

Labels are editorial, the same easy/medium/hard/expert ratings the Daily Five uses. They are not measured skill ratings, and no probability or percentile is shown to players.

### Why not the brief's 20 → 89 ladder

The candidate in the brief ended at 89. `npm run survival:sim` plays 10,000 seeded runs per ladder against the real eligible pool. Results on the beta-gate day (full output: `docs/survival/sim-2026-12-05.md`; the post-calendar pool: `sim-2027-01-06.md`):

| Ladder | "informed" player wins | "sharp" player wins | sharp median rounds | Questions left with a ≤2-step passing window |
|---|---|---|---|---|
| brief, 20…89 | 0.0% | 3.3% | 14 | 22 |
| **sv1, 20…80 (shipped)** | 0.2% | 19.6% | 17 | 9 |
| gentle, 15…75 | 0.4% | 28.4% | 18 | 6 |

The players are **assumptions, not measurements**: a guess error with a standard deviation of 22% (casual), 12% (informed) or 6% (sharp) of the scale, scaled by tier, and always playing the widest window that still earns the minimum. Also tested: a player who knows nothing and centres the window ("centre"). Under sv1 that player gets past round 4 about half the time and never past round 12, so the early rounds are a warm-up, not a free ride.

What the simulation says, and doesn't:
- At 89, the last rounds need a window about 6% of the scale. Even the sharp player survives the four expert rounds together about 9% of the time, and 22 of the 104 eligible questions would need a window of two steps or less (for example, 2 of 9 values on a 9-step scale). That is a coin flip on knowledge nobody has, so the brief's ladder was not kept.
- At 80, the last round needs about 11% of the scale. A win stays rare and earned.
- **No real player has played Survival.** These numbers only rule out ladders that are broken on paper. Real tester runs (`docs/USER-TESTING.md`) decide whether sv1 is fun; if it is not, change the thresholds and bump the ruleset.

Two fairness rules in the picker (`src/survival/select.ts`):
- A question is never put in a round where its passing window would be under 2 steps (`MIN_PASS_STEPS`).
- A tier that runs short fails closed: the run is not started. Round 1 never gets a hard question to fill a gap.

## Question supply

One selector, `eligiblePool()` in `src/survival/pool.ts`, runs in the browser against the real UTC date:
- **Published Daily Five questions** only after their day is over (`day < today`). Never today's puzzle, never a future day, whatever the URL says. Only NBA days from the cutover on; the two mixed-sport launch days are excluded. A day file that is missing contributes nothing.
- **Reserve facts** (26 in `data/nba/calendar.json`), which are reviewed but scheduled for no day.
- **Leak holds.** `scripts/nba/survival.ts` scans every question's prompt, context, reveal and source quote for the printed answer of a related daily question (same season, same player, or a text that names that daily's player by surname). If it finds one, that question waits until the day after that daily has been played (`notBefore`). On today's data, 42 questions are held this way, including 5 reserves; the critic found one the first version missed (reserve `nba-wilt61-78` reveals "breaking Baylor's 71", the 2026-11-22 answer), now held to 2026-11-23 and covered by a test. The check is cautious, so some holds are false alarms; they cost a few days of supply. It does not catch answers written as words ("seven") or a spoiler that names neither season nor player; editorial review still matters.
- Rejected and quarantined facts are not in the calendar, so they never reach the catalog. Source attribution (Wikipedia, CC BY-SA 4.0) is shown on every reveal exactly as in the Daily Five.

The catalog (`content/survival/catalog.json`) is generated from `data/nba` by `npm run survival:catalog`; CI fails when it is out of date (`npm run survival:catalog:check`). It also refuses a change that moves a reserve onto a Daily Five day, because once Survival is live a reserve may already have been seen. **Consequence for the owner:** after launch, the 26 reserves are spent as Daily Five backups. Emergency replacements for a broken daily question then need a newly written and verified fact.

### Eligible supply by UTC day (current calendar)

Computed by the same function, with the tier counts the beta gate needs (per tier, three runs' worth: easy 12, medium 12, hard 24, expert 12; and 100 in total):

| UTC day | Total | Easy | Medium | Hard | Expert | One run possible | Beta gate |
|---|---|---|---|---|---|---|---|
| 2026-11-16 (today) | 21 | 0 | 10 | 9 | 2 | no | no |
| 2026-11-17 (cutover) | 21 | 0 | 10 | 9 | 2 | no | no |
| 2026-11-18 | 26 | 1 | 11 | 11 | 3 | no | no |
| 2026-11-22 | 43 | 4 | 14 | 18 | 7 | yes | no |
| 2026-11-29 | 75 | 11 | 20 | 32 | 12 | yes | no |
| 2026-12-04 | 98 | 16 | 25 | 41 | 16 | yes | no (total 98) |
| **2026-12-05** | **104** | 17 | 27 | 43 | 17 | yes | **yes (first day)** |
| 2026-12-20 | 179 | 32 | 42 | 73 | 32 | yes | yes |
| 2027-01-06 (calendar over) | 276 | 50 | 62 | 112 | 52 | yes | yes |

The pool only grows, by about five a day, until the calendar ends on 2027-01-05; after that it stays at 276 unless new days are published. Regenerate this table after any calendar change (`node --experimental-strip-types scripts/survival-sim.ts --asof <day>` prints the counts for a day).

Easy questions are the binding constraint: the reserve has none, so every easy question comes from a finished day. Until 2026-12-05 there is no honest way to open Survival without repeats or mis-tiered rounds, and the 100 figure is a pragmatic launch line, not a statistical rule. **No extra questions are needed to reach the gate; it needs 19 more days of the existing calendar.**

### Run selection

`pickRun(pool, seed, recent)` is deterministic for a given pool, seed and recent list. Each run stores its seed and its 20 question ids at the start, so a refresh, a second tab or a later day never reshuffles it. Within a tier it prefers, in order: questions not in the last 3 runs, then a franchise, stat family and source day not already in the run, then a different franchise and era from the previous round. On the full pool no franchise appears more than four times in a run (tested over 100 seeds). On a small pool, repeats across runs will happen; the game doesn't promise otherwise.

## Saves

`stat-window:survival:v1`, separate from the Daily Five save `stat-window:v1`, so nothing in Survival can change daily runs, practice runs, stats or streaks (tested). Validated on read; anything malformed or inconsistent (results that don't match the run's questions) is set aside under `…:corrupt` and the player starts fresh. First lock wins across tabs, and a new run can't be started while one is in play, so there are no free retries by refreshing or opening a second tab. With storage blocked, Survival runs in memory and the page shows the existing "isn't saving progress" note. Preview runs with a simulated date use their own key, `stat-window:survival-preview:v1`.

## Flag and preview

| `VITE_SURVIVAL` | What happens |
|---|---|
| unset / `off` | No Survival code in the bundle. `/?survival` opens the Daily Five. |
| `preview` | `/?survival` opens Survival with a "Preview build" note. `&asof=YYYY-MM-DD` simulates a later UTC day, so the full pool can be tried today. Only for Vercel **Preview** deployments: `asof` can show questions from days that haven't been played. A preview build never sends Survival events and keeps its runs under a separate key, with or without `asof`. |
| `on` | Public. `/?survival` works and today's finished Daily Five results show a quiet "Try Survival: 20 rounds, one life" button, but **only while the pool passes the beta gate on that UTC day**; before that, `/?survival` shows "Not open yet" and no button appears. `asof` is ignored. |

Limitation: the date comes from the player's device clock, as it does for the Daily Five. Someone who sets their clock forward can see later questions in either mode. All day files are public static files anyway (`docs/CONTENT.md`); the gate protects ordinary players from spoilers, not the content from a determined reader.

## Measurement (only when analytics is on)

Fixed paths, about five per run, no ids, answers or exact scores:

| Path | When |
|---|---|
| `/e/survival/start/{cta,link,again}` | a run starts: from the results button, from a `/?survival` link, or from "Run it again" |
| `/e/survival/reach/r{5,10,15}` | a run survives round 5, 10 or 15 |
| `/e/survival/end/r{1-4,5-8,9-12,13-16,17-20}/{miss,short}` | a run ends, by band of the round that ended it and why |
| `/e/survival/win` | round 20 survived |
| `/e/survival/share/{native,clipboard,failed,cancelled}` | the spoiler-free share (rounds and points only) |

Each is sent once per run (`trackOnce`, keyed by run id), so a refresh or second tab doesn't double count. Readout: `scripts/analytics-readout.ts` prints the Survival rows (see `docs/MEASUREMENT.md`).

Learning questions and how to read them:
1. **Do Daily Five finishers try it?** `survival/start/cta` ÷ `complete/daily/*` (only browsers shown the button can click it; under the experiment, use the `cta` arm's `exposed` as the denominator).
2. **Do starters come back for a second run?** `survival/start/again` ÷ (`start/cta` + `start/link`). "Again" is only the deliberate button press.
3. **Where do runs end, and why?** The `end/{band}/{reason}` rows. A pile-up of `short` would mean the minimum is confusing (it should be rare, since the lock refuses short windows); a cliff at one band means that band's thresholds or questions are off. To tell knowledge from UI friction, use the tester sessions, not these counts.
4. **Does it help or hurt the daily habit?** Only the experiment below can answer that.

Survival adds about 5 events per run to the Hobby allowance of 50,000 a month; at 1,000 runs a month that is about 10% of it.

## The one experiment: "Try Survival" after the Daily Five

Built, off by default (`VITE_SURVIVAL_CTA_TEST=1`). It runs only when Survival is `on`, analytics is on, and the pool passes the gate.

- **Assignment:** each browser, once, 50/50 at random, kept in `stat-window:x:survival-cta:v1`. A browser that can't store an arm sees the control screen and sends no experiment events.
- **Treatment:** the quiet secondary button on today's results. **Control:** today's results unchanged. Everyone gets the same daily questions.
- **Events:** `/e/x/survival-cta/{cta,control}/{exposed,first-exposure,click,daily-start,next-day-start,daily-share}`. `exposed` is once per browser per day when today's results are on screen (a browser-day); `first-exposure` is once per browser ever; `click` and `daily-start` are once per browser per day; `next-day-start` is an official daily start by a browser that was exposed the day before.
- **Primary outcome:** next-day participation = `next-day-start` ÷ `exposed` per arm, per exposed browser-day. A Pages export covers one date range, so exposures on its last day and next-day starts on its first day are both cut off; over a range of two weeks or more these roughly cancel, but the rate is approximate.
- **Secondary:** Survival starts and "again" restarts in the `cta` arm.
- **Guardrail:** `daily-share` ÷ `exposed` must not drop in the `cta` arm.
- **Stop rule:** at least 200 browsers per arm (`first-exposure`), or two weeks, whichever is later. Report the raw counts and the readout's rough 95% interval for the difference. That interval treats each browser-day as independent, so it is too narrow when the same browsers come back many days; read it as a best case. With ~200 browsers per arm, differences under about 10 points are noise. Don't declare a winner on less.
- **Not built:** fake social proof, countdowns, or anything that changes daily questions by arm.

## Release checklist for turning it on (owner decision)

1. Analytics confirmed receiving in production (`docs/MEASUREMENT.md`, "Turning it on", step 4).
2. The pool passes the gate on the real date (first expected 2026-12-05 UTC; `node --experimental-strip-types scripts/survival-sim.ts --asof <day>`).
3. At least five tester sessions from `docs/USER-TESTING.md` on a Preview deployment with `VITE_SURVIVAL=preview`, with no blocker found.
4. Then set `VITE_SURVIVAL=on` for Production in Vercel and redeploy (one coordinated deploy). Add `VITE_SURVIVAL_CTA_TEST=1` at the same time only if analytics is confirmed.
