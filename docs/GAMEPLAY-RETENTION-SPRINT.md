# Gameplay and retention sprint

Baseline `0605e0a66744d2ca32208c7be5ec180ae5947ed7` on `main`. Vercel reports the same commit READY in production as `dpl_5Dze97HZUc2umSuiGY4mjpjJTEU3`. Main already includes PR #25's source-free play, legal credits, question context, and direct bonus facts. The unrelated open analytics PR #8 is outside this sprint.

| Milestone | Starting point and scope | Ownership | Dependencies and acceptance | Status |
| --- | --- | --- | --- | --- |
| A Gameplay | Existing ruler, points and answer motion. Refine their sequence and the final score. | Round and Ruler worker, Results integration | Preserve 24-second deadline, scoring and input paths. Verify touch, keyboard, zero hits, misses and perfect hits. | Implemented, integration checks pending |
| B Results and retention | Existing comparison, sharing, local records and archive. Add compact performance feedback, share formats and streak milestones. | Results, share-card, summary and integration | Verify native and fallback sharing, accessible archive disclosure, and official history. | Implemented, integration checks pending |
| C Install and practice | Existing historical and challenge routes. Add home-screen support and an untimed practice option. | Manifest and install worker, practice and timing worker | Preserve deep links, Eastern rollover, all competitive isolation, and fresh daily content. | Implemented, integration checks pending |
| D Editorial | PR #25 copy baseline and existing NBA publishing locks. Formalize review and measurable slate checks. | Question factory worker | Run factory, rights, publication and trivia checks. Preserve locked questions. | Implemented, integration checks pending |
| E Integration and release | Coordinated branch from production baseline. | Integration manager and independent reviewers | Exact-SHA suite, critic sign-off, GitHub CI, one production release and verification. | Pending |

| Improvement | Status | Files and regression verification |
| --- | --- | --- |
| 1. Final score | Implemented, integration checks pending | Results and reduced-motion browser checks |
| 2. Bracket feedback | Implemented, integration checks pending | Ruler, Readout and input regression |
| 3. Points feedback | Implemented, integration checks pending | Round, gameplay and score assertions |
| 4. Answer reveal | Implemented, integration checks pending | Round and reduced-motion browser checks |
| 5. Share confirmation | Implemented, integration checks pending | Results and native/clipboard/download checks |
| 6. Perfect score | Implemented, integration checks pending | Round and score regression |
| 7. Near misses | Implemented, integration checks pending | Ruler/Round and gap regression |
| 8. Personalized results | Implemented, integration checks pending | Results and summary regression |
| 9. Portrait share | Implemented, integration checks pending | Canvas and browser PNG checks |
| 10. Home-screen install | Implemented, integration checks pending | Manifest, icons, install UX and browser checks |
| 11. Streak milestones | Implemented, integration checks pending | Official history and one-time presentation regression |
| 12. Archive disclosure | Implemented, integration checks pending | Results and keyboard/browser checks |
| 13. Untimed practice | Implemented, integration checks pending | App, timing, storage and isolation checks |
| 14. Question quality | Implemented, integration checks pending | Factory, editorial documentation and automated checks |

## Interaction references

No component or font files from the reference libraries are included. Existing React, CSS, browser APIs, and Canvas cover the interaction and export paths.

| Reference | Pattern used |
| --- | --- |
| [21st Number Ticker](https://21st.dev/@danielpetho/components/basic-number-ticker) | The reference animates a number over time. The result renders the true score immediately with a 380 ms CSS entrance and staggered score tiles. |
| [21st Slider 06](https://21st.dev/@shadcnspace/components/slider-06) and [Marks Slider](https://21st.dev/@ai2/components/slider-marks) | Both inform the active value and scale cues. The existing bracket grips, whole-window drag, exact entry, snap math, and native slider semantics remain. |
| [21st Score Keeper](https://21st.dev/@f0rextasy/components/score-keeper) | The reference pulses a score change. The result, running total, and question tile update together from the same scored round. |
| [Kawai Text Animations](https://kawai-text-animation.pages.dev/) | A short fade and rise brings in the fact after the moving marker lands. The question and score are always immediately readable. |
| [21st Copy With Confirmation](https://21st.dev/@ibrandify/components/copy-with-confirmation) and [Loading Button](https://21st.dev/@ddoemonn/components/loading-button) | Stable action labels, a busy state, and confirmation only after the clipboard or download action succeeds. A failed clipboard write selects the manual fallback. |
| [21st Confetti Button](https://21st.dev/@ruixen.ui/components/confetti-button) | The celebration is tied to a discrete action. A live perfect 100 gets a local pulse at the points instead of a fullscreen effect. |
| [21st Streak Badge](https://21st.dev/@trophyso/components/streak-badge) | A compact badge recognizes an exact 3-, 7-, or 30-day milestone once when the official result opens. |
| [Playlin 40](https://playlin.io/charts/) | Krillion’s quick scoring loop, Size It Up’s estimable ranges, and Layers’ varied prompts inform the pacing and editorial rubric. |

## Verification context

The public baseline passed desktop and mobile playthroughs from the Warriors tutorial through all five rounds, share text, score-card export, archive and return. Survival was verified with its pre-existing test flags. CI for the baseline editorial PR head passed all four jobs.

Independent candidate review is required across gameplay, engineering and accessibility, editorial, and release. Physical installation, iOS VoiceOver, and Android TalkBack require device testing. The iPhone WebKit profile tests installation guidance, standalone suppression, and the browser-side install event path. The browser’s OS install sheet and sharing targets are outside headless automation.

The production leaderboard stays deferred. The project’s Vercel build regenerates API bundles from the checked-in server source and then runs `api:check`. That order matches the baseline and CI. The production baseline deployment is an eligible rollback target. Untimed practice uses its own browser storage key, so rolling back the frontend preserves those records for a future update.
