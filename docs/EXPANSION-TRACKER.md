# Stat Window editorial expansion — November 16, 2026

## Owner-approved target
- 50 **additional** consecutive NBA calendar days, each with five independently source-verified unique questions. Existing calendar: 2026-11-17 to 2027-01-05 (50 days). Expansion target: **2027-01-06 to 2027-02-24** (50 more days).
- Three distinct, evidence-backed, spoiler-safe bonus-fact variants for every question, including the existing 50 NBA days and the historical November 15–16 mixed-sport beta days.
- Total after expansion: 102 slates, 510 unique questions, **1,530** source-checked trivia variants.
- Keep already-published question IDs, answers, scales, order, and challenge-link behavior unchanged.
- $0 incremental cost, source-rights checks and independent editorial audits, one comprehensive milestone PR rather than PR per scheduled iteration.

## Work actually staged on the milestone branch
- [x] Optional three-variant source-checked schema. Optional by design: never fabricate filler to meet a completeness target.
- [x] Stable per-browser variant choice; one fact shown after reveal, no network identity or scores changed.
- [x] The complete five-question Wilt day now has 15 curated, individually sourced variants; text checked against the cited Wikipedia article and screened for later-round spoilers.
- [x] Preserve an adjusted-but-unlocked first round through the UTC midnight rollover, with an automated browser regression test.
- [ ] Expansion: **21/50** additional NBA days (Jan6–Jan26) and **105/250** new NBA questions generated; **29** more NBA days (Jan27–Feb24) and **145** new questions remain.
- [ ] Three-variant coverage: **166/510** question sets and **498/1530** sourced variants authored; **161/483** published, 5/15 new 2016 Finals variants pending editor/validator. **344** sets / **1,032** variants remain.
- [ ] Review all editorial facts and copyright/attribution.
- [x] Source-checked the opening **two** five-question NBA days (Nov 17–18), with 30 distinct, cited variants and preserved scoring.
- [x] Fixed tablet reveal layout: the next action remains on-screen at 768px without hiding the bonus source below the fold. Added a 768px browser regression test.
- [x] Removed a fact giving away `nba-wilt62-total-points` from the reserved Survival pool.
- [ ] Other audited fixes, real receipt of analytics, physical mobile device QA and baseline-controlled experiments.
- [x] Add standalone fun-fact coverage/spoiler audit with optional final-release completeness gate.
- [x] Include the durable milestone branch in free GitHub CI push triggers; remove the special branch trigger before final merge.
- [ ] Run full test suite, independent critic, single integrated PR and release.

## Editorial QA policy
1. Every bonus variant has a source URL and short reviewed evidence quote. Three variants teach different things, not rephrasings.
2. Never leak answers to later rounds of the same day, future puzzles or future Survival questions. Inspect the full slate together.
3. New questions require source/rights approval, score bounds, fair difficulty, no calendar duplicates, balanced themes and a second reviewer. Don't scrape disallowed sources such as NBA.com or Basketball-Reference.
4. Canonical NBA questions are in `data/nba/facts.json`; `content/days` are generated with the existing publisher. Audit that the published scoring lock is unchanged.
5. Finish the editorial batches before enforcing a final-release gate requiring all 510 question records to have exactly three sourced variants. A build that lacks evidence must never be described as complete.
6. Keep 30+ days reviewed runway. Do not publish placeholder or unsourced 'extra days' or claim tests and device checks that were not run.
7. No paid platform/services. Analytics should be enabled only if its free-tier quota and policy have been checked; no commercial features on a noncommercial hosting tier.

## Next integrated work
Complete 344 remaining trivia sets and 29 further NBA days, retaining provenance and spoiler checks. Expand content and regression gates, repair any real product defects, verify mobile/desktop, then open one comprehensive PR only after review.
## Runbook for next source-verification batch
- Run `npm run content:trivia:check` after every batch to detect numerical spoilers and report true coverage; `npm run content:trivia:complete` is an intentional FINAL gate and will fail while variants are missing.
- Source review must include opening the cited article and confirming each evidence excerpt, not just a syntactically valid URL.
- GitHub CI on this durable milestone branch is used for substantive checkpoints without creating premature PRs. Once the milestone is ready, remove the branch-specific CI push trigger and open exactly one comprehensive PR.

