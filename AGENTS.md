# Instructions for coding agents working on Stat Window

## When asked to audit, coordinate, test, fix or release the app

Follow [docs/RELEASE-ORCHESTRATION.md](docs/RELEASE-ORCHESTRATION.md). One manager owns the integration candidate; checks are bounded and evidence-backed. Independent critic sign-off is a release gate. Do not claim CI or browser testing passed if it did not, and do not represent manager self-review as an independent agent. Prefer one comprehensive PR and one coordinated production deploy.

## When asked to add questions, daily games, sports, or Survival content

**Always start with [docs/QUESTION-FACTORY.md](docs/QUESTION-FACTORY.md).** The sport-independent Question Factory is the canonical research, candidate-generation, editorial-review and slate-proposal workflow. Use `npm run factory -- init|generate|check|plan`; do not bypass its source, editorial or duplicate gates just because the model can generate plausible trivia.

Every official NBA slate (from `VARIETY_FROM`) uses the three player formats, **recall, reference and missing-point, in a 2/2/1 mix**: two of one, two of another, one of the third, never a retired format (`difference`, `ratio`, `ranking`, `trajectory`), never the same format sequence as the day before or after, and the single format rotates. `validateNba` enforces it and the build fails without it. A reference must genuinely help the estimate (comparable, never within about 5% of the answer); a chart must tell one basketball story. The rule, its enforcement and the quality bar are in QUESTION-FACTORY.md under "Question formats and the 2/2/1 rule".

Sources: research on Wikipedia. Basketball-Reference is approved only for single facts a person reads by hand; agents never fetch it. The validator accepts its URLs for such hand-read facts (docs/NBA_DATA_RIGHTS.md).

Check the existing calendar, released historical questions, source-rights policies, content validator, ongoing PRs and Survival spoiler constraints first. Research multiple subjects efficiently; favor recognizable events, meaningful comparisons, surprising facts, estimable numbers, and good explanations. Prioritize enjoyment, not merely arbitrary difficulty. A candidate is never verified or published just because GPT wrote it.

The existing NBA pipeline (`data/nba/`, `scripts/nba/`) and `content/published.lock.json` remain authoritative for already scheduled NBA days. The generic factory only writes to `data/question-factory/`; its output is **staged**, not production-ready. For non-NBA sports build a reviewed publication adapter; do not weaken existing NBA calendar gates. Never rewrite previously released numerical answers, scales, IDs, or question order. Keep source licensing compliance, $0 incremental spend, small focused changes and complete tests.

Before opening a PR, run the factory checks, existing content checks, TypeScript, unit tests, relevant browser tests and independent critic review. Submit comprehensive, reviewable batches rather than daily micro-PRs. State precisely what was generated, verified, staged, merged and deployed; never invent QA evidence.
