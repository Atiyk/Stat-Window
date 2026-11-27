# QA evidence

## Sprint 2026-11-16: Daily Five polish (PR #5)

Base: `main` at `c262b35` (PR #4 merged; its Vercel production status was green). Production could not be loaded from the build container (outbound access to vercel.app is blocked there), so the deployed site was checked through Vercel's GitHub status, not in a browser.

| Check | Result on the branch |
| --- | --- |
| `npm run content:check` | 13 slates, 65 questions; published days match the lock; 12 days of runway from 2026-11-16 |
| `npm run typecheck` | clean |
| `npm test` | 81 passed (scoring, dates, game, storage incl. old saves and visits, summaries, challenge links, content schema and lock, analytics event paths) |
| `npx playwright test --trace off` | 46 passed, 18 skipped by design (viewport sweep and axe run on desktop only; design study manual) |
| CI on the PR | green |

New browser coverage: challenge link opened in a second, clean browser after UTC midnight, with a refresh mid-run; a link for today; future, malformed and tampered links; a run in progress across midnight; share fallback with no share sheet and no clipboard; saved practice runs; layout at 320, 375, **390**, 768, **1024** and 1440 px including results and a challenge link; axe on challenge and results screens.

Not covered: physical phones and screen readers (VoiceOver/TalkBack) were not available; screen-reader behaviour is inferred from roles, labels and live regions checked by axe and the tests. One e2e test (midnight run, mobile project) timed out once under load; the cause was a missing wait for the first round, fixed, and it then passed in every later run.

### Independent critic

A separate reviewer with a veto checked the branch: verdict **ship after fixes**. All five findings were fixed:

| Finding | Fix |
| --- | --- |
| Major: existing players' saves had no visit record, so they would count as new browsers and inflate next-day returns | Visits are inferred from days already played (unit test) |
| Major: 2026-11-17 Serena note said "the most in the Open Era" (Djokovic has 24) | Now "the most by any woman in the Open Era"; answer and scale unchanged |
| Minor: racy midnight e2e test | Waits for the first round before playing |
| Minor: deleting a published day passed the lock; `content:lock --today` could unlock published days | Deleting fails the check; `content:lock` always uses the real date |
| Minor: event budget arithmetic in MEASUREMENT.md | Corrected |

---


What was checked before launch, how, and what is still known to be imperfect.

## Automated checks

| Check | Command | Result |
| --- | --- | --- |
| Content schema, sources and runway | `npm run content:check` | 13 days, 65 questions, every answer has a source URL and a quote or derivation; runway is above the 7-day warning |
| Types (strict) | `npm run typecheck` | clean |
| Unit tests | `npm test` | 60 passed in 7 files: scoring, daily UTC rules, game state machine, save store, summaries and share text, content schema, ruler labels |
| Browser tests | `npx playwright test` | 32 passed, 8 skipped by design (the viewport sweep and axe run once, on the desktop project) |
| CI | `.github/workflows/ci.yml` | runs all of the above on every push and pull request |

### What the browser tests cover

- **A full daily run** on desktop (1440×900) and a Pixel 7: five rounds scored exactly (expected total worked out by hand), saved, and a share text with no answers in it.
- **Refreshing mid-reveal** keeps the locked window and shows its result; a locked round can't be re-rolled.
- **UTC day rules**: everyone gets the same slate for the UTC date; a tab left open across midnight moves to the new puzzle (fake clock).
- **Practice** on an earlier day leaves the daily record alone.
- **Broken storage**: blocked localStorage still plays (with a note), and a corrupted save is set aside instead of crashing.
- **Input**: keyboard (arrows, Shift, Page keys, Home/End, Enter locks, brackets can't cross), typed numbers snap and clamp, mouse drag on brackets and the whole window, tap on the track, real touch events through CDP that never scroll the page, the full scale can't be locked, Skip, and reduced motion.
- **Layout at 320, 375, 768 and 1440 px** (phones at 720 px tall): no sideways scroll, sliders at least 44×44, the ruler fully on the first screen, the answer flag never on top of the verdict, **Next fully on screen after every reveal**, each new round opens at the top, clean console.
- **Accessibility**: axe (WCAG 2.0/2.1 A and AA) finds no serious or critical issues on the question, after the reveal, or in the help dialog. 200% text keeps the page usable with no sideways scroll.
- **Correction (2026-11-21 UI sweep, `docs/QA.md` claims above were wider than the tests).** The layout sweep ran phones at 720 px tall, so "the ruler fully on the first screen" was never checked at 320×568, where it failed (BUG-01). The 200% text check covered only the question at 375, and the results page did scroll sideways at 390 and 320 (BUG-08). Results opened about 200 px down at 320 (BUG-02). All three are now fixed and checked by `e2e/sweep.spec.ts`: 320×568 before and after the reveal, the results opening at the top with its heading focused, 200% text on the results at 390 and 320, and 720×450 (a 1440×900 laptop at 200% zoom, where the grips still sit under the docked button).

## Size

| Asset | Raw | Gzip |
| --- | --- | --- |
| App JS (React, game, zod/mini) | 279 kB | 87.6 kB |
| CSS | 21.4 kB | 5.6 kB |
| One day of questions (lazy) | about 2.6 kB | about 1.1 kB |
| Archivo variable font, Latin subset | 90 kB woff2 | n/a |

The day's questions load on their own, so adding days doesn't grow the first download.

## Independent critic

A separate agent with a veto reviewed the integrated build in a real browser at 320, 375, 768, 1024 and 1440 px, playing full runs and taking screenshots.

### Round 1: do not ship

3 critical and 4 major issues. All were fixed in `cb1bbd5`:

- Desktop layout after the reveal broke apart. It now runs question, full-width field, then the fact beside Next.
- The answer flag collided with the verdict. It now has its own lane above the ruler.
- At 320 px the ruler was below the fold on the first screen.
- The full, untouched ruler could be locked for a free hit. That's blocked now, and the button says "Pull the brackets in first".
- Help opened scrolled, with no diagram and a heavy shadow.
- The reveal started at the low end every time. It now starts from the far end and can be skipped.
- The copy for hits and for the day's verdict was flat.

### Round 2: ship after fixes

The critic confirmed every round 1 fix. It raised 1 new major and 7 minors, fixed in `de543dd` unless noted:

| Finding | Outcome |
| --- | --- |
| MAJOR: on phones, Next fell below the fold after every reveal | Fixed. The grip zone folds away once locked, the hint is removed, and on phones Next stays docked after the reveal. Browser tests now check it at every width. |
| Grip stems cut through tick labels | Fixed. Labels sit on a plate, so the stems pass behind them. |
| Some scales didn't label their low end (20–200 started at 50) | Fixed. The ends of a scale are labelled when no round value is near (unit tested). |
| "Worth 0" opens every round | Kept. The critic rated it acceptable, and starting from the full scale keeps the first move the player's own. |
| Skip looked disabled | Fixed with an outlined style. |
| At 320 the next round opened about 12 px scrolled | Fixed. Each new round scrolls to the top (tested). |
| Results stats looked like template boxes | Fixed. They're ruled ledger cells now. |
| Emoji share squares | Kept. Coloured squares are what players expect in a daily-game share; the critic didn't treat it as a blocker. |

The critic's sign-off condition was "ship after fixes"; every finding is now either fixed or deliberately kept for the reason given.

## Screenshots

`npx playwright test` writes them to `test-results/screens/`: question, reveal (full page and first screen) and results at 320, 375, 768 and 1440, plus 375 at 200% text. Representative ones are attached to the launch report.

## Known limitations

- **Stats live in one browser.** Streaks and history are saved in localStorage, with no accounts, so they don't follow a player to another device and clearing site data resets them. That's the price of no signup.
- **Content runway.** Daily slates are written and checked through 2027-01-27 (`content/days`). `npm run content:check` warns when fewer than 7 days remain; after the last day, players see that no new puzzle is published yet. `docs/CONTENT.md` describes publishing more.
- **Measurement runs only on production hostnames.** Events go to Vercel Web Analytics from the configured production hosts; previews, local runs and CI send nothing, and `VITE_ANALYTICS=off` turns it off (`docs/MEASUREMENT.md`).
- **A very wide window can be a hit worth 0.** That's the scoring rule working as designed (width counts against you), and Lock stays enabled for any window narrower than the full ruler. Since the 2026-11-21 UI sweep (BUG-03) the line above the ruler says "Worth 0 even if it's inside. Pull in further." before the lock, the reveal says "✓ Inside, but too wide to score. +0", and Help says in one line that nearly the whole ruler scores 0 too (`e2e/sweep.spec.ts`). Before that, the copy contradicted the enabled button and the reveal read "✓ Inside. +0".
- **EU/EEA/UK/CH completions log a 409 in the console.** The consent probe (`POST /api/scores` with no key or windows) is answered `409 consent-required` by the server, and browsers log every 4xx fetch as "Failed to load resource". It's harmless and can't be silenced from the client; the fix belongs in `server/api.ts` (answer `200 {"status":"consent-required"}`, which `src/lib/scores.ts` already handles). Left to the server owner (2026-11-21 UI sweep, BUG-06).
- **Brackets set before locking are not saved.** Reloading while adjusting brings the round back at the full scale (and the first-time hint, for a first-time player); only locked rounds are saved, which is what stops a refresh from re-rolling a result. Found in the 2026-11-21 UI sweep (BUG-12); not fixed.
- **Safari is covered by emulation only.** The `webkit-mobile` project (Playwright WebKit with iPhone 13 settings) runs in CI; it couldn't be run in the build container, and it is not a real iPhone.
- Gameplay uses visual feedback and vibration where the browser supports it.
- **One time zone for everyone.** The puzzle turns over at 12:00 AM Eastern (DST-aware), so everyone shares the same puzzle; the results screen shows that time in the player's local time.