## Latest QA checkpoint
- The first comprehensive branch CI run failed a legitimate tablet viewport test, traced to the extra trivia length. The layout has been adjusted and needs a new full CI pass.
- NBA facts and the future days are not fully authored. The correct target is 510 total questions with 1,530 sourced fun-fact variants; do not imply completeness from an optional schema.

## Working-branch generator (remove before final PR)
`.github/workflows/editorial-sync.yml` is a temporary branch-scoped, free GitHub Actions workflow for authoring 50 verified new days. When the source facts/calendar change, standard ubuntu-latest runs the existing publisher, report and Survival catalog generators and commits their deterministic artifacts back to the same feature branch. No production deployment/merge is permitted until all release gates pass. Generated changes must be examined, not assumed correct. Remove the temporary workflow and branch-specific CI push trigger before the final comprehensive PR.

## Verified generator result — 2026-11-16
- The branch-only standard `ubuntu-latest` regeneration job passed on source SHA `d2c26e6` and committed deterministic artifacts as `79bdb362`.
- `content/days/2027-01-06.json` contains five new questions in easy/medium/hard/hard/expert order, each with three sourced trivia variants; the published lock contains that date's five fingerprints.
- `docs/nba/validation.md` reports **0 NBA validation errors**, 281 canonical facts, 255 scheduled NBA questions and 51 NBA days. SQLite and Survival catalog generated successfully.
- A separate connector-authored checkpoint commit triggers full CI on the generated exact SHA; do not describe it as passed until it does.

## January 7 Denver source batch
Source-authored `2027-01-07` Denver Nuggets, 2022–23: five new unique questions (53 regular season wins, 30.2 Jokić Finals PPG, 10.0 Murray Finals APG, Aaron Gordon's 27 Game 4 points, Braun's 21st draft slot). All 15 additional trivia variants carry specific Wikipedia evidence quotes. Range fairness, unique IDs, numerical later-round spoilers, quote lengths and source licensing checked before submitting. Automated NBA calendar and generated-file checks will be the authority; do not mark passed until their exact runs complete.

## Verified generation — January 7 Denver
- Generator run `43992495433` succeeded and pushed `af15e056` to the feature branch. New `content/days/2027-01-07.json` contains five unique questions and 15 cited bonus variants.
- Source validator reports 0 NBA content errors for 52 days / 260 scheduled NBA questions, and the generator refreshed locks, CSV/report and Survival catalog.
- A fresh connector-authored checkpoint triggers full CI on the regenerated content; don't mark full CI green based only on the source validator.

## January 8 Philadelphia source batch
Authored `2027-01-08` covering the 2000–01 76ers: 56 wins, Allen Iverson's MVP-season 31.1 PPG, the opening 10-game streak, Mutombo's 12.4 post-trade RPG, and the 107-point overtime Game 1 Finals win. 15 distinct short sourced trivia variants. Facts screened against the existing question DB, quote and slider fairness gates, spoiler risk and source licensing before submitting to the generator; generated NBA validation is still the authority.

## January 8 generator + cutover regression fix
- The free branch generator produced `content/days/2027-01-08.json` from the canonical Philly source facts and regenerated the source audit, historical locks and Survival catalogue. The generated NBA validator reports **0 errors** for 53 NBA days and 265 scheduled NBA questions.
- Earlier full CI found two desktop/mobile failures because `e2e/cutover.spec.ts` hardcoded `toHaveLength(50)`. Fixed the regression to assert **at least 50 consecutive NBA dates** while preserving the original mixed-to-NBA cutover contract. This test must pass on the next full CI candidate before release.

## Existing-calendar bonus-fact coverage: 2026-11-19
Added 15 individually sourced and distinct trivia variants for the five already-scheduled 1993–95 Rockets questions: the opening streak, Ewing's series blocks, Starks' Game 7, Anderson's missed free throws and Houston's road playoff wins. Trivia sources are the corresponding Houston Rockets and 1994/1995 Finals Wikipedia pages. The five historical scoring fingerprints are intentionally unchanged. Await full generator check before counting this NBA slate as successfully regenerated.

