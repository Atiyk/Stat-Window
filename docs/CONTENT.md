# Daily content: inventory and publishing workflow

## NBA-only from 2026-11-17

**Transition date: 2026-11-17 (UTC)**, set in `data/nba/calendar.json` (`cutover`) and mirrored in `src/content/cutover.ts`. From that day Stat Window is NBA-only and the daily slates come from the NBA fact database in `data/nba`.

- 2026-11-15 and 11-16 were live as mixed-sport days. Their files are unchanged. During the beta they stayed playable from the archive (labelled "mixed sports") and by link. On `LAUNCH_DAY` (see `docs/LAUNCH.md`) every beta day leaves the archive, and old `?day=`/`vs` links show a notice and open today's game. Saved runs stay in the browser.
- The mixed-sport files scheduled for 11-17 to 11-27 were never live (they were still in the future when they were replaced). They are kept in `content/retired/`.
- 72 NBA days run 2026-11-17 to 2027-01-27: 360 scheduled questions, 95 facts in reserve, 3 quarantined (`data/nba/quarantine.json`). Days from `VARIETY_FROM` use the three player formats in a 2/2/1 mix (`docs/QUESTION-FACTORY.md`). See `docs/nba/calendar.md` and `docs/nba/validation.md` for current inventory and `docs/nba/AUDIT-2026-11-16.md` for the original 50-day audit.
- Rights: `docs/NBA_DATA_RIGHTS.md`. Approved sources are Wikipedia (CC BY-SA 4.0) and, for individual facts read by hand one page at a time, Basketball-Reference. Basketball-Reference URLs are still blocked by the validator until a code change lands (see the rights page). Never use bots or agents on Basketball-Reference.

### Published days (one policy for every day)
- `content/published.lock.json` holds each day's scoring fingerprint: question ids, answers, min, max, step and order. Saves, share links and score comparisons depend on exactly these.
- A day on or before today (the real UTC date) is published. `content:check` (and so every build and deploy) fails if its fingerprint changes or its file disappears. `npm run content:publish` never rewrites a published day file at all. `--today` can only move the date later, never unlock a day.
- Future days are regenerated from `data/nba` and their lock entries follow.
- Mixed-sport launch days may still get text-only corrections (a note or source line), as before. NBA days cannot: their files must equal what `data/nba` generates, and published files are never regenerated.

### If the release slips past midnight
The cutover must be a future date when the release reaches production. If the deploy is not live and checked by about 23:00 UTC the day before the cutover, hold it and move the cutover:
1. Copy `content/retired/<old cutover>.json` back to `content/days/` and restore that day's entry in `content/published.lock.json` from `origin/main` (only that entry; the rest of the lock stays).
2. `npm run nba:reschedule -- --cutover <next free UTC date>` (refuses a date that is not in the future; also updates `src/content/cutover.ts`).
3. `npm run content:publish` (writes the moved days, removes the NBA files that no longer belong, updates the lock), then `npm run nba:report`.
4. `npm run content:check && npm test` must pass, and `e2e/cutover.spec.ts` follows the new date by itself.

### Where things live
| Path | What |
|---|---|
| `data/nba/facts.json` | Canonical facts: number, unit, scope, season, source URL and quote, question text, range, difficulty, ratings |
| `data/nba/calendar.json` | Cutover date, every day (theme + 5 fact ids each) and the reserve |
| `data/nba/families.json` | Stat families with the first season each stat was officially recorded |
| `data/nba/sources.json`, `rejected.json`, `franchises.json` | Rights register, rejected examples, franchise names |
| `data/nba/editorial/v52-audit.json` | V5.2 editorial decision for every official slot (`scripts/nba/revise.ts`) |
| `db/migrations/*.sql` | SQLite schema with uniqueness, ladder and era triggers |
| `content/days/*.json` | What the game loads; generated from `data/nba`, never edited by hand |
| `content/published.lock.json` | scoring fingerprint of every day; a published day's may never change |
| `docs/nba/` | Generated proof: `questions.csv`, `calendar.md`, `validation.md` |

### Commands
```bash
npm run content:publish -- --today $(date -u +%F)   # write content/days from data/nba and update the lock
npm run content:check                              # schema, NBA gates, lock; runs inside npm run build
npm run nba:db                                     # build build/nba.sqlite and print counts + dump hash
npm run nba:report                                 # regenerate docs/nba/*
npm test                                           # every gate has a test that must fail on bad data
```

