# NBA daily question selection and sequence — editorial gate

## Goal
Not five increasingly obscure facts. Five satisfying basketball judgments that make someone want to finish, compare and return tomorrow.

A 24-second per-question shot clock means every prompt must be scannable and **estimable**. Memorizing a 1983 micro-record is not the desired skill.

## Before locking any future day
1. **Q1: easy, recognizable, quick win.** A current or widely known player, famous team or iconic game. A newcomer should understand it in <5 seconds and have a plausible range in <15.
2. **Q2: recognizable plus curiosity.** Extend Q1's narrative or introduce a vivid contrast. Use a different stat family.
3. **Q3: surprise/reveal.** A striking number that fans will want to tell friends. This is the mid-game reward, not trivia homework.
4. **Q4: tougher judgment.** Require real basketball knowledge, but the range must allow informed estimation rather than one exact memorized number.
5. **Q5: satisfying finish.** Highest difficulty may be fine, but finish on a *memorable* star, rivalry, record or comeback, not an obscure unguessable split. Make the reveal worth waiting for.

## Editorial rejection tests
- Can't name a recognizable person/team/event in Q1 or Q5? Rework the slate.
- Two adjacent questions feel like the same arithmetic or same player-stat pair? Replace one.
- Can a reasonable fan bound the answer before time expires? If not, rephrase or drop.
- Does an average fan need to know the exact record to have any chance? Reject.
- Is the answer already in the prompt, prior reveal or another day's bonus fact? Reject.
- Are historical windows biased around the same relative scale position? Keep the existing build gate.
- Is a theme title hiding spoilers or editorially unnecessary? Keep it spoiler-free and concise.

## First look at seven upcoming days (audit, NOT a publication change)
- **Nov 22, Russell/Wilt/Baylor:** Q1 eight Celtics titles is a decent hook; Q4 quarter rebounds and Q5 half rebounds feel too similar and too obscure under a shot clock. Replace one with an iconic Wilt/Russell moment through the canonical factory.
- **Nov 23, 72–10 Bulls:** Strong recognizable opener, but two Rodman rebound angles compete. Consider an MJ/Pippen moment near the finish.
- **Nov 24, 2006/2011 Finals:** Strong narrative and finale. Favor this structure.
- **Nov 25, Splash season:** Strong subject familiarity. Keep Curry's record overtime as the finale.
- **Nov 26, Rip City:** Five obscure historical splits is a poor casual-fan day. Highest-priority content rebuild. Keep the story but replace at least two prompts with estimable, resonant NBA questions.
- **Nov 27, Mamba:** Great household-name hook; a full run of Kobe facts risks narrow variety. Candidate for novice testing.
- **Nov 28, Rock bottom:** Themed losing streak narrative is interesting; make the last reveal vivid rather than another dry number.

## Workflow and release safeguards
- Generate replacement candidates via docs/QUESTION-FACTORY.md and its actual source checks.
- Independent source and editorial approval for all replacements.
- Do not re-order or change a published score fingerprint; never invalidate saved results or prior links.
- Future pre-release changes go through the NBA calendar publisher, content locks and full CI, not client-only runtime reshuffling.
- Test the candidate slate with five casual NBA fans and five enthusiast NBA fans; record which question caused stall, frustration, laughter or surprise. A 24-second timer is a content stress test.
- Measure first-round touch, each lock, five-question completion and next-day return. Retention effects are hypotheses until actual cohort data are collected.

## V3 mixed-slate publication — 2026-11-22

This change remixes **only the 66 not-yet-published NBA slates** (2026-11-23 onward) from already sourced, reviewed numeric facts. Every question retains its original ID, answer, scoring scale, source excerpt, reveal and difficulty; no new sourced claims are invented. Each day uses five different storylines/teams rather than five splits of a single club. The canonical `data/nba/calendar.json` and generated `content/days/*.json` plus future entries of `content/published.lock.json` must stay byte-consistent.

**Editorial caveat:** 66 opening slots but only 42 existing eligible easy questions currently meet the combined interest >=4, recognizability >=4, estimability >=3 bar. We front-load those 42 into the first 42 future days. The final 24 days retain the less compelling sourced easy candidates pending new independent fact research and verification. No weaker easy is reclassified merely to pass a numerical gate. All future slates are labelled as mixed; the previous single-team theme title and recap no longer represent the content.