## Hakeem’s Rockets generation verified
- Free editorial-sync run `43993187933` succeeded and wrote the five NBA question records for `2026-11-19` with all 15 bonus variants.
- Manually compared every `id`, `answer`, `min`, `max`, and `step` in this slate to production source `a58ab86`: identical. Published scoring/links remain intact.
- The generated NBA validator reports 0 errors; a dedicated full-branch CI commit follows and must finish green before any release claim.

## January 9 historical Warriors source batch
Authored five new distinct questions from the 1974–75 Warriors and 1975 Finals Wikipedia pages: 48 wins, Rick Barry's 36 in Game 2, the Bullets' 14-point halftime lead in Game 1, Golden State's 115 reserve points through Game 3, and the 96 points in the clincher. Three evidenced trivia variants per question (15 total). Tested the new answer ranges against the midpoint exploit and checked numerical later-round spoilers before committing. Source-authored, NOT yet complete until the automated validator/publisher passes.

## Golden State 1975 editorial correction
The first January 9 generation correctly rejected a duplicate of existing reserve `nba-warriors75-bench` and a standing-record wording issue. Replaced the fourth daily question with a verified 20-rebound Wes Unseld Game 2 number (different family/player/franchise) and tightened the 48-wins reveal wording. Do not mark this slate validated until generator, source gates, and full CI pass.

## January 9 generation verified
Generator run `43994131981` succeeded. The published daily-file generator replaced the duplicate bench-total question with a separate Wes Unseld Game 2 rebound figure and removed a date-based clue that had contained the answer. The NBA report confirms **zero errors**, 54 consecutive NBA days, 270 scheduled NBA questions and 296 canonical source-backed facts (26 in reserve). January 9 has five questions in difficulty-ladder order and exactly three variants each. A connector checkpoint was committed to run full CI on the generated exact candidate.

## Original NBA day 4 — 2026-11-20 Showtime
Fifteen additional sourced bonus-fact variants (three per question) have been authored from the Wikipedia 1980, 1984, 1987 and 1989 Finals pages. They cover the Lakers' 1987 wins, Magic's 1980 game, Lakers' 1989 opening playoff run, Michael Cooper's long-range shooting, and Magic's 1984 Finals assists. All original question IDs, numerical answers, scales, order and scoring remain unchanged. Await source regeneration and exact full CI before declaring verified.

## January 10 Spurs source batch
New 1998–99 Spurs slate `2027-01-10` authored from the Wikipedia San Antonio season and 1999 Finals pages, covering Duncan's 27.4 Finals points average, 31 wins in the final 36 games, Robinson's 11.8 Finals rebounds, Avery Johnson's 7.2 Finals assists, and 527,357 Alamodome attendees. All five new IDs checked against existing questions and reserves; difficulty/range/midpoint heuristic and 15 per-question independent sourcing excerpts screened. The canonical verified quote for attendance includes a thousands separator, permitted by the validator. Editor/validator and generated artifact checks remain necessary.

## January 10 generated Spurs slate
Free editorial-sync run `43995181969` succeeded, pushed bot commit `39cd98c7` and regenerated `content/days/2027-01-10.json`, historical scoring lock, proof reports and the Survival catalog. NBA validation is **0 errors** with 55 consecutive NBA days and 275 scheduled NBA questions (301 sourced canonical facts incl 26 reserves). All five original answers and source citations/three variants are present; scoring fingerprint does not affect existing November published results. Full exact-head CI and independent critic remain outstanding; no production release yet.

## January 11 Chicago source batch
Staged five new source-backed 2010–11 Bulls questions from the season's Wikipedia record: 62 regular wins, Rose's 25.0 PPG, 36 home wins, Joakim Noah's 10.4 RPG, and Rose's 44-point Atlanta playoff game. Each question includes three distinct sourced trivia variants. IDs compared against canonical fact library; input quotes, units, bounds, centre-guess scoring and within-day spoiler audit checked. Source-only until generator and full CI confirm.

