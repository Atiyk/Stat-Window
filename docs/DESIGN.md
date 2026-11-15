# Visual identity and design rationale

## The idea
**A sports record book and a highlighter.** Record books print numbers on rules and tables; the player's answer is a highlighter stroke laid across the ruler, held between two caliper brackets. Everything else on screen supports that one object.

## Directions considered
1. **Record book & highlighter** (chosen): cool paper ground, one ink-black field, one highlighter accent; typographic, flat, square. Works for every sport, because a printed number belongs to all of them.
2. **Night game scoreboard**: black ground, amber numerals. Gamey, but it lands next to dark SaaS themes and Hundo's look.
3. **Chalk and turf**: green field, white lines. Ownable, but reads as American football and fights the other sports.

## System
- **Type:** one family, Archivo (variable, SIL Open Font License, self-hosted through `@fontsource-variable/archivo`). Condensed heavy cuts (width 62–75%, weight 860+) for the big numerals and verdicts, like a printed stat line; normal-width 780 for questions; regular for running text. Tabular figures wherever numbers change.
- **Colour:** taken from the owner's sample screens. Warm paper `#FFF9ED` with a tone-step `#F3ECDB`, navy ink `#222843`, an indigo field `#29245D` for the ruler, lime highlighter `#D7F187`, violet `#5D4FD8` for actions and the mark, coral `#FF7769` for a miss (`#B8382F` when it's text on paper). The highlighter means "your window / you scored". Coral only ever means "outside", so the action colour is violet rather than the sample's coral button. The samples' gradients, glows and rounded cards stay out; only the colours came across.
- **Shape:** square corners everywhere, no gradients, no glows, no shadows on resting surfaces (only the dialog and toast, which float).
- **Mark:** an ink square holding a highlighter window between two brackets (`src/ui/Mark.tsx`, `public/favicon.svg`).

## Motion (purpose for each move)
- **Drag:** brackets track the pointer 1:1 with the grab offset kept; a grip tab under each bracket is the thumb target (48px wide). The value tag rides above the finger on touch devices. Tiny tick sound per step when sound is on.
- **Lock:** the brackets clamp (260 ms) — the window is now fixed.
- **Anticipation:** the answer flag travels along the ruler from the low end, counting as it goes, decelerating on a quint ease-out over 1.35 s. You watch it approach your window.
- **Landing:** a hit pumps the highlighter band and the points count up; a miss turns the band hollow, shakes it, and turns the pin red, then states the distance ("Missed by 3 goals").
- **Reduced motion:** no travel or shake; the answer appears in place with a short fade.
All motion is transform/opacity, interruptible where the user can act, and under 300 ms except the deliberate reveal.

## Borrowed principles (not assets)
From the Playlin chart: one hero interaction per screen (Size It Up), a metaphor that turns score into a place (Krillion's depth; here, the window on the ruler), 5 × 100 = 500 legibility (Size It Up, Hundo), a "lock it in" ritual (Hundo), a spoiler-free share. Range Squeeze uses the same low/high mechanic; Stat Window differs with sports-only verified facts, per-question real units and scales, a steep payoff curve, the caliper interaction, and the travelling reveal.
