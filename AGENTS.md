# Instructions for coding agents working on Stat Window

## When asked to add questions, daily games, sports, or Survival content

**Always start with [docs/QUESTION-FACTORY.md](docs/QUESTION-FACTORY.md).** The sport-independent Question Factory is the canonical research, candidate-generation, editorial-review and slate-proposal workflow. Use `npm run factory -- init|generate|check|plan`; do not bypass its source, editorial or duplicate gates just because the model can generate plausible trivia.

Check the existing calendar, released historical questions, source-rights policies, content validator, ongoing PRs and Survival spoiler constraints first. Research multiple subjects efficiently; favor recognizable events, meaningful comparisons, surprising facts, estimable numbers, and good explanations. Prioritize enjoyment, not merely arbitrary difficulty. A candidate is never verified or published just because GPT wrote it.

The existing NBA pipeline (`data/nba/`, `scripts/nba/`) and `content/published.lock.json` remain authoritative for already scheduled NBA days. The generic factory only writes to `data/question-factory/`; its output is **staged**, not production-ready. For non-NBA sports build a reviewed publication adapter; do not weaken existing NBA calendar gates. Never rewrite previously released numerical answers, scales, IDs, or question order. Keep source licensing compliance, $0 incremental spend, small focused changes and complete tests.

Before opening a PR, run the factory checks, existing content checks, TypeScript, unit tests, relevant browser tests and independent critic review. Submit comprehensive, reviewable batches rather than daily micro-PRs. State precisely what was generated, verified, staged, merged and deployed; never invent QA evidence.
