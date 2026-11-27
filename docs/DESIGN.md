# Visual identity and design rationale

**History only.** The current identity is Garden Classic (Jersey Cream `#F7F4EE`, Garden Navy `#17365D`, Basketball Copper `#B94B21`) with the Court Geometry symbol: see [BRAND.md](BRAND.md). None of the palettes, fonts or marks below ship today. They record the directions tried before it: Clubhouse, Court, and the Chalk, Ink and Juniper polish candidate ([DESIGN-POLISH-PROGRESS.md](DESIGN-POLISH-PROGRESS.md)).

## Court (proposed 2026-11-18, replaces the Clubhouse colours if approved)
The Clubhouse look (cream paper, pine, terracotta, a soft serif, a white rounded card with a hairline border) had become the default look of generated pages, so it read as AI-made. Court keeps the pine identity and the caliper interaction and changes the rest:
- **The field is a solid block of pine,** edge to edge on phones. Inside it the roles flip: chalk `#F4F2EA` is the foreground, the window is a chalk tint and a hit brightens it.
- **The answer is ball orange `#FF7A1F`,** the only warm colour on the screen.
- **The page is ink `#121A16` on a neutral off-white `#F1EFE9`.** The main button is ink.
- **One family:** DM Sans at 820 to 850 for the question, the numbers and the wordmark, tracked tight. Fraunces is no longer loaded.
- **Square corners everywhere.** No hairline borders or outlined boxes: surfaces separate by a tone step.
- **The context line** ("NBA · Boston Celtics · 2023–24") sits under the question instead of above it, and the results date line sits under the score.
- **The five round cells** are larger filled squares: the current one is ink, played ones show their points.

## The idea
**Clubhouse: a warm editorial daily puzzle.** Paper and pine, with the game on a card at the centre. The player draws a window between two pine caliper brackets. The answer arrives as a terracotta pin. Colour is spent in two places, the window and the reveal, and everything else stays quiet: about 80% neutral, 15% pine and 5% terracotta.

The owner set this direction on 15 November 2026 (Clubhouse first, Sea Glass second). It replaced the first build's black, highlighter-yellow, square "record book" look.

## Directions studied
All four were rendered on the same build, so only the colour tokens differ (`e2e/study.spec.ts`, run with `STUDY=1`). An independent critic then ranked them:

1. **A. Clubhouse (chosen).** Paper `#F7F5EE`, pine `#2F614D`, terracotta `#CF775F`. It's the only one that reads as "warm editorial", and terracotta stays free for the reveal.
2. **B. Sea Glass.** Mist `#EEF3F2`, petrol `#1F5D6C`, amber-terracotta `#D98A5F`. Same structure, but cooler, so it reads more like a product. A close, safe second.
3. **D. Clay Court.** Sand, brick `#8F4429` and a blue reveal `#2E6F8E`. Brick puts the accent colour on every control, so the reveal can't stand out, and the blue "Outside." reads like a link.
4. **C. Scorecard.** Navy `#2C4A7A` and tomato `#D0603F`. This is closest to the corporate sports-media look the brief rules out.

## System
- **Type:** two open-licensed families (SIL OFL 1.1), self-hosted as variable fonts through `@fontsource-variable`. Only the weight axis is loaded, with Latin subsets split by `unicode-range`.
  - Fraunces 650 for the question, the day's verdict, the help title and the wordmark.
  - DM Sans for everything else, including the hit and miss words. Every number uses DM Sans tabular figures.
  - The critic found four serif levels competing, so Fraunces was cut back to the editorial voice only.
- **Colour:**
  - **Kept from the spec:** paper `#F7F5EE`, card `#FFFDF9`, ink `#20312B`, pine `#2F614D` (white text 7.0:1), soft pine `#E6EFE5`, terracotta `#CF775F`, hairlines `#DDE2DA`.
  - **Changed from the spec, with reasons:**
    - Muted text is `#5B6C63`, not `#62736A`. The spec value drops to 4.2:1 on the tinted fills, while `#5B6C63` stays at 4.7:1 or above everywhere.
    - Text on terracotta is `#2A1A14` (5.1:1). Ink only reached 4.2:1.
    - The ruler axis is `#86938A`, which gives 3.1:1 for graphics.
    - The window you draw is `#C8DDCD`. A hit deepens it to 30% pine, so winning is the strongest moment on the ruler, not the palest.
- **Meaning:**
  - Pine is anything you touch or won.
  - Terracotta is only ever the answer, in every state.
  - A miss is neutral and carried by shape: a hatched, dashed window, a "✕ Outside." line and a struck-through ledger cell.
  - A hit adds "✓" and a solid pine edge.
- **Shape:** 12px radius on the card and buttons, 8px on small controls. No gradients except the miss hatch, no glows, and no shadows at rest (only the toast floats).
- **Mark:** two pine brackets closing on an ink pin, with no tile (`src/ui/Mark.tsx`). The favicon puts the same glyph on paper.

## Motion (purpose for each move)
- **Drag:** brackets track the pointer 1:1 with the grab offset kept; a grip tab under each bracket is the thumb target (48px wide). The value tag rides above the finger on touch devices. Tiny tick sound per step when sound is on.
- **Lock:** the brackets clamp (260 ms) — the window is now fixed.
- **Anticipation:** the answer flag travels along the ruler from the far end, counting as it goes, decelerating on a quint ease-out over 1.35 s. You watch it approach your window.
- **Landing:** a hit pumps the highlighter band and the points count up; a miss hatches the band, shakes it, and states the distance ("Missed by 3 goals").
- **Reduced motion:** no travel or shake; the answer appears in place with a short fade.
All motion is transform/opacity, interruptible where the user can act, and under 300 ms except the deliberate reveal.

## Borrowed principles (not assets)
From the Playlin chart: one hero interaction per screen (Size It Up), a metaphor that turns score into a place (Krillion's depth; here, the window on the ruler), 5 × 100 = 500 legibility (Size It Up, Hundo), a "lock it in" ritual (Hundo), a spoiler-free share. Range Squeeze uses the same low/high mechanic; Stat Window differs with sports-only verified facts, per-question real units and scales, a steep payoff curve, the caliper interaction, and the travelling reveal.

## Ideas taken from the owner's five reference games (16 November 2026)
Read from the live pages of Krillion, People, Size It Up, Layers and Waffle. Several of these are client-rendered, so only their static text could be read.
- **Waffle's stats screen** led to "Your days": the player's own score distribution in 100-point bands, with today's band marked, plus their longest run. It's computed only from this browser's saved days, so nothing is invented.
- **Waffle's how-to, which gives an example for each state,** led to the help panel's worked hit and miss examples, with the same ✓ and ✕ shapes the game uses.
- **Already present:** Size It Up's five rounds of 100, the lock-in reveal and the scoring table; Layers' browser-only stats with copy-to-share; Krillion's "same for everyone" daily and archive.
- **Not taken:**
  - accounts and sign-in (Krillion, Layers, Waffle);
  - ad-unlocked hints and archives (Layers, Waffle);
  - paid streak protection (Layers);
  - a local-midnight reset option (Waffle), which would break "the same five for everyone".

