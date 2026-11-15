# Daily content: inventory and publishing workflow

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