## January 11 verified content-generation checkpoint
Standard free GitHub Actions editorial-sync run `43995580013` succeeded and generated the Bulls slate as bot commit `0751c2d07ec1bae912c024ca3083f9718847d6f2`. `content/days/2027-01-11.json` has five distinct source-backed questions and 15 trivia variants. The NBA validation report says **0 errors**, 56 consecutive NBA dates, 280 scheduled NBA questions, 306 canonical facts (26 reserve). Creating this connector checkpoint triggers CI on the exact generated candidate; no PR/merge/deployment before that CI finishes.

## Original Bulls 1995–96 trivia source batch
Three distinct Wikipedia-supported variants are authored for each of the five November 23 original questions. Context covers the black alternate uniforms, reunion of former Pistons players, Rodman's early rebounding titles, Chicago's home and road dominance, and the 1996 championship series. All original question IDs, answers, ranges and chronology are untouched. Within-slate later-round number spoiler check passed; the publisher and full integration CI must still validate the new text.

## November 23 generated trivia + runner efficiency
Free editorial generator run `43995938307` passed and updated the historical Nov23 Bulls slate with 15 sourced bonus variants; all five published IDs/answers/ranges remain unchanged. The NBA report still says 0 errors. Added CI workflow concurrency keyed by PR/ref so a new source commit cancels old browser runs that would otherwise consume public free runners. The full check suite itself remains unchanged; only its scheduling is optimized. Remove the temporary milestone-branch CI trigger and editorial generator workflow before the final PR/release.

## January 12 Phoenix Seven Seconds or Less
Source-authored one NBA slate from `2004–05 Phoenix Suns season` Wikipedia: 33-win year-over-year improvement, Nash's 11.5 regular-season assists, 31 Phoenix road wins, Amar'e's 29.9 playoff scoring, and Nash's 39 in overtime against Dallas. Five original questions, each with three source-excerpt-backed variants (15). Source URL checked live, familiar franchises/eras and stat families spread across ladder; verified input bounds, midpoint exploit, source quotes, no numerical spoilers in future rounds. **Not counted generated until editorial-sync succeeds.**