### Adding a day (next: 2027-01-28)
Start with `docs/QUESTION-FACTORY.md`; this is the publishing end of it.
1. Write five facts in `data/nba/facts.json` (or move five ids out of `calendar.reserve`). Each needs a Wikipedia URL you have opened, a quote of 160 characters or fewer that contains the number, scope, season, unit, range, step, difficulty and a one-line difficulty reason.
2. Append a day to `calendar.days` with the next date, a theme (`kind`, `title`, `subtitle`, `recap`) and the five ids in ladder order: easy, medium, hard, hard, expert. The day must use recall, reference and missing-point in a 2/2/1 mix whose sequence differs from the day before and after.
3. Run `npm run content:publish`, then `npm run nba:report`, then `npm test`. The validator tells you if the day breaks a rule (family limits, the rolling 7-day mix, franchise repeats, a stat used before it was recorded, a range that rewards guessing the middle).
4. Record one decision per slot with `scripts/nba/revise.ts` (the coverage test in `scripts/nba/formats.test.ts` needs an audit entry for every official slot).
5. Commit `data/nba`, `content/days`, `content/published.lock.json` and `docs/nba` together and open a PR. CI runs the same gates. Merging to main publishes.

Changing a day on or before today is refused outright; future days follow `data/nba`.

### Gates that fail the build
At least 250 verified facts and 250 scheduled questions; at least 50 consecutive days with 30 or more themed; 5 unique questions per day, never reused; the difficulty ladder; non-empty theme; an approved source with a quote that contains the answer; scope, season (valid years, event date inside the season), units and reveal present; answer strictly inside the range and 8% or more from either end; 5–400 whole steps; no near-duplicate prompts or repeated facts; no stat before its first official season (rebounds 1950–51, steals and blocks 1973–74, turnovers 1977–78, threes 1979–80); at most 2 per family and 1 simple scoring average per day; from `VARIETY_FROM` every day is 2/2/1 across recall, reference and missing-point, uses no retired format, and does not repeat the previous day's format sequence; every rolling 7 days has 6 or more families, 3 or more eras and at most 10 questions on one franchise; no franchise leads two days running; at most 35% of answers in the middle fifth of their range; a centre-the-window player never scores above 90; every published day matches its locked fingerprint; the SQLite build is reproducible.

---

# Before the NBA cutover (kept for history)

Nothing below is current policy. In particular the source rule (3) was replaced by the rights register in `docs/NBA_DATA_RIGHTS.md`.

## What ships at launch
**13 complete daily slates, 65 questions, 2026-11-15 → 2026-11-27.** Every question was checked against a fetched source page on 2026-11-15, and each file carries the URL and the exact sentence that states the number.
After 2026-11-27 there is **no** new puzzle unless more slates are published; the game then says so plainly and offers earlier days as practice. It never invents or recycles a "daily" puzzle.

## The rules for a question
1. **A fixed, historical number.** No live or still-changing stats (active careers, current seasons, "most ever" records still in play).
2. **One unambiguous reading.** Say the competition, season, and whether playoffs count. If two sources disagree, drop the question.
3. **A source that states the number.** Prefer the league, governing body, or an established reference (Basketball-Reference, Wikipedia with citations). Copy the sentence into `source.quote`. If the page states it another way (11 h 5 min), add `source.derivation` with the arithmetic.
4. **A fair scale.** `min` and `max` should be plausible bounds a fan might consider, with the answer not sitting at the centre. Choose `step` so the scale is 40–400 steps (e.g. step 10 for career totals in the thousands).
5. **The note is a fact from the source**, not colour you can't back up.
6. **Mix the day**: different sports, one easier warm-up, at most two from the same league.

## Workflow (about 20 minutes a day, best done a week at a time)
```bash
npm run content:new              # creates content/days/<next date>.json with TODO fields
# fill in five questions; open each source URL and paste the exact sentence
npm run content:check            # schema + cross-day checks; must print "All content valid."
npm test && npm run build
git checkout -b content/<dates> && git commit -am "Content: <dates>" && git push
# open a PR; CI runs the same checks; merge to main and Vercel publishes it
```

`content:check` fails the build (and therefore any deploy) when:
- a field is missing or malformed, the source isn't https, or the answer isn't strictly inside the scale;
- the scale isn't a whole number of steps, or has more than 400;
- the quote doesn't contain the answer (as digits, with commas, or as a word up to twenty) and there is no derivation;
- a question id repeats on another day, or there is a gap or duplicate date.

It **warns** when fewer than 7 days remain from today. CI runs on every PR and push, so the warning shows up early.
A second person checking each new slate against its sources before merge is the editorial standard to aim for.

## A note on secrecy
This is a static site. Each day's slate is a separate file loaded only on that day, but future files are public to anyone who goes looking. That is acceptable for a free daily game and is a known limitation; a server-side release (e.g. an edge function that only returns today's slate) is the fix if cheating ever matters, e.g. for prize competitions.
