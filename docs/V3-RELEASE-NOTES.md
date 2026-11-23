# Stat Window V3 — release candidate notes (NOT RELEASED)

## Owner decision (November 22, 2026)
**Live global rankings are DEFERRED, not done.** Leave `LEADERBOARDS_ENABLED` and its associated erasure and UI flags absent in production/preview. Preserve dormant ranking backend, Redis scripts, UI source, tests and docs. Do not enable rankings, introduce paid services, perform hosted Redis writes or claim leaderboard activation is complete. Any future use requires new owner approval and independent current privacy/security/cost/vendor review.

## V3 player changes under review
- Recognizable and varied source-reviewed NBA five-question rounds with a 66-day future calendar; preserve current and already-published scoring locks.
- First-use interactive untimed practice using the actual Readout/Ruler and score reveal, followed by an explicit Start before timed Q1.
- 24-second Q1–Q5 wall-clock and hidden-tab/reload/DST handling, accessible mobile and desktop layouts.
- Shared challenges, daily percentile and independent opt-in analytics/consent/GPC/DNT/erasure, Survival and historic saves.
- Calendar reminders from owner's merged PR #19 reconciled into V3.

## Disabled ranking handling
- Ordinary V3 player browsers must see no global ranking Join, tabs, list or placeholder, and send no public ranking GET/POST.
- Disabled API GET/POST/DELETE return 503 without Redis when there is no authorized historical-data erasure. Retain existing server unit coverage and isolated activation-only test source, with a separate OFF browser suite in CI.
- Old browser ranking codes (if any) can request removal from **Privacy and your data** without finishing today's game. A failed deletion must never claim success and must preserve the browser code for retry.
- The current Vercel environment *name* listing and November 15–23 project environment-change audit log show no leaderboard activation settings. Main/V2 production contains no leaderboard API endpoint; V3's endpoint exists only in unreleased integration/preview. **This is not evidence that no historical ranking scores ever existed**. If any historical enrollment exists and safe erasure is unverified, STOP/escalate rather than ship.

## Uncompleted release gates
PR #23 remains a draft. Require latest-main consistency, precise content/licensing and published locks, reproducible publisher/Survival, current-head Chromium and iPhone WebKit/analytics/privacy/first-run/24s/a11y CI, READY exact-SHA preview, independent read-only product/editorial/a11y and disabled-release security/privacy critics explicitly PASS with zero shipping P0/P1, and one reviewed Git-triggered production merge/deploy with verified deployed SHA. Host strict-key Lua compatibility, vendor quotas/cost and public days played belong to future active rankings, not this V3-off release.
