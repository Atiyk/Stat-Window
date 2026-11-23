# Stat Window v2 — limited beta release acceptance (historical)

> For V3, owner-deferred live leaderboards are NOT required. The V3 exact-SHA beta scope and release gates are authoritative in `docs/V3-MULTI-AGENT-EXECUTION.md`; this older PR #20-era page is preserved only as historical evidence and does not assert a V3 review PASS.

This file separates **automated release evidence** from **physical-device evidence we do not possess**. The product owner instructed the orchestrator to complete and merge the vetted release. Treat this as a limited public beta, not a production-hardened, anti-cheat ranking system.

## Hard release gates (no waiver)

- Exact commit on PR #20 into main; content/schema/published lock and NBA provenance unchanged; relevant source files and generated score API bundle match.
- GitHub CI main check and iPhone WebKit check both green at that SHA: TypeScript, unit and real Redis Lua tests, NBA/Question Factory, Chromium desktop/mobile, preview build, analytics, Survival.
- Browser regression checks: first-play timer, numerical entry, keyboard input and lock, expired-turn zero, reload, background tab, fresh replay; score+time share and legacy link/backwards-compatible save; DST and Eastern midnight.
- Responsive and accessibility evidence: automated viewport checks 320×568, 375×720, 390×844, 720×450, 1440×900, 200% text, keyboard focus, reduced-motion path, axe serious/critical WCAG failures; iPhone 13 WebKit emulation.
- Preview READY at exact SHA; origin, privacy page and status checks; no API writes to live production, no paid infrastructure, no additional manual Vercel production deploy.
- Independent **read-only** critic examines the integrated SHA, the evidence here and omissions; it must explicitly return PASS for this beta with no P0/P1. A self-review cannot satisfy the gate.

## What automated checks cannot establish

1. **Physical iOS VoiceOver / Android TalkBack**: no physical device or accessibility hardware connected to the release agent. iPhone WebKit simulation and axe are not replacements for real screen-reader testing. A device owner should verify: VoiceOver announces both sliders and values, tap targets work with assistive touch, a timeout is announced, focus moves to the next question and results, and the Help/privacy dialogs return focus correctly. Fix any P0/P1 immediately, using a new PR.
2. **Production traffic and Upstash quotas**: the preview score API intentionally fails closed when preview data infrastructure is not configured. Automated API and Redis tests cover first-write-wins, deletion reserve and 429 behavior, but no production record has been modified to force a quota failure. Monitor free-plan limits with existing provider controls.
3. **Fairness**: challenge scores and elapsed time are player-reported and cannot be cheat-proof without accounts and server-timed sessions. Do not market them as verified competition.

These are disclosed **beta acceptance risks**, not claims of completed manual tests. They do not automatically waive other technical/independent gates. The independent critic may still veto the release.

## Post-beta review checklist

- Run actual physical iPhone Safari with VoiceOver, and Android Chrome with TalkBack; verify 320–390px equivalent sizes, focus, input, timeout and share.
- Confirm on a clean browser that the first play is clear, the daily resets at midnight Eastern, and the scoreboard copy makes unverifiable times obvious.
- Recheck score API limits and deletion messaging under synthetic isolated traffic, not live customer submissions.
- Review future NBA slate question selection independently; published question IDs, answers and locks must remain unchanged.
