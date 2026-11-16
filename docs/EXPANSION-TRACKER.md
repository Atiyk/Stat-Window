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
- [x] First example: Wilt Chamberlain 100-point game, three different details all supported by Wikipedia and avoiding spoilers for later rounds.
- [x] Preserve an adjusted-but-unlocked first round through the UTC midnight rollover, with an automated browser regression test.
- [ ] Expansion: 0/50 additional days; 0/250 new source-verified questions.
- [ ] Three-variant coverage: 1/510 questions; 3/1530 variants.
- [ ] Review all editorial facts and copyright/attribution.
- [ ] Other audited fixes, real receipt of analytics, mobile device QA and baseline-controlled experiments.
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
Complete the remaining 509 three-variant sets and 50 new themed days in editorially verified batches. Expand content and regression gates, repair any real product defects, verify mobile/desktop, then open one comprehensive PR only after review.