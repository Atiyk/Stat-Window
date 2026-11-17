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
- [ ] Expansion: 3/50 additional days and 15/250 new questions **generated and NBA-validation-clean** for January 6–8, 2027. Full exact-head CI/critic/release gates remain pending.
- [ ] Three-variant coverage: 10/510 questions; 30/1530 variants. The other 505 questions remain editorial work.
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
Complete the remaining 480 three-variant sets and 47 new themed days in editorially verified batches, then independently validate the January 6–8 additions. Expand content and regression gates, repair any real product defects, verify mobile/desktop, then open one comprehensive PR only after review.
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
