# Stat Window original-trivia release review packet

## Candidate and scope

- Repository: `Atiyk/Stat-Window` public; integration branch `statwindow/editorial-season-two-20261116`.
- Initial exact generated-head automated QA checkpoint: `f4cd8de63bd02028e8ff2b5cbe4e475640799d46` — GitHub [CI run #44033685822](https://github.com/Atiyk/Stat-Window/actions/runs/44033685822) **completed successfully** on November 17, 2026 (not the final cleanup commit).
- Original release scope: two historic mixed-sport launch days 2026-11-15/16 (10 questions), 50 existing NBA days Nov17–Jan5 (250), plus 22 staged NBA days Jan6–Jan27 (110). **370 scheduled questions**, **1,110 attributed three-variant trivia snippets** in total. No additional NBA dates authorized for this release.
- All 52 original published scoring fingerprints compared structurally with main: **0 changes**. 22 expansion dates and the original order, answers, bounds, saved scores and challenge-link contracts preserved.

## Completed automated verification at the pre-cleanup candidate

- **Strict original gate:** `npm run content:trivia:check -- --require-original`: **260/260 original sets**, **780/780 original snippets**, no detected source-schema or later-round/Survival spoilers after two real findings were fixed.
- **Full scheduled inventory:** 370/370 scheduled question sets complete; no exact normalized trivia-text duplicates; Wikipedia approved host on every snippet; quote length 10–160 and text 20–220; NBA schema/content reports 0 errors, SQLite generation reproducible, 26 reserve facts preserved.
- **GitHub CI #44033685822 actual steps green:** content lock checks, mandatory original trivia/spoiler audit, NBA SQLite/report, Question Factory, TypeScript, Vitest, build, Playwright desktop/mobile E2E, stubbed analytics, Survival flag-off/preview/on tests.
- **Browser projects:** Desktop Chrome 1440px and Pixel 7 emulation; Playwright `e2e/layout.spec.ts` covers 320, 375, 390, 768, 1024, 1440 widths on representative original and NBA days; challenge links, refresh/local saves, UTC rollover and keyboard/touch simulation have tests. **No physical mobile device or real user session was exercised**.
- **Source-provenance caveat:** All snippets carry short cited excerpts from rights-permitted Wikipedia articles; proof edits corrected several overbroad paraphrases. A structural test and editorial spot-check are **not** a new independent individual re-verification of all 1,110 snippets. Do not claim otherwise.

## Pending independent critic veto gates

- [ ] Independent editorial reviewer checks a fresh sample spanning teams, player, era and historic mixed-sport sources; source excerpt actually appears on linked article and supports exact claim and scope, variants not redundant, no spoiler to another round/day or reserves.
- [ ] Independent coding reviewer checks diff against current main, new Question Factory integration, published lock diff, mobile layout, stale data safety, UTC rollovers, saved data and share links. No source-generated output edited manually.
- [ ] Both reviewers approve or findings are fixed and independently rechecked. Prior unrelated project review is not this candidate's signoff.
- [ ] After this temporary-workflow cleanup, open **one comprehensive PR**, verify current main ancestry and PR check run on final PR merge commit (the exact pre-cleanup green run does **not** validate this later commit).
- [ ] Merge only when the exact final candidate checks pass and approvals actually exist, then coordinate **one** free-tier production deployment and live browser QA. Production analytics still not enabled; do not infer traction or live data.

## Budget and workflow controls

- $0 incremental spend, existing GitHub Actions `ubuntu-latest` only, no paid Vercel builds/APIs/Copilot/code review.
- The temporary branch publisher `.github/workflows/editorial-sync.yml` and feature-only push CI trigger are removed in the cleanup commit. Normal CI on `main` and on PRs, including strict original-completeness auditing, stays intact.
- Independent PR #8 (analytics data-quality) is outside this milestone and must not be overwritten.