**Remaining human gate:** an independent basketball editor must review each remixed five-question arc, especially Q5, and confirm that the daily variety feels fun rather than mechanically shuffled. The scripts and automated checks alone cannot establish enjoyment. Run full `content:publish:check`, `content:check`, `nba:report:check`, `survival:catalog:check`, `factory:check` and complete CI before merging. This worker cannot claim those checks ran locally.

## Editorial re-sequencing follow-up — 2026-11-22

This worker swapped **13** previously source-documented, already high-rated medium Q2 questions into weaker future Q1 slots, and moved each displaced weaker opener to the vacated Q2 slot. Original numerical answers, source URLs, source excerpts, fun facts and ratings were **not altered**. Only difficulty labels and editorial reasons were changed for the swapped facts. 22 future daily slates and their future-only scoring locks were regenerated deterministically from the canonical NBA data shape. No published day on or before 2026-11-22 was changed.

This is **partial remediation, not editorial PASS**: 11 future Q1 remain below the engagement threshold. The moved specialist Q2 questions and all Q5 finales still need independent basketball-fan review; source excerpts are inherited from the existing corpus and were not independently re-opened in this run. The existing Q1 validator still warns on post-January-3 dates. Run `node --experimental-strip-types scripts/nba/editorial-audit.ts --strict` to inspect remaining failures; it intentionally fails while there are blockers. Run the canonical publisher and full content/source/CI gates before integrating. No rating was inflated to meet the threshold.

Swap record (date, new opener, old opener moved to source date Q2):
- 2027-01-14: nba-hawks15-january-wins ⇄ 2026-11-27: nba-warriors75-season-wins
- 2027-01-23: nba-paul08-regular-apg ⇄ 2027-01-03: nba-booker17-70
- 2027-01-09: nba-nash05-regular-apg ⇄ 2027-01-04: nba-rockets18-wins
- 2027-01-16: nba-miller95-8-points ⇄ 2027-01-08: nba-celtics84-wins
- 2027-01-04: nba-kawhi19-playoffs-ppg ⇄ 2026-12-01: nba-miller92-57
- 2027-01-10: nba-giannis21-playoffs-ppg ⇄ 2026-12-11: nba-bucks71-wins
- 2027-01-12: nba-cavs09-home-wins ⇄ 2026-11-26: nba-shot-clock-24
- 2027-01-15: nba-iverson01-season-ppg ⇄ 2026-12-18: nba-pistons89-wins
- 2027-01-05: nba-jordan86-63 ⇄ 2027-01-10: nba-allstar10-attendance
- 2027-01-06: nba-spurs14-march-wins ⇄ 2027-01-12: nba-howard09-g4-blocks
- 2027-01-07: nba-rose11-season-ppg ⇄ 2026-12-10: nba-jordan93-g4-55
- 2027-01-13: nba-jokic23-finals-average ⇄ 2027-01-05: nba-lakers00-wins
- 2027-01-18: nba-lebron16-finals-ppg ⇄ 2026-12-16: nba-spurs14-streak


## Future-only source-verified opener replacement — 2026-11-22

