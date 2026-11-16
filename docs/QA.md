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
- **Layout at 320, 375, 768 and 1440 px**: no sideways scroll, sliders at least 44×44, the ruler fully on the first screen, the answer flag never on top of the verdict, **Next fully on screen after every reveal**, each new round opens at the top, clean console.
- **Accessibility**: axe (WCAG 2.0/2.1 A and AA) finds no serious or critical issues on the question, after the reveal, or in the help dialog. 200% text keeps the page usable with no sideways scroll.

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
- **Content runway.** 13 days are written and checked (15–27 November 2026). `npm run content:check` warns when fewer than 7 days remain; after 27 November, players see "still being checked" and the practice archive. `docs/CONTENT.md` describes publishing more.
- **No live measurement yet.** Events are typed and fire at the right moments, but go to a no-op sink until a free, privacy-friendly sink is chosen (`docs/MEASUREMENT.md`).
- **A very wide window can be a hit worth 0.** That's the scoring rule working as designed (width counts against you), but "Caught, but loose. +0" can surprise a first-time player. The help dialog explains it.
- **Sound is off by default** and uses WebAudio. Vibration only works where the browser supports it (not iOS Safari).
- **One time zone for everyone.** The puzzle turns over at 00:00 UTC, which is the evening before in the Americas. That's deliberate, so everyone shares the same puzzle, and the countdown shows when the next one opens.
