# Skill application ledger

Only skills that were actually loaded in this build are listed as used. Paths are the installed skill names.

| Skill | Used how | What it changed in the product |
| --- | --- | --- |
| `superpowers:using-superpowers` | Loaded at session start | Skill-first workflow; drove the inventory below. |
| `anthropic-skills:design-taste-frontend` | Read; ran its `lint.mjs` and `inspect.mjs --app` | House rules adopted: one type family, one accent, square corners, no gradients, no glows, no shadows at rest, no eyebrow labels or pill badges, tabular numerals. The linter's 6 FAILs were fixed or annotated (share-text emoji and two true overlays); the inspector's "headline over two lines" FAIL led to a wider desktop measure for questions. Its warnings on 120px numerals and a 50px h1 are deliberate: this is a game whose hero *is* the number, not a dashboard. Direction dealing (`draw.mjs`) was not used because it targets marketing pages; the direction came from the subject instead (record book + highlighter). |
| `anthropic-skills:emil-design-eng` | Read | Custom easing (`--ease-out: cubic-bezier(.23,1,.32,1)`), `scale(.97)` press feedback on buttons, hover effects gated behind `(hover:hover) and (pointer:fine)`, only transform/opacity animated, UI motion under 300 ms with one deliberate exception (the reveal), nothing animates from `scale(0)`. |
| `anthropic-skills:apple-design` | Read | Direct manipulation: 1:1 tracking with the grab offset kept when dragging the whole window, pointer capture, second-finger touches ignored, feedback on pointer-down. Interruptibility: the reveal can be skipped. Reduced motion replaces travel with an in-place appearance. Multimodal harmony: landing sound and haptic fire on the same frame. Size-specific tracking (tight display numerals, neutral body). 44px+ targets (brackets are 48 × 122). |
| `mattpocock-skills:tdd` | Read and followed | Seams agreed up front: scoring, UTC day policy, game state machine, save store, summary/share, content schema. Red-then-green for scoring, content schema, state machine, save store, summary and the lock rule; the date module's tests were written alongside it. Expected values come from worked examples in `docs/SCORING.md`, not from the implementation. |
| `impeccable:impeccable` (hook) | Its design hook ran automatically on every UI file write | Reported no deterministic issues; it was not invoked as a full workflow. |

## Workers used
- **Research:** a web-fetch worker read the Playlin chart and the seven benchmark game pages (several game sites could not be loaded; see `docs/DESIGN.md`).
- **Fact checking:** four web-fetch workers verified 69 candidate facts against fetched pages; 67 confirmed, 2 dropped (Peyton Manning's 2013 TD total and Arsenal's 26–12 split could not be confirmed from a fetched page).
- **Independent critic:** a separate agent reviewed the integrated build twice from screenshots and live play, with a veto. Round 1: "do not ship" (3 critical, 4 major); all fixed. Round 2 results are in `docs/QA.md`.

## Relevant skills not installed
No game-design, game-feel, player-psychology, Playwright, accessibility-specific, or Vercel deployment skill exists in this environment. The disciplines were applied directly: an explicit state machine and a scripted reveal (game feel), Playwright tests and axe-core checks (testing and accessibility), and Vercel's own documentation (deployment, analytics limits).
