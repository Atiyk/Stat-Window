# Design and gameplay polish

Base `f3ff603c9c84af08732b12565575a21a8a276e69`, the live V3 public beta. The polish branch matches the repository’s existing Vercel preview exclusion. The V3 production recovery remains on hold after the deployment quota rejection. [V3 recovery checkpoint](https://github.com/Atiyk/Stat-Window/pull/23#issuecomment-7091402064)

| Milestone | Completed work | Evidence |
| --- | --- | --- |
| Visual system | Chalk `#F7F6F2`, Ink `#202525`, and Juniper `#347967` across the game, results, dialogs, and share artwork. The answer uses a warm pin with separate accessible tones for the dark ruler and light recap. Existing DM Sans and tabular figures carry through. | Same-question browser captures at 320, 375, 390, 430, 720, 768, and 1440 px. Juniper on Chalk is 4.76:1 and white on Juniper is 5.15:1. |
| Gameplay | Grips preserve the pointer offset and choose the nearest handle when targets overlap. Exact entry returns keyboard focus and keeps full values. The answer travels and lands before the score counts up. A single live status describes the outcome. | Pointer, touch, keyboard, exact-value, reduced-motion, timer, and storage regressions in Playwright. The 24-second deadline, score rules, and public puzzle content are preserved. |
| First play and results | The untimed 73-win Warriors practice fits the ruler and grip targets on the narrow tutorial screen. The deliberate Start focuses Q1. The score leads results, and immediate native sharing can send the result text while the optional image finishes rendering. | First-run grip hit testing, official Warriors attribution, cross-tab clock recovery, and native sharing with and without the image. |

Playlin reference patterns informed the visible range controls and the short lock-to-feedback loop. [Size It Up](https://playlin.io/game/size-it-up/) · [Krillion](https://playlin.io/game/krillion/) · [Layers](https://playlin.io/game/layers/) · [Range Squeeze](https://playlin.io/game/range-squeeze/)

Typecheck, build, NBA content and factory validation, and 437 tests with Redis 7 passed. Local Chromium and iPhone WebKit are available for the browser matrix. Physical devices and VoiceOver require a separate device check.