## January 13–14 source-authored editorial batch (await publisher and full CI)
- Jan 13 Toronto 2018–19: 58 regular wins, Leonard's 30.5 playoff PPG, Lowry's 8.7 regular APG, 92 points in Philadelphia Game 7, 26 road wins. Fifteen contextual fun-fact variants with excerpt evidence from [Wikipedia's Raptors season](https://en.wikipedia.org/wiki/2018%E2%80%9319_Toronto_Raptors_season). Existing Siakam Finals question intentionally not duplicated.
- Jan 14 Atlanta 2014–15: 60 wins, perfect 17-win January, Korver's .492 three-point accuracy (0.492 × 100), Teague's 7.0 APG, 22-win improvement. Fifteen contextual fun facts with cited excerpt evidence from [Wikipedia's Hawks season](https://en.wikipedia.org/wiki/2014%E2%80%9315_Atlanta_Hawks_season).
- 2 canonical slates, 10 new IDs, 30 evidence-linked bonus variants source-authored with per-item source URL/quote; verified basic bounds, new IDs and scoring-midpoint behavior in the authoring preflight. This is not independent editorial sign-off or generated-file/full CI confirmation. Production remains unchanged.

## January 13–14 generated artifacts — CI checkpoint
- Free editorial-sync run [44001462249](https://github.com/Atiyk/Stat-Window/actions/runs/44001462249) succeeded and created bot commit `11918f65d5596a471048d4d9d75d8a8c2f7b8e1f`.
- The generated 2027-01-13 and 2027-01-14 daily files each contain 5 source-backed questions and exactly 15 trivia variants, in easy/medium/hard/hard/expert order. `docs/nba/validation.md` reports **0 NBA validation errors**, 59 NBA days, 295 scheduled NBA questions, 26 reserves (321 canonical facts). Historical mixed days remain separate.
- The original CI run 44001462244 failed before the publisher bot commit due to stale generated source artifacts. This small tracker checkpoint exists solely to trigger exact-generated-head CI. Do not call the milestone green until that new run passes.

## Jan 15–17 substantive source-check batch — awaiting generated checks
- Jan 15 Orlando 2008–09: 59 regular-season wins, a 23-three night in Sacramento, Howard's 13.8 rebounds per game, Türkoğlu's 4.9 assists, and Howard's 40-point Cleveland clincher. Individual evidence quotes and 15 contextual variants from [Wikipedia Orlando 2008–09](https://en.wikipedia.org/wiki/2008%E2%80%9309_Orlando_Magic_season).
- Jan 16 Milwaukee 2020–21: 46 wins, Giannis's 30.2 playoff PPG, Jrue's 8.7 playoff APG, 86 points versus Brooklyn, and Forbes's 45.2% regular-season three-point shooting (source .452 converted with a documented calculation). 15 individual contextual facts from [Bucks season](https://en.wikipedia.org/wiki/2020%E2%80%9321_Milwaukee_Bucks_season) and [2021 Finals](https://en.wikipedia.org/wiki/2021_NBA_Finals). Previously scheduled/reserved Giannis game-six numbers not reused.
- Jan 17 Seattle 1978–79: 52 regular wins, ten January wins, Sikma's 33 versus Phoenix in Game 7, Gus Williams's 36 in Finals Game 4, and Sikma's 17 rebounds in the title clincher. 15 trivia excerpts sourced to [SuperSonics season](https://en.wikipedia.org/wiki/1978%E2%80%9379_Seattle_SuperSonics_season); pre-existing Gus Williams Finals-average question untouched.
- Preflight performed on 15 new question IDs and 45 facts: approved hosts, source evidence length, stat family registration, exact duplicate signatures, reasonable range/step, midpoint score, and later-question numeric spoilers. Corrected invalid stat-family and oversize slider **before committing**. This is a source-authored batch, not an assertion of full QA or independent editorial sign-off. Production unchanged.

## Nov 25 existing Warriors trivia — original scoring untouched
- Three distinct evidenced post-reveal variants each for opening-streak, All-Star-break wins, home streak, team threes and Curry overtime points: **5 legacy questions, 15 sourced variants**. Individual excerpts reviewed against the [2015–16 Golden State Warriors season article](https://en.wikipedia.org/wiki/2015%E2%80%9316_Golden_State_Warriors_season); trivia avoids all later daily question numerical answers.
- All five existing `id`, `answer`, `min`, `max`, `step`, and ordering left unchanged in canonical source; published lock should remain fixed. Generator and exact-head CI pending. Do not count complete until tests pass.
- Jan 15–17 publisher generated day files and refreshed report at `ef4f42cbe5b8aff2cd813f26c2ca8c3d4f9e9514` (NBA validation zero errors, 62 NBA days, 310 scheduled questions, 26 reserves). Full CI on regenerated head still required.

## Nov 26 historic Rip City fun-fact batch — source stage
- Five untouched original daily questions (Walton Game 6 boards, 1978 season start, Blazers Game 4 third-quarter points and victory margin, Walton Game 5 defensive boards) now each have three contextual sourced variants. **15 added**.
- Individually checked supporting excerpts against the [1977 NBA Finals](https://en.wikipedia.org/wiki/1977_NBA_Finals) and [1976–77 Portland season](https://en.wikipedia.org/wiki/1976%E2%80%9377_Portland_Trail_Blazers_season). No following-round numerical answers are in the bonus texts. Original IDs, answers, scales and order were not modified. Generator, spoiler audit and CI must still validate.

## Current generated checkpoint — exact-head full CI gate
- Free branch-only editorial generator runs [44004253744](https://github.com/Atiyk/Stat-Window/actions/runs/44004253744), [44004437743](https://github.com/Atiyk/Stat-Window/actions/runs/44004437743) and [44004571329](https://github.com/Atiyk/Stat-Window/actions/runs/44004571329) succeeded. Latest bot head: `c0123f7e8b53826c9b517b2b60996610e623f7fb`.
- Inspected four generated daily files: Jan15 Orlando, Jan16 Milwaukee, Jan17 Seattle, Nov26 Portland each contain exactly five questions with exactly three trivia variants per question; Warriors Nov25 also generated earlier. NBA report: **0 content errors**, **62 NBA dates**, **310 scheduled NBA questions**, 26 reserves.
- Compared `content/published.lock.json` on production main with generated head: **all 52 pre-existing date fingerprints are unchanged**. Additional 12 dates (Jan 6–17) appended. Historic question IDs, answers, ranges and ordering retained.
- This tracker-only checkpoint is intentionally used to trigger full branch CI on the exact generated artifacts. Do not claim CI success or independent critic sign-off until those gates genuinely pass. No PR/merge/production action.

## Six-day NBA source batch, Jan 18–23 (pending generator/CI)
- Grouped verified season sources into an **interleaved calendar**: Jan18 Pacers 1998, Jan19 Kings 2002, Jan20 Heat 2020, Jan21 Spurs 2014, Jan22 New Orleans Hornets 2008, Jan23 Suns 1984. Six distinct themed 5-question days, 30 new question IDs and 90 non-placeholder evidence-linked context variants. Team ordering intentionally varies eras to honor rolling diversity gates; date order is deterministic for save and challenge compatibility.
- Individual source pages opened and numerical values, units, primary excerpts, regular and postseason results checked: [Indiana](https://en.wikipedia.org/wiki/1997%E2%80%9398_Indiana_Pacers_season), [Sacramento](https://en.wikipedia.org/wiki/2001%E2%80%9302_Sacramento_Kings_season), [Miami](https://en.wikipedia.org/wiki/2019%E2%80%9320_Miami_Heat_season), [San Antonio](https://en.wikipedia.org/wiki/2013%E2%80%9314_San_Antonio_Spurs_season), [New Orleans](https://en.wikipedia.org/wiki/2007%E2%80%9308_New_Orleans_Hornets_season), [Phoenix](https://en.wikipedia.org/wiki/1983%E2%80%9384_Phoenix_Suns_season). One original stat family was found duplicated (Spurs 19-game streak), so changed question to sourced 16-win March; Pacers road slider was retuned to avoid midpoint scoring exploit.
- Added historical franchise `NOP` (modern New Orleans Pelicans) with earlier New Orleans Hornets names rather than incorrectly classifying the 2007–08 New Orleans franchise as modern Charlotte Hornets. Original production scoring fingerprints untouched.
- Authoring preflight checked length, unique signatures, recorded source URLs and excerpts, min/max/step, midpoint exploit, and numerical later-round spoilers. **Do not count this batch as generated or QA-approved until editorial-sync and exact-head full CI pass**; no PR/merge/deployment.

## Six-day Jan 18–23 regeneration verified — 2026-11-16 CI checkpoint
- Free branch-only [editorial sync run 44006287692](https://github.com/Atiyk/Stat-Window/actions/runs/44006287692) succeeded and pushed generated artifact commit `c61429fdc948785fbcc2052052a1bb657260cc62`. Six new generated dates Jan18–Jan23, 30 questions and 90 snippets, all source-backed and in published difficulty order.
- Canonical `docs/nba/validation.md` reports **0 NBA errors**, 68 consecutive NBA days, 340 scheduled NBA questions, 26 Survival reserves, 366 source facts, and now 28 registered NBA franchises after the New Orleans Pelicans lineage addition. Existing mixed days add ten more scheduled questions.
- Compared main vs candidate `content/published.lock.json`: **all 52 original dates unchanged**; 18 new daily dates added Jan6–23. No change to originally published IDs, answers, scales or order.
- The source-push CI run fails expectedly on stale generated artifacts, before the publisher's bot commit. This checkpoint triggers complete CI on the exact generated head; its run must pass typecheck, unit tests, desktop/emulated mobile Playwright, analytics wiring and Survival gated E2E before being called green. Independent critic remains outstanding; no PR/merge/production release.

## Exact generated-head checkpoint — November 16, 2026, 22:00 ET
- Re-read remote branch: generated artifact commit `82934c5523413201a9046f39cdbd8811f2fafb6a` from source commit `141075195cc719bebf01cb4af0301fb3e8424e43`; editorial-sync run `44006544929` completed successfully. Its parallel source-head CI run `44006544955` failed at content check before generated artifacts, so it is **not** the release CI verdict.
- Inspected canonical `facts.json` and `calendar.json`: 366 NBA facts, 68 consecutive NBA dates (November 17–January 23), 126 canonical NBA fact records with three bonus variants (378 variants), and 32 expansion dates (January 24–February 24) not yet authored. The separate ten mixed-sport questions are not counted in the 126.
- Prior checkpoint CI run `44006377755` was cancelled by concurrency, not passed. This docs-only commit intentionally triggers a new full CI on the generated exact head; verify its eventual conclusion and job steps before claiming a green build.
- Editorial correction for the December 15 Jordan/Boston 1986 playoff round is now included in generated artifacts; do not modify existing answer/scoring locks. No PR or production deployment authorized by this checkpoint.

## January 24 LeBron first MVP — independently opened source page
Source-authored five new Cleveland 2008–09 themed questions from https://en.wikipedia.org/wiki/2008%E2%80%9309_Cleveland_Cavaliers_season (web page reviewed 2026-11-16): 66 regular wins; 39 home wins; 7.2 LeBron APG; 17.8 Mo Williams PPG; LeBron's 49 in the Orlando Game 1 loss. Fifteen individually excerpt-supported, source-licensed trivia variants, with season-vs-playoff distinction and independently checked bounds, answers, spoilers and midpoint fairness. No existing 2008–09 CLE canonical fact duplicates. Waiting for the free generator and full exact-head CI before declaring playable.

## Fixed Cavs theme + November 24 Wade/Nowitzki source batch
- Generator correctly blocked the Jan24 Cavaliers title `LeBron's 66-win Cavs` because it leaked first-round answer. Renamed to `LeBron's MVP leap`, no question scoring changes.
- Added exactly three separately sourced spoiler-screened bonus variants to each historical Nov24 daily question (Wade Game3, Wade Finals PPG, Dallas Game4 quarter, Dirk's 2011 free throws, 2011 Dallas Finals Game2 comeback). Sources: verified Wikipedia 2006 NBA Finals, 2011 NBA Finals and 2010–11 Mavericks season. Total added: 5 complete question sets, 15 variants. No existing published question IDs, answers, scales or order changed; generated validation/CI still pending.

## January 25 historical Seattle SuperSonics source batch
Independently opened and inspected https://en.wikipedia.org/wiki/1993%E2%80%9394_Seattle_SuperSonics_season. Five themed questions: 63 regular-season wins, 10-game opening streak, Kemp's 10.8 rebounds per game, Payton's 6.0 assists per game, and Seattle's 94-point Game 5 overtime loss to Denver. Fifteen diverse individually sourced bonus variants. Avoids original 1993–94 Seattle canonical duplicates, recycled stat families, the midpoint-guess scoring exploit and spoiler-bearing titles/prompts; editor/source generator and full CI remain pending. Theme deliberately omits the score and numeric answer.

## January 25 Seattle generated; November 27 Kobe source repair
- Jan25 generated bot commit `23cbbd5f` has five original new Seattle questions, each with 3 cited distinct variants; source and NBA validation previously passed on generation. Theme does not leak numeric answers.
- Original Nov27 Kobe day now source-authored with 15 spoiler-safe trivia facts across five rounds. For two 2002–03 Bryant statistics (12 made threes and nine consecutive 40+ games), replaced an outdated source page link and quote with current, explicitly supporting text on Wikipedia's Kobe Bryant biography. All existing question IDs, numeric answers and ruler bounds retained; await free editorial-sync and exact full CI.

## Nov27 Kobe generation verified
Free editorial generator run `44009601630` completed successfully and generated `content/days/2026-11-27.json` with three separate sourced variants for each of its five questions. Corrected stale 2003-era Kobe citations now point to the current biography page. Jan25 Seattle also has five validated 3-variant questions; total 70 NBA days (to Jan25) with NBA validation 0 errors. Next checkpoint triggers the exact-head full desktop/mobile/analytics/Survival CI, which must pass before any release claim.

## Kobe Survival reserve spoiler fixed and regenerated
CI `44009734129` correctly rejected a 2010 Finals bonus fact with numerical `23`, matching the answer to an unplayed Kobe reserve. The fact was reworded to reference the Lakers' offensive rebounding without the reserve answer. Standard free generator run `44009838431` succeeded, the updated `content/days/2026-11-27.json` has three sourced variants for each question, and NBA database report still shows 0 errors for 70 days / 350 NBA scheduled questions. This connector checkpoint triggers exact full CI, including the strict bonus fact/reserve audit. Do not merge/publish before it is verified.

## January 26 Phoenix 1992–93 — editorial source batch
Created five new questions for Barkley's Suns (62 regular-season wins; 14-game December streak; Barkley's 12.1 RPG; Dan Majerle's 167 made threes; the Suns' 98 in the 1993 Finals Game 6). Wrote 15 independent contextual facts with explicit supporting excerpts from the Wikipedia 1992–93 Suns season and 1993 Finals articles. Verified neither canonical IDs nor answers duplicate existing Phoenix facts, checked ranges against midpoint scoring and in-slate numerical spoilers, and preserved previous daily scoring data. Source authored only until free generator produces the January 26 daily file and exact GitHub CI passes.

## Phoenix and original November 28 Rock Bottom
Jan26 (Barkley's 1993 Suns) successfully generated on free standard runner and contains five new questions each with 3 sourced trivia variants. Existing Nov28 game has newly authored 15 variants about the 1972–73 Sixers, 2011–12 Bobcats and 2013–14 Sixers. Research source pages were opened and key claims checked against visible editorial quotes; preserves existing IDs, answers, ranges and source rights. All trivia screened for later-round numeric spoilers and individual source quote lengths. Await publisher regeneration and latest full CI.

## January 26 Phoenix + November 28 Rock Bottom: verified generation
- Free editorial-sync job `44010592624` succeeded. The generated Jan26 Suns file has five distinct original questions with three sourced variants each. The historical Nov28 Rock Bottom game now has five existing questions with three sourced variants each; all published IDs, answers, scales and order remain unchanged.
- The canonical NBA validator reports **zero source/scoring integrity errors**, 71 consecutive NBA days and 355 scheduled NBA questions, plus 26 unpublished reserve facts. This docs-only connector checkpoint starts exact-head CI on the bot-generated files. Do not describe strict trivia/Survival check or all browser/device tests as passed until GitHub reports green.

## November 29 Stockton–Malone authored trivia
Fifteen independently sourced variants (3 for each of 5 existing questions): Stockton's nine assist titles and career assist total, Stockton/Malone pick-and-roll and Finals history, his durability and MCL injury, Utah's 1991 Spurs game, and Malone's last championship attempt with the Lakers. Verified text against Wikipedia's John Stockton biography and 2004 NBA Finals article; preserved original scoring fingerprints, checked later-round numerical spoilers and short excerpt attribution. Await branch-only publisher and strict trivia/Survival CI.

## November 29 Stockton–Malone generation verified
Free editorial-sync run `44010852873` succeeded and pushed bot commit `78b03a12`. The playable Nov29 day now contains three distinct source-supported trivia facts for each of the five existing questions with unchanged scoring fingerprints. NBA generator reports zero issues for 71 consecutive NBA days/355 NBA questions; current full strict bonus-fact/reserve spoiler audit remains an exact-head release gate, along with desktop/mobile browser and analytics/Survival checks. This connector-authored tracker checkpoint triggers that full CI on generated files.

## Existing Nov30 2016 Finals: source-authored
Created three new sourced contextual trivia variants on each of the five original Cleveland–Warriors 2016 Finals questions. Extra context includes Draymond's Game 5 suspension, LeBron's all-statistical-category Finals leadership, Green's Game 7 shooting and rebounding, Luke Walton's interim coaching start, and the final game's closing possessions. Evidence excerpts checked against the Wikipedia 2016 NBA Finals article. Original questions' scores/IDs/bounds unchanged. Await editorial regeneration, strict reserve-answer audit and exact full CI.
