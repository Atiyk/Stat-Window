# Content audit: every existing question

Audited 2026-11-16 against the repository at `c262b35` (main). **13 slates, 65 questions, 2026-11-15 → 2026-11-27.** No questions were added or removed.

## How to read this

Each question gets 0–3 on five things: **Cl**arity (do you know what number you're estimating?), **In**terest (memorable record or story?), **Es**timability (can an informed fan get close without knowing one exact figure?), **Re**veal (does the note teach something?), **Sc**ale (sensible bounds and step, no hint from where the answer sits). Factual correctness is a separate pass/fail: **no question failed it**, and none needed an answer change. Difficulty (E/M/H/X = Easy, Medium, Hard, Expert) is an editorial **hypothesis**, not calibrated: it should be checked against real round scores once analytics are on.

"Pos" is where the answer sits along the ruler (0 = low end, 1 = high end), before → after.

## Rules applied

- **Published days (2026-11-15, 2026-11-16)** are untouched: same ids, answers, scales, steps, order and text. `content/published.lock.json` now records the scoring fields of every day, and `npm run content:check` fails the build if a day on or before today ever changes them. Flags on published days are listed for a future, versioned correction, not fixed silently.
- **Unpublished days (2026-11-17 onward)** got wording, note, order and scale changes only. No answer changed. New claims in notes were checked against the cited Wikipedia page on 2026-11-16 (one proposed claim, that Lewis Hamilton passed Schumacher's win record in 2020, was not on the cited page, so the note says only "the record when he retired", as the source does).
- **Fact checking.** Every question was verified against its source page on 2026-11-15 (see `verified` in each file). This pass re-read each question against its stored source quote and re-fetched the cited page for the seven claims added or reworded here. It did not re-fetch all 65 pages.
- Nobody has played an unpublished day (the archive only offers earlier days), so the scale changes re-score no one.

## The biggest finding: answers sat in the same place

Before this pass, 61 of 65 answers sat between 45% and 75% of the way along the ruler (average 62%). A player who noticed could centre a tight window around the 60% mark and beat players who actually knew the number. That rewards gaming the format, not sports knowledge.

For the 55 unpublished questions the scales were moved so answers land anywhere from about 20% to 80% (average now 53%, spread 19 points; 27 of 55 in the 45–75% band, down from 52). Most ranges keep a similar number of steps (all stay within the 5–400 rule), so a window of a given share of the ruler is worth what it was. Moving a scale changes only where the answer sits, never the scoring formula. Natural caps were kept where they help a player reason (82 games, 114 possible points, 22 races, 17 games).

`npm run content:check` now warns if the answers on upcoming days drift back toward one spot.

## Summary

| | Count |
| --- | --- |
| Questions audited | 65 (13 slates) |
| Factual blockers | 0 |
| Revised (unpublished days) | 45 |
| Of those, scale moved | 42 |
| Of those, wording, note or order improved | 11 |
| Published questions flagged for a later, versioned correction | 3 (`oly-phelps-golds` note, `nba-kareem-career-pts` stored quote, `ten-isner-mahut-games` repeat) |
| Blocked, needs a replacement question | 1 (`oly-phelps-medals`, 2026-11-25: its answer was given away on day 1) |
| Variety flags (same player or event twice within a week) | 5 |
| NBA questions | 14 of 65; 12 of 13 days have at least one (2026-11-26 has none); no day is NBA-only |

## Deferred (not done in this sprint, by instruction)

1. **Replace `oly-phelps-medals` (2026-11-25, round 3).** Its answer, 28, appears in the day-1 reveal. Returning players get a free 100. Needs a new, sourced question; this sprint adds none.
2. **NBA-only transition.** The game is multi-sport today (NBA count above). Going NBA-only needs new content.
3. **Content runway.** The last slate is **2026-11-27**. From 2026-11-28 the game shows "Today's puzzle is still being checked" and offers earlier days. Nothing in this sprint extends that; `content:check` prints the days left and warns in CI when fewer than 7 remain.
4. **Variety.** Gretzky appears three times in nine days, Nolan Ryan and the Isner–Mahut match twice each, and two unbeaten boxers five days apart. Fixing that needs replacements.
5. **Kareem source quote** (published day) still calls him the current leader. The note players see is accurate; refresh the stored quote in a versioned correction.

## Every question

| Day | # | Question id | Cl | In | Es | Re | Sc | Diff | Pos | Issue | Change | Source | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-15 | 1 | `nba-gsw-2016-wins` | 3 | 3 | 3 | 3 | 2 | E | 79% → 79% | Answer sits 79% along; 82 is the natural cap | None (published) | [Wikipedia](https://en.wikipedia.org/wiki/2015%E2%80%9316_Golden_State_Warriors_season) | Locked |
| 2026-11-15 | 2 | `oly-phelps-golds` | 3 | 3 | 3 | 2 | 2 | E | 57% → 57% | Reveal note gives away the 2026-11-25 answer (28 medals) | None (published); 11-25 Q3 flagged | [Wikipedia](https://en.wikipedia.org/wiki/Michael_Phelps) | Locked, flag |
| 2026-11-15 | 3 | `nhl-gretzky-1982-goals` | 3 | 3 | 2 | 3 | 2 | M | 58% → 58% | — | None (published) | [Wikipedia](https://en.wikipedia.org/wiki/Wayne_Gretzky) | Locked |
| 2026-11-15 | 4 | `ten-isner-mahut-games` | 3 | 3 | 2 | 2 | 2 | H | 66% → 66% | Same match reappears on 2026-11-17 (minutes) | None (published) | [Wikipedia](https://en.wikipedia.org/wiki/Isner%E2%80%93Mahut_match_at_the_2010_Wimbledon_Championships) | Locked, flag |
| 2026-11-15 | 5 | `mlb-ripken-streak` | 3 | 3 | 2 | 1 | 2 | H | 54% → 54% | Reveal restates the number | None (published) | [Wikipedia](https://en.wikipedia.org/wiki/Cal_Ripken_Jr.) | Locked |
| 2026-11-16 | 1 | `mlb-bonds-2001-hr` | 3 | 3 | 3 | 1 | 2 | E | 61% → 61% | Reveal restates the number | None (published) | [Wikipedia](https://en.wikipedia.org/wiki/Barry_Bonds) | Locked |
| 2026-11-16 | 2 | `fb-messi-2012-goals` | 3 | 3 | 2 | 2 | 2 | M | 61% → 61% | — | None (published) | [Wikipedia](https://en.wikipedia.org/wiki/Lionel_Messi) | Locked |
| 2026-11-16 | 3 | `nba-klay-quarter` | 3 | 3 | 2 | 3 | 2 | H | 54% → 54% | — | None (published) | [Wikipedia](https://en.wikipedia.org/wiki/Klay_Thompson) | Locked |
| 2026-11-16 | 4 | `golf-nicklaus-majors` | 3 | 2 | 3 | 1 | 2 | M | 60% → 60% | Reveal restates the number | None (published) | [Wikipedia](https://en.wikipedia.org/wiki/Jack_Nicklaus) | Locked |
| 2026-11-16 | 5 | `nba-kareem-career-pts` | 3 | 3 | 2 | 2 | 2 | X | 61% → 61% | Stored source quote calls him the current leader (LeBron James passed him in 2023); the note on screen ("long the regular-season record") is accurate | None (published); quote refresh deferred | [Wikipedia](https://en.wikipedia.org/wiki/Kareem_Abdul-Jabbar) | Locked, flag |
| 2026-11-17 | 1 | `nba-bulls-1996-wins` | 3 | 3 | 3 | 3 | 2 | E | 76% → 76% | Thin reveal ("They went 72–10.") | Note: most wins until the 2015–16 Warriors (both in sources) | [Wikipedia](https://en.wikipedia.org/wiki/1995%E2%80%9396_Chicago_Bulls_season) | Revised |
| 2026-11-17 | 2 | `ten-serena-slams` | 3 | 3 | 3 | 2 | 3 | M | 66% → 72% | Answer at 66% | Scale 0–35 → 5–30 | [Wikipedia](https://en.wikipedia.org/wiki/Serena_Williams) | Revised |
| 2026-11-17 | 3 | `mlb-dimaggio-streak` | 3 | 3 | 2 | 2 | 3 | M | 45% → 77% | — | Scale 20–100 → 10–70 | [Wikipedia](https://en.wikipedia.org/wiki/Joe_DiMaggio%27s_56-game_hitting_streak) | Revised |
| 2026-11-17 | 4 | `nhl-brodeur-shutouts` | 3 | 2 | 1 | 2 | 3 | H | 56% → 30% | Hard for non-hockey fans | Scale 30–200 → 80–230 | [Wikipedia](https://en.wikipedia.org/wiki/Martin_Brodeur) | Revised |
| 2026-11-17 | 5 | `ten-isner-mahut-minutes` | 2 | 2 | 2 | 2 | 3 | X | 58% → 33% | Repeats the match used two days earlier; minutes need arithmetic from "11 h 5 min" | Scale 200–1,000 → 400–1,200 | [Wikipedia](https://en.wikipedia.org/wiki/Isner%E2%80%93Mahut_match_at_the_2010_Wimbledon_Championships) | Revised, flag variety |
| 2026-11-18 | 1 | `nba-wilt-100` | 3 | 3 | 3 | 1 | 3 | E | 62% → 20% | Famous round number: easy opener | Scale 50–130 → 80–180 | [Wikipedia](https://en.wikipedia.org/wiki/Wilt_Chamberlain%27s_100-point_game) | Revised |
| 2026-11-18 | 2 | `nfl-brady-sb-wins` | 3 | 3 | 3 | 2 | 3 | E | 58% → 70% | — | Scale 0–12 → 0–10 | [Wikipedia](https://en.wikipedia.org/wiki/Tom_Brady) | Revised |
| 2026-11-18 | 3 | `fb-city-2018-points` | 3 | 2 | 2 | 1 | 2 | M | 74% → 74% | Answer at 74% (114 is the natural cap) | — | [Wikipedia](https://en.wikipedia.org/wiki/2017%E2%80%9318_Manchester_City_F.C._season) | OK |
| 2026-11-18 | 4 | `f1-schumacher-wins` | 3 | 2 | 2 | 2 | 3 | H | 61% → 68% | Reveal omitted that the record has since fallen | Note: "the record when he retired" (source wording); scale 30–130 → 30–120 | [Wikipedia](https://en.wikipedia.org/wiki/Michael_Schumacher) | Revised |
| 2026-11-18 | 5 | `nfl-rice-career-yds` | 3 | 2 | 2 | 2 | 3 | X | 64% → 39% | Reveal restated the number only | Note: NFL career record (verified); scale 10,000–30,000 → 15,000–35,000 | [Wikipedia](https://en.wikipedia.org/wiki/Jerry_Rice) | Revised |
| 2026-11-19 | 1 | `mlb-ruth-1927-hr` | 3 | 3 | 3 | 2 | 3 | E | 67% → 33% | — | Scale 20–80 → 40–100 | [Wikipedia](https://en.wikipedia.org/wiki/1927_New_York_Yankees_season) | Revised |
| 2026-11-19 | 2 | `ten-nadal-rg-titles` | 3 | 3 | 3 | 1 | 3 | E | 70% → 70% | Reveal restates the number | — | [Wikipedia](https://en.wikipedia.org/wiki/Rafael_Nadal) | OK |
| 2026-11-19 | 3 | `nba-skiles-assists` | 3 | 2 | 2 | 2 | 3 | H | 50% → 25% | Obscure name, fair if you know assist records | Scale 10–50 → 15–75 | [Wikipedia](https://en.wikipedia.org/wiki/Scott_Skiles) | Revised |
| 2026-11-19 | 4 | `golf-tiger-2000-usopen` | 3 | 3 | 2 | 2 | 3 | H | 60% → 40% | — | Scale 0–25 → 5–30 | [Wikipedia](https://en.wikipedia.org/wiki/2000_U.S._Open_(golf)) | Revised |
| 2026-11-19 | 5 | `mlb-henderson-sb` | 3 | 3 | 2 | 3 | 3 | X | 60% → 27% | — | Scale 500–2,000 → 1,000–2,500 | [Wikipedia](https://en.wikipedia.org/wiki/Rickey_Henderson) | Revised |
| 2026-11-20 | 1 | `nfl-dolphins-1972-wins` | 3 | 3 | 3 | 1 | 2 | E | 64% → 64% | Context "they never lost" makes it a gimme (fine as an opener) | — | [Wikipedia](https://en.wikipedia.org/wiki/1972_Miami_Dolphins_season) | OK |
| 2026-11-20 | 2 | `fb-klose-wc-goals` | 3 | 2 | 2 | 2 | 3 | M | 53% → 53% | Note says the record "stood for twelve years": correct, it fell at the 2026 World Cup | — | [Wikipedia](https://en.wikipedia.org/wiki/Miroslav_Klose) | OK |
| 2026-11-20 | 3 | `nba-curry-2016-threes` | 3 | 3 | 2 | 3 | 3 | H | 63% → 38% | — | Scale 150–550 → 250–650 | [Wikipedia](https://en.wikipedia.org/wiki/2015%E2%80%9316_Golden_State_Warriors_season) | Revised |
| 2026-11-20 | 4 | `oly-comaneci-tens` | 3 | 3 | 2 | 3 | 3 | H | 47% → 70% | — | Scale 0–15 → 0–10 | [Wikipedia](https://en.wikipedia.org/wiki/Nadia_Com%C4%83neci) | Revised |
| 2026-11-20 | 5 | `mlb-aaron-career-hr` | 3 | 3 | 3 | 2 | 3 | M | 59% → 26% | Famous number; a soft finale | Scale 400–1,000 → 600–1,200 | [Wikipedia](https://en.wikipedia.org/wiki/Hank_Aaron) | Revised |
| 2026-11-21 | 1 | `nba-kobe-81` | 3 | 3 | 3 | 3 | 3 | E | 68% → 73% | Context lacked the opponent | Context and note name the Raptors and the 122–104 score (verified); scale 40–100 → 30–100 | [Wikipedia](https://en.wikipedia.org/wiki/Kobe_Bryant) | Revised |
| 2026-11-21 | 2 | `nhl-gretzky-1986-pts` | 3 | 2 | 2 | 1 | 3 | M | 68% → 72% | Third Gretzky question in nine days | Scale 120–260 → 100–260 | [Wikipedia](https://en.wikipedia.org/wiki/Wayne_Gretzky) | Revised, flag variety |
| 2026-11-21 | 3 | `cri-tendulkar-tons` | 3 | 3 | 3 | 3 | 3 | M | 58% → 33% | — | Scale 30–150 → 50–200 | [Wikipedia](https://en.wikipedia.org/wiki/Sachin_Tendulkar) | Revised |
| 2026-11-21 | 4 | `box-mayweather-wins` | 3 | 3 | 3 | 1 | 3 | M | 60% → 33% | — | Scale 20–70 → 30–90 | [Wikipedia](https://en.wikipedia.org/wiki/Floyd_Mayweather_Jr.) | Revised |
| 2026-11-21 | 5 | `mlb-ryan-strikeouts` | 3 | 2 | 2 | 1 | 3 | X | 68% → 43% | Nolan Ryan appears again on 11-27 | Scale 3,000–7,000 → 4,000–8,000 | [Wikipedia](https://en.wikipedia.org/wiki/Nolan_Ryan) | Revised, flag variety |
| 2026-11-22 | 1 | `nba-russell-titles` | 3 | 3 | 3 | 2 | 3 | E | 73% → 73% | — | — | [Wikipedia](https://en.wikipedia.org/wiki/Bill_Russell) | OK |
| 2026-11-22 | 2 | `fb-fontaine-1958` | 3 | 2 | 1 | 2 | 3 | M | 65% → 40% | Obscure for non-football fans | Scale 0–20 → 5–25 | [Wikipedia](https://en.wikipedia.org/wiki/Just_Fontaine) | Revised |
| 2026-11-22 | 3 | `nfl-dickerson-1984-yds` | 3 | 2 | 2 | 1 | 3 | H | 65% → 74% | — | Scale 1,200–2,600 → 1,000–2,500 | [Wikipedia](https://en.wikipedia.org/wiki/Eric_Dickerson) | Revised |
| 2026-11-22 | 4 | `f1-verstappen-2023-wins` | 3 | 3 | 2 | 2 | 2 | H | 82% → 82% | Answer at 82% (22 races is the natural cap) | — | [Wikipedia](https://en.wikipedia.org/wiki/2023_Formula_One_World_Championship) | OK |
| 2026-11-22 | 5 | `ath-bolt-100m` | 3 | 3 | 3 | 2 | 3 | M | 22% → 22% | Well-known time; finale is easier than the slot suggests | — | [Wikipedia](https://en.wikipedia.org/wiki/Usain_Bolt) | OK, flag order |
| 2026-11-23 | 1 | `oly-owens-1936` | 3 | 3 | 3 | 1 | 3 | E | 50% → 50% | Easiest question of the day sat third | Moved to round 1 | [Wikipedia](https://en.wikipedia.org/wiki/Jesse_Owens) | Revised |
| 2026-11-23 | 2 | `nhl-habs-cups` | 3 | 2 | 2 | 1 | 3 | M | 63% → 76% | — | Moved to round 2; scale 5–35 → 5–30 | [Wikipedia](https://en.wikipedia.org/wiki/List_of_Stanley_Cup_champions) | Revised |
| 2026-11-23 | 3 | `nba-jordan-63` | 3 | 3 | 2 | 2 | 3 | M | 66% → 72% | — | Moved to round 3; note adds playoff record (source list); scale 30–80 → 20–80 | [Wikipedia](https://en.wikipedia.org/wiki/List_of_NBA_single-game_playoff_scoring_leaders) | Revised |
| 2026-11-23 | 4 | `mlb-ichiro-2004-hits` | 3 | 3 | 2 | 1 | 3 | H | 68% → 75% | — | Scale 180–300 → 150–300 | [Wikipedia](https://en.wikipedia.org/wiki/Ichiro_Suzuki) | Revised |
| 2026-11-23 | 5 | `nhl-gretzky-career-pts` | 3 | 3 | 2 | 3 | 3 | X | 68% → 43% | — | Scale 1,500–3,500 → 2,000–4,000 | [Wikipedia](https://en.wikipedia.org/wiki/List_of_career_achievements_by_Wayne_Gretzky) | Revised |
| 2026-11-24 | 1 | `nba-lakers-streak` | 3 | 3 | 2 | 1 | 3 | E | 57% → 57% | — | — | [Wikipedia](https://en.wikipedia.org/wiki/1971%E2%80%9372_Los_Angeles_Lakers_season) | OK |
| 2026-11-24 | 2 | `fb-shearer-pl-goals` | 3 | 2 | 2 | 1 | 3 | M | 64% → 20% | — | Scale 100–350 → 200–500 | [Wikipedia](https://en.wikipedia.org/wiki/Alan_Shearer) | Revised |
| 2026-11-24 | 3 | `ten-navratilova-wimbledon` | 3 | 2 | 3 | 2 | 3 | M | 60% → 75% | — | Scale 0–15 → 0–12 | [Wikipedia](https://en.wikipedia.org/wiki/Martina_Navratilova) | Revised |
| 2026-11-24 | 4 | `nfl-sb51-deficit` | 2 | 3 | 3 | 2 | 3 | H | 71% → 50% | Prompt "by how many points did they trail" could mean any moment | Prompt asks for the biggest deficit; note adds largest Super Bowl comeback (verified); scale 0–35 → 10–40 | [Wikipedia](https://en.wikipedia.org/wiki/Super_Bowl_LI) | Revised |
| 2026-11-24 | 5 | `mlb-rose-hits` | 3 | 3 | 2 | 1 | 3 | X | 63% → 38% | — | Scale 3,000–5,000 → 3,500–5,500 | [Wikipedia](https://en.wikipedia.org/wiki/Pete_Rose) | Revised |
| 2026-11-25 | 1 | `nba-wilt-55-reb` | 3 | 3 | 2 | 2 | 3 | E | 70% → 50% | — | Note adds the single-game record (source list); scale 20–70 → 30–80 | [Wikipedia](https://en.wikipedia.org/wiki/List_of_NBA_single-game_rebounding_leaders) | Revised |
| 2026-11-25 | 2 | `fb-arsenal-unbeaten` | 3 | 3 | 2 | 3 | 3 | M | 58% → 38% | — | Scale 20–70 → 30–80 | [Wikipedia](https://en.wikipedia.org/wiki/The_Invincibles_(football)) | Revised |
| 2026-11-25 | 3 | `oly-phelps-medals` | 3 | 2 | 1 | 1 | 2 | M | 60% → 60% | Answer was given away in the 2026-11-15 reveal ("out of 28 Olympic medals") | None: needs a replacement question (deferred to content phase) | [Wikipedia](https://en.wikipedia.org/wiki/Michael_Phelps) | Blocked, defer |
| 2026-11-25 | 4 | `mlb-cy-young-wins` | 3 | 3 | 2 | 1 | 3 | H | 70% → 37% | — | Scale 300–600 → 400–700 | [Wikipedia](https://en.wikipedia.org/wiki/Cy_Young) | Revised |
| 2026-11-25 | 5 | `nfl-emmitt-career-yds` | 3 | 2 | 2 | 2 | 3 | X | 56% → 74% | — | Scale 10,000–25,000 → 8,000–22,000 | [Wikipedia](https://en.wikipedia.org/wiki/Emmitt_Smith) | Revised |
| 2026-11-26 | 1 | `nhl-howe-seasons` | 3 | 2 | 2 | 2 | 3 | E | 64% → 70% | — | Scale 10–35 → 5–35 | [Wikipedia](https://en.wikipedia.org/wiki/Gordie_Howe) | Revised |
| 2026-11-26 | 2 | `cri-lara-400` | 3 | 3 | 2 | 3 | 3 | M | 67% → 33% | Reveal restated the number | Note: highest Test score ever (verified); scale 200–500 → 300–600 | [Wikipedia](https://en.wikipedia.org/wiki/Brian_Lara) | Revised |
| 2026-11-26 | 3 | `box-marciano-wins` | 3 | 2 | 2 | 2 | 3 | M | 58% → 38% | Echoes the 50–0 Mayweather question five days earlier | Scale 20–70 → 30–80 | [Wikipedia](https://en.wikipedia.org/wiki/Rocky_Marciano) | Revised, flag variety |
| 2026-11-26 | 4 | `nhl-selanne-rookie` | 3 | 3 | 2 | 3 | 3 | H | 70% → 70% | — | Note: still the NHL rookie records (verified) | [Wikipedia](https://en.wikipedia.org/wiki/Teemu_Sel%C3%A4nne) | Revised |
| 2026-11-26 | 5 | `ath-beamon-1968` | 3 | 3 | 2 | 2 | 3 | X | 70% → 69% | — | Scale 7.5–9.5 → 7.8–9.4 | [Wikipedia](https://en.wikipedia.org/wiki/Bob_Beamon) | Revised |
| 2026-11-27 | 1 | `nba-pistons-186` | 3 | 3 | 2 | 2 | 3 | E | 66% → 36% | A hard opener for a casual fan | Scale 120–220 → 150–250 | [Wikipedia](https://en.wikipedia.org/wiki/List_of_highest-scoring_NBA_games) | Revised |
| 2026-11-27 | 2 | `golf-tiger-1997-masters` | 3 | 3 | 2 | 2 | 2 | M | 60% → 60% | — | — | [Wikipedia](https://en.wikipedia.org/wiki/1997_Masters_Tournament) | OK |
| 2026-11-27 | 3 | `fb-leicester-2016-points` | 3 | 3 | 2 | 2 | 3 | M | 62% → 68% | — | Scale 50–100 → 40–100 | [Wikipedia](https://en.wikipedia.org/wiki/2015%E2%80%9316_Leicester_City_F.C._season) | Revised |
| 2026-11-27 | 4 | `mlb-ryan-no-hitters` | 3 | 3 | 2 | 2 | 3 | H | 58% → 47% | Second Nolan Ryan question in seven days | Scale 0–12 → 0–15 | [Wikipedia](https://en.wikipedia.org/wiki/Nolan_Ryan) | Revised, flag variety |
| 2026-11-27 | 5 | `nba-wilt-1962-total` | 3 | 3 | 2 | 3 | 3 | X | 68% → 34% | — | Scale 2,000–5,000 → 3,000–6,000 | [Wikipedia](https://en.wikipedia.org/wiki/1961%E2%80%9362_Philadelphia_Warriors_season) | Revised |
