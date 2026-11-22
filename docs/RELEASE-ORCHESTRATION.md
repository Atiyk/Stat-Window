# Stat Window: release orchestration and independent QA gates

## Outcome, not agent theatre
Use a **manager/orchestrator** that owns the exact release candidate, dependencies, integration and final decision. Delegate only bounded, independent workstreams; return factual evidence (commit, failing reproduction, test output, PR review) rather than generic "LGTM". The reviewer must inspect the final integrated candidate, not trust earlier branch CI. These roles describe a repeatable workflow; do not claim an actual independent agent ran unless it did.

## Workstreams (spawn only if needed)
| Role | Independent responsibility | Required evidence |
| --- | --- | --- |
| Bug fixer | Reproduce every failure, classify product bug vs stale test vs flaky infrastructure, fix at root, add regression test | Before/after steps, changed files and exact test |
| Gameplay QA | Score legality, 24-second expiry, input paths, keyboard, refresh/hidden-tab, first-play, real DST rollover, past-day links | Unit + Playwright; explicitly check 320/390/720/1440 px |
| Server/privacy/security | Server-owned date, first-score-wins, rate limits, Upstash free budget, consent and deletion; never trust client time | API and Redis tests, threat-model review, checked preview |
| Editorial reviewer | Source-verified facts, Q1-Q5 curiosity arc, lock preservation, not-before spoilers, social meaning of score | Content gate, separate checked research for any proposed replacements |
| Accessibility/UI | WebKit and Chromium; screen-reader focus, reduced motion, target sizes, 200% text, high contrast | Browser tests; manual device verification noted separately |
| Independent critic | Veto release on unresolved P0/P1, missing tests, misleading copy or mismatched branch/deployment | Review of final SHA, evidence checklist, explicit PASS / CONDITIONAL / FAIL |
| Release manager | Rebase or merge candidate once, pass all required checks, inspect deployment, record rollback | Branch/commit/CI/deployed SHA, launch decision |

## Orchestrator sequence
1. Read `AGENTS.md`, fetch current `main` SHA, active PRs, known failures and exact preview deployment. Verify no other worker is changing the branch.
2. Delegate parallel **read-only** reviews to independent roles; keep file ownership exclusive when edits start. Merge patches only through orchestrator. Avoid competing PRs and duplicate reviewers of the same line.
3. Run full source/release gates: `npm run content:check`, trivia/source/rights gates, `npm run factory:check`, `npm run typecheck`, `npm test`, `npm run build`, desktop/mobile Chromium, WebKit, analytics and Survival flag tests. Verify API bundle is rebuilt, matching server sources.
4. Re-run targeted tests for every P0/P1 and new timeout/refresh/DST cases; capture evidence. Review 320x568, 390px, 720x450 at 200% zoom, 1440px, reduced motion, and screen-reader focus.
5. Independent critic reviews the **integrated release commit** against user-approved scope; the fixer cannot approve their own work. Any failing CI, P0/P1, missing server compatibility or misleading status is a release veto.
6. Only after green gates + critic sign-off, merge the minimum set of comprehensive PRs in dependency order and verify production deployment points to merged SHA. Do not create a separate Vercel production deployment while Git integration already builds `main`.
7. If a gate cannot be verified, record it as **unverified** and never fabricate approvals or deployment success. A general-availability launch stays on hold. For this **owner-directed limited beta release only**, an unavailable physical iPhone/VoiceOver session may be documented as a post-release device follow-up **only if**: the full WebKit iPhone simulation, axe WCAG, responsive 320/375/390/720, keyboard and reduced-motion regression suite passes at the exact SHA; the risk and hardware gap are documented in `docs/BETA-RELEASE-ACCEPTANCE.md`; the independent critic explicitly evaluates this exception and returns **PASS** for the exact SHA; and there is no confirmed P0/P1 defect. An independent critic's CONDITIONAL or FAIL still blocks merging. This is not permission to skip automatable tests or claim physical hardware testing happened.

## This batch
- Prior `#17` server/privacy fixes and `#18` UI fixes are integrated in candidate `#20` for a single review. Do not merge either separately unless integration is reverified.
- `#19` calendar reminders were merged independently into `main` by the owner on November 22. V3 integration reconciles its Eastern-midnight calendar reminders with V3 gameplay and privacy changes. The device-specific calendar checks listed in PR #19, exact-SHA CI, preview and final independent critic gates still apply before PR #23 release.
- The new shot clock uses browser-local time; refreshing and changing tabs should not give more time. It is not an anti-cheat system; challenge scores and times are unverified. Speed breaks **only** score ties.
- Editorial sequencing is documented in `docs/EDITORIAL-SEQUENCING.md`; no unverified changes to already published slates.
- Keep incremental spend at $0, standard GitHub `ubuntu-latest` CI and existing free Vercel setup. No paid agents, runners or new API subscriptions.
