# Phase 1 implementation checkpoint

Branch `feat/phase-1-release`, base `main` @ `555c071` (PR #10 merge, 2026-11-18). One consolidated PR. Survival branch (`feat/survival-gated`) and PR #8 (`fix/analytics-data-quality-20261116`, touches `scripts/analytics-readout.ts`) are not touched.

## Scope matrix

| Req | What changed | Files | Tests / evidence | Status |
|---|---|---|---|---|
| P1-A difficulty labels | Hidden in daily, practice, challenge and Survival UI; header says "Question N of 5". Ladder kept in content, validators and factory. | `src/App.tsx`, `src/ui/Round.tsx`, `src/ui/Survival.tsx` | `e2e/nba.spec.ts` asserts no Easy/Medium/Hard/Expert text while the content still climbs easy→expert | done |
| P1-B themes | Theme eyebrow and results recap removed; `theme` stays in the schema, calendars and publisher | `Round.tsx`, `Results.tsx`, `styles.css` | `e2e/nba.spec.ts`, `e2e/cutover.spec.ts` | done |
| P1-C reactions | Deterministic, curated library (71 lines, 11 situations) separate from rules; one line per reveal, never repeated within a run, stable on refresh; no real-event claims | `src/ui/reactions.ts`, `Round.tsx` | `src/ui/reactions.test.ts` (31 tests: boundaries, near/wide miss, determinism, fallbacks, copy rules) | done |
| P1-D sources | "Sources & method · Wikipedia" `<details>`: credit visible, article links + CC BY-SA 4.0 link + derivation + method inside | `src/ui/Sources.tsx` | `e2e/nba.spec.ts` (link hosts, licence link, keyboard via native details) | done |
| P1-E mobile | Shorter first screen (no theme/difficulty rows), reaction moved below the field so the ruler never jumps, 44px+ targets on new controls, sticky actions kept | `Round.tsx`, `styles.css` | before/after screenshots at 320–1440 in project files `stat-window/phase1/`; `e2e/layout.spec.ts` | done |
| P1-F sharing | Native share with PNG score card when `canShare({files})`; "Save score card" fallback; text and card show percentile only when verified and gated; new share outcomes tracked | `src/ui/share-card.ts`, `Results.tsx`, `src/engine/summary.ts` | `e2e/phase1.spec.ts`, existing `e2e/daily.spec.ts` share/clipboard tests | done |
| P1-G Day 1 | `season.ts`: canonical day vs season vs public label; `VITE_LAUNCH_DAY`/`LAUNCH_DAY` unset = beta (production unchanged); preview via `VITE_LAUNCH_PREVIEW=1` + `?launch-preview=` | `src/engine/season.ts`, `App.tsx`, `docs/LAUNCH.md` | `src/engine/season.test.ts` (Day 1/2, day before, midnight, stats partition, preview gating) | done, inactive |
| P1-H analytics | New events (percentile exposure, privacy choices, share image/save), in-app opt-out, GPC/DNT default off with explicit override, QA/launch cohort prefixes, privacy page | `src/lib/track.ts`, `src/lib/privacy.ts`, `src/ui/Privacy.tsx`, `public/privacy.html`, `docs/PRIVACY.md`, `docs/MEASUREMENT.md` | `src/lib/track.test.ts`, `src/lib/privacy.test.ts`, `e2e/analytics.spec.ts` | code done; production receipt: see below |
| P1-I percentiles | `/api/scores` Vercel Function: server re-scoring, eligibility from server clock, first-wins atomic Lua, consent by region, rate limit, daily budget, aggregates-only reads, deletion; client results UI with gate | `server/*`, `api/scores.js` (bundle), `src/engine/percentile.ts`, `src/lib/scores.ts`, `src/ui/Comparison.tsx`, `src/ui/use-comparison.ts`, `docs/PERCENTILES.md` | `server/api.test.ts`, `server/client.test.ts`, `server/redis.test.ts` (real redis-server in CI), `src/engine/percentile.test.ts` | code done; production: see below |

## Decisions

- **Store:** Upstash Redis Free via Vercel Marketplace (500K commands/month, no card). Chosen over the team's existing Neon database because that database belongs to another app; a separate store keeps the two apps independent. Compact per-day hash of counts.
- **Bundled function:** `server/` TS is bundled by Vite into a single `api/scores.js` (checked by `npm run api:check` in the build), because Vercel's per-file TS compile of `.ts`-extension imports is undocumented.
- **Analytics stays page-view based** (Hobby has no custom events). Activation = `VITE_ANALYTICS=vercel` in Production.
- **Consent:** EU/EEA/UK/CH and unknown locations must tap "Count my score"; GPC/DNT start both features off. Analytics is cookieless; opt-out in app.
- **Launch numbering:** the label changes, content never moves (see `docs/LAUNCH.md`).
- **Critic review (round 1, 2026-11-18):** two independent reviewers (engineering/security/privacy/cost; UX/content/licensing) both requested changes. Fixed:
  - **Cost:** budgets are now in estimated Upstash commands (scripts are billed as 1 + each `redis.call`, per Upstash's billing page), shared across environments, with a monthly ceiling of 380K (env can only lower it) and a 14K daily cap. Rate checks run before the budget, and paused or limited states are remembered per instance so they stop costing commands.
  - **Abuse:** GET accepts only `?day`. DELETE is one script over at most 9 days × 2 seasons, rate-limited, with its own reserve, and works with the switch off. There is a per-network daily cap of stored scores (10 in round 1, raised to 30 in round 2), and IPv6 is counted per /64.
  - **Consent:** a code-less probe goes first, so no key is created or sent before a yes. The Privacy switch shows "off" where the server asks first. The two consent buttons are now equal.
  - **Fail closed on Vercel:** without `VERCEL_ENV` or a 32+ character `SCORE_HASH_SECRET`, the API is off. Production clamps the 100-game gate, and the client enforces it too.
  - **UX:**
    - 44px targets for inline links.
    - The consent box moved below the share buttons, and a fixed-height percentile slot stops the layout jumping.
    - Focus returns after a choice.
    - Bare "Wikipedia" sources now get "Wikipedia contributors" and the CC BY-SA link.
    - Clean "Method:" sentence.
    - Reactions no longer echo "Inside."/"Outside." or overclaim, and near-miss is tightened.
    - The share card is pre-rendered, with a clipboard fallback when share is refused.
    - The label no longer breaks mid-number at 320px.

## Production activation status

Merged as PR #11 (head `af85bc4`, merge `c30d612`) on 2026-11-18 after both reviewers approved and CI passed on the exact head. Production deployment `71ugeEY6Z` went Ready.

| Item | State |
|---|---|
| Vercel Web Analytics (Hobby, 50K events/month, capped ingestion) | Enabled 2026-11-18 |
| Upstash Redis Free (iad1), linked to Production and Preview | Created 2026-11-18 |
| `SCORES_ENABLED=1`, `SCORES_NAMESPACE=production`, `SCORE_HASH_SECRET` (40 chars) | Production only. Preview has no `SCORES_ENABLED`, so its API answers 503 `disabled`. |
| Analytics on | By hostname since 2026-11-18: on at `stat-window.vercel.app`, off elsewhere, `VITE_ANALYTICS=off` turns it off (see `docs/MEASUREMENT.md`). |
| Live score round trip | Checked on production with `?qa=1`: a full game stored under the `qa` season, the slot showed "1 of 100 needed", and "Delete my scores" returned `removed: 1` and replaced the browser's code. |
| Formal Day 1 | Not active. `VITE_LAUNCH_DAY` and `LAUNCH_DAY` are unset (`docs/LAUNCH.md`). |

## Emergency switches

- Percentiles: set `SCORES_ENABLED=0` (or remove it) for Production and redeploy. Deletion keeps working while it is off.
- Analytics: set `VITE_ANALYTICS=off` for Production and redeploy.
- Anything else: Instant Rollback to the previous production deployment in the Vercel dashboard.