Two independently checked Wikipedia article excerpts substantiate new numeric questions. On future 2027-01-08, the opening `nba-robinson94-71` is replaced by `nba-kobe06-second-half-55` (55 second-half points in Kobe Bryant's 81-point game, https://en.wikipedia.org/wiki/Kobe_Bryant%27s_81-point_game). On future 2027-01-24, `nba-gsw15-combined-wins` is replaced by `nba-curry16-season-threes-402` (402 made threes in Curry's 2015–16 season, https://en.wikipedia.org/wiki/2015%E2%80%9316_Golden_State_Warriors_season). Five-question difficulty and diversity checks were preserved; no previous answer/rating was inflated. The displaced January questions remain in reserve, with canonical `calendar.reserveNotBefore` holds until 2027-01-09 and 2027-01-25, respectively, so they **cannot appear early in Survival**. A regression test protects this embargo.

One-time GitHub Actions publisher run [45067168488](https://github.com/Atiyk/Stat-Window/actions/runs/45067168488) passed `content:publish`, `nba:db`, `nba:report:check`, `content:publish:check`, `survival:catalog:check`, content/trivia/factory checks, typecheck, 373 unit tests and build. It generated exactly two future day files, the scoring lock, reports and Survival catalog. No day on or before November 22 was altered. The temporary workflow was removed after success.

**Still blocked, not editorial PASS:** after these changes, 9 future Q1 and 66 future Q5 are flagged under the agreed rating thresholds. Automated ratings are triage, not evidence that a fan enjoys a question; each final needs independently checked editorial quality and provenance. Do not release as a complete V3 editorial slate before the remaining work and final exact-SHA CI, WebKit and independent editorial critic approval.

## Future-only verified replacements — November 22, 2026

Nine additional January 2027 weak openers were replaced with source-documented recognizable NBA star moments, bringing future weak Q1 to zero under the 4/4/3 numerical audit. The other two weak openers (Jan 8, Jan 24) had already been fixed in the same worker branch with Kobe and Curry. Two Nov 23–24 weak expert finales were replaced with sum-based memorable 2016 Cleveland and Splash Brothers events. The other 64 weak Q5 still require new sourced fact research; this is explicitly NOT release/editorial PASS.

Eleven displaced future-only questions were retired from the scheduled corpus. The earlier two displaced January questions (David Robinson's 71 and 2014–15 Warriors combined wins) remain in Survival reserve with original-date embargoes (January 9 and January 25, 2027 respectively), preserving the existing no-spoiler reserve regression test and avoiding cutover beta supply changes. No 2026-11-22-or-earlier daily record or score fingerprint was changed. All 11 new facts have cited Wikipedia excerpts and three sourced bonus facts; ratings are editorial judgments and were not increased on preexisting records.

Replacement evidence and why it is estimable:
- 2027-01-11 Q1, `nba-mitchell23-seventy-one`: A recent Cleveland comeback with a star scorer and a memorable 70-point outing; bounded high-end estimate. Source https://en.wikipedia.org/wiki/Donovan_Mitchell — “career-high, and Cavaliers-record 71 points, along with eight rebounds and 11 assists”.
- 2027-01-17 Q1, `nba-luka24-73-hawks`: Luka's widely shared scoring explosion is a recent star moment; an informed fan can bracket a high career-best total. Source https://en.wikipedia.org/wiki/Luka_Don%C4%8Di%C4%87 — “finishing with a career-high 73 points (shooting 25-of-33 overall, with eight three-pointers made)”.
- 2027-01-19 Q1, `nba-embiid24-70-spurs`: A recent MVP and career-high 70-point night provide a modern, relatable range-estimation anchor. Source https://en.wikipedia.org/wiki/Joel_Embiid — “On 22 January, Embiid scored 70 points along with 18 rebounds and five assists”.
- 2027-01-20 Q1, `nba-jokic23-playoff-triple-doubles`: Jokić's championship and triple-double reputation are broadly known; postseason length bounds the estimate. Source https://en.wikipedia.org/wiki/Nikola_Joki%C4%87 — “Most triple-doubles in the same postseason (10): Denver Nuggets, 2022–23”.
- 2027-01-21 Q1, `nba-klay15-quarter-37`: A widely circulated iconic quarter, not an arbitrary micro-split; bounds come from ordinary quarter scoring. Source https://en.wikipedia.org/wiki/Klay_Thompson — “In the third quarter of that game, he scored an NBA-record 37 points for a single quarter”.
- 2027-01-22 Q1, `nba-curry23-game7-fifty`: Recent star elimination game, familiar rivalry and a meaningful single-game scoring estimation band. Source https://en.wikipedia.org/wiki/Stephen_Curry — “In Game 7 of the Warriors' first round playoff series against the Sacramento Kings, Curry scored a playoff career-high 50 points”.
- 2027-01-25 Q1, `nba-lillard23-seventy-one`: Famous deep-range shooter in a recognizable modern scoring moment; estimable relative to other 70-point games. Source https://en.wikipedia.org/wiki/Damian_Lillard — “a career-high and Blazers franchise-high 71 points with a career-high and Blazers franchise-high 13 three-pointers made”.
- 2027-01-26 Q1, `nba-wemby24-five-five-points`: Wemby's famous all-around rookie game is recognizable; defining five-by-five makes the bound understandable. Source https://en.wikipedia.org/wiki/Victor_Wembanyama — “Wembanyama put up a five-by-five with 27 points, 10 rebounds, eight assists, five steals, and five blocks”.
- 2027-01-27 Q1, `nba-tatum23-game7-51`: A recent Celtics-Sixers playoff rivalry and a widely known star performance provide a fair, high-stakes estimate. Source https://en.wikipedia.org/wiki/Jayson_Tatum — “he scored a playoff career-high 51 points in a 112–88 victory over the Philadelphia 76ers”.
- 2026-11-23 Q5, `nba-lebron-kyrie16-g5-combined-82`: The iconic 3–1 comeback and two famous scorers create a difficult but approachable two-player total. Source https://en.wikipedia.org/wiki/2016_NBA_Finals — “James and Irving each scored 41 points to become the first teammates in Finals history to score 40 or more in the same game.” (derived: LeBron 41 + Kyrie 41 = 82 points combined, both figures in the cited sentence.).
- 2026-11-24 Q5, `nba-splash16-duo-threes-678`: Two iconic shooters from the 73-win Warriors year supply a meaningful expert combined-total estimate. Source https://en.wikipedia.org/wiki/Klay_Thompson — “a record they broke the following season with 525 and again in the 2015–16 season with 678”.

**Required after branch publication:** canonical publisher + `nba:report` + `survival:catalog` must regenerate future day files, scoring locks, derived reports and spoiler-safe Survival; run full `content:publish:check`, `nba:report:check`, `survival:catalog:check`, `content:trivia:check`, `content:check`, `factory:check`, TypeScript, unit and source rights checks. Run `scripts/nba/editorial-audit.ts --strict` (expected to fail on remaining Q5 until more improvements). Independent critic sign-off and fan testing have not occurred.


The 2026-11-22 canonical source/score gates exposed a regression test requiring the two displaced Q1 records in the spoiler-embargoed reserve. Those exact original sourced records were restored without changing their ratings or original source excerpts. The reserve release dates match the day after each prior January slot.

## Three further memorable Finals and playoff finales (November 22, 2026)

Nov 25–27 Q5 replaced by a playoff-arc scoring estimate from Kawhi Leonard's 2019 title, Jimmy Butler's record 2023 eighth-seed upset, and the full 2010 Lakers-Celtics Game 7 point total. Each answer was checked against the specific linked Wikipedia passage; all bonus variants include short citations. No historical days or original fact ratings changed; the displaced future-only expert records were retired instead of being silently reclassified. This brings future numerical Q5 failures to **61/66**, and Q1 remains at 0/66. Independent fan appeal review is outstanding.
- Nov 25 Q5 — `nba-kawhi19-playoff-points-732`: Kawhi's historic 2019 Raptors title is iconic; a postseason of around two dozen games at roughly 30 points yields a plausible expert estimate. Evidence https://en.wikipedia.org/wiki/Kawhi_Leonard, excerpt “Leonard scored 732 points during the 2019 playoffs; this was the third-best scoring total for a single NBA postseason in league history”.
- Nov 26 Q5 — `nba-butler23-56-bucks-upset`: Butler's signature 2023 eighth-seed playoff upset supplies a famous, compelling game and a bounded superstar scoring challenge. Evidence https://en.wikipedia.org/wiki/2023_NBA_playoffs, excerpt “Jimmy Butler scored a career-high 56 points, which included 21 in the fourth quarter”.
- Nov 27 Q5 — `nba-kobe10-celtics-g7-combined`: Kobe's memorable Lakers-Celtics title decider provides a real two-team score-estimation challenge rather than an obscure quarter statistic. Evidence https://en.wikipedia.org/wiki/2010_NBA_Finals, excerpt “Boston Celtics 79, Los Angeles Lakers 83” (2010 Finals Game 7: Boston 79 + Los Angeles 83 = 162 combined points.).

Official generated future locks/day files, NBA reports and Survival tags must be refreshed by the one-time GitHub worker workflow, with full content, factory, trivia, typecheck, unit and build gates. Reviewer must still evaluate the 61 other Q5 slots; no player testing or external release approval has been claimed.

