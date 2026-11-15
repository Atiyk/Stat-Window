# Scoring specification (v1)

Implemented in `src/engine/scoring.ts`, tested in `src/engine/scoring.test.ts`.

## Inputs
Every question has a scale: `min`, `max`, `step`, and a true `answer` with `min < answer < max`.
The range is `R = (max − min) / step` steps (a whole number, 5–400, enforced by the content check).

A player's window is `[lo, hi]`, snapped to the step grid, clamped to the scale, and at least one step wide (`hi − lo ≥ step`).
The window starts as the whole scale.

## Hit or miss
A window is a **hit** when `lo ≤ answer ≤ hi`. **Both edges are inclusive.**
Comparisons are made on an integer grid (`value × 10^decimals`), so decimal answers such as 9.58 s compare exactly.

## Points
Let `W = (hi − lo) / step`, the width in steps.

```
fraction = (R − W) / (R − 1)        # 1 for a one-step window, 0 for the full scale
points   = round(100 × fraction²)   # on a hit
points   = 0                        # on a miss
```

- One step wide and correct: **100**. Full scale: **0** (it can't miss, so it earns nothing).
- Worked examples on a 100-step scale: a tenth of the scale is worth 83, a fifth 65, half 26.
- The curve is the same fraction of *each question's* scale, so a "points" question and a "career yards" question are equally fair.
- Squaring the fraction makes wide, safe windows nearly worthless and rewards real conviction, which is where the tension comes from.
- `missBy` (shown on a miss) is the distance from the nearest edge of the window to the answer.

## Exploit checks (all covered by tests)
- Full-range windows always hit and always score 0.
- Points never increase as a window widens (monotonic).
- Inverted, zero-width, or out-of-scale windows are rejected by the engine; the UI can't produce them.
- A locked round is saved before the reveal; reloading never re-rolls it, and a second tab can't overwrite it (first lock wins).

## Daily total
Five rounds, 100 each, **500 maximum**. The share text shows the total and one mark per round:
🟩 75+ · 🟨 40–74 · 🟧 1–39 (hit) · ⬛ miss. It never includes answers.

## Day boundary
The official day is the **UTC calendar date**. Puzzle No. 1 is 2026-11-15. A new puzzle opens at 00:00 UTC for everyone.
(`src/engine/daily.ts`.) A tab left open across midnight moves to the new puzzle; a run in progress keeps its own date key, so its saved rounds are never lost.

## Versioning
Saved data lives under the `stat-window:v1` key and is validated on read. If the scoring rule ever changes, bump the key (v2) and keep v1 results displayable as they were scored; never re-score history.
