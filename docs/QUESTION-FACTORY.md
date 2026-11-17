# Stat Window Question Factory (all sports)

This is the **canonical workflow** for every future request to add questions, regardless of sport. Designed for GPT/Codex and other coding agents. See root `AGENTS.md`.

**Current live state:** existing NBA-only days remain controlled by `data/nba`, `scripts/nba`, and `content/published.lock.json`. This factory is the *upstream research/editorial layer*. It intentionally does **not** overwrite `content/days`, add calendar days, mutate existing NBA facts, change Survival eligibility or deploy. An approved proposal must be integrated through the relevant publisher in a separately reviewed content PR. Do not confuse a proposal with live content.

## First-time and every-batch commands

```sh
npm run factory -- init --sport NBA --topic "1996 Bulls and 2016 Warriors"
# edit data/question-factory/batches/nba-1996-bulls-and-2016-warriors.json
npm run factory -- generate --batch nba-1996-bulls-and-2016-warriors
# edit data/question-factory/candidates/nba-1996-bulls-and-2016-warriors.json
npm run factory -- check --batch nba-1996-bulls-and-2016-warriors
npm run factory -- plan --batch nba-1996-bulls-and-2016-warriors --start 2027-01-06 --days 2
# Review data/question-factory/proposals/<batch>.json; no live content was published.
```

The same commands work for `--sport NFL`, `--sport MLB`, `--sport NHL`, `--sport SOCCER`, or any other sport. Add a **reviewed policy file** under `data/question-factory/policies/<sport>.json` for each new sport: approved hosts must reflect independently established license/terms permissions. `init` creates a **blank, explicitly unapproved** policy for new sports. The NBA policy permits only `en.wikipedia.org`, consistent with `docs/NBA_DATA_RIGHTS.md`; do not use a Basketball-Reference/NBA.com scraper or blindly trust scraped GitHub/Kaggle mirrors. Research facts are not permission to bulk copy an upstream dataset.

`npm run factory -- check` checks all committed candidate batches. `npm run factory:check` is the CI-friendly equivalent. **Neither command approves drafts.**

## Working data contract

1. **Research batch**: `data/question-factory/batches/<slug>.json`. Fields: `version:1`, `id`, `sport`, `topic`, `author`, `themes` and `facts`. Create themed research groups around a team-season, player run, matchup, era or remarkable event; research broadly once, reuse sources efficiently, and spread related days apart.
2. **Themes**: `{id,title,subtitle,recap}`. A theme's recap is displayed **after** the game. Avoid spoilers in titles/subtitles. Question facts refer to `theme: id`.
3. **Research fact**: `{id, theme,kind,subject,event,statistic,values,operation,context,note,unit,scale,difficulty,difficultyReason,ratings}`. Every input value needs its own `source` with `url`, `quote`, `license`, `verifiedBy`, `verifiedOn`. The quote must literally state the input number. `operation` is `literal`, `difference` or `sum`; derived arithmetic is done by code, not guessed by an LLM. Two operands currently must be supported by the **same source URL**, because the live game displays only one citation. Use `customPrompt` when the default template isn't excellent.
4. **Generated candidate**: `data/question-factory/candidates/<slug>.json`. `generate` creates suggestions with `review.status:"draft"`. It never invents source numbers, auto-verifies a link, or grants legal approval. Candidates can be edited directly. Run `generate` only once; it refuses to overwrite your edited review work.
5. **Independent editorial sign-off**: for each candidate change `review.status` to `approved` only *after* checking the cited page, verifying the full statistical scope, ensuring permitted data use, independently reviewing curiosity/estimability/reveal, and completing `review.factChecker`, `editor`, `rightsReviewer`, `reviewedOn`. Fact-checker and editor must be different named reviewers. Identity fields are documented attestations, not automatically verified by software.
6. **Staging proposal**: `data/question-factory/proposals/<slug>.json` uses the game's playable `Slate` shape for each proposed date. Only approved questions pass. `plan` refuses to overlap any already committed daily puzzle, doesn't repeat a candidate, and doesn't touch a live or future calendar. Proposals must be integrated intentionally with `content:publish` / the sport-specific publisher and the published lock by an engineer or reviewer; the existing NBA validator continues to control NBA dates.

### Example of one *synthetic* research fact (illustration, not a real score)

```json
{
  "id": "test-example-finale",
  "theme": "historic-final",
  "kind": "famous-moment",
  "subject": "Fictional Club",
  "event": "the fictional 2000 championship game",
  "statistic": "points",
  "operation": "literal",
  "values": [
    { "value": 79, "source": {
      "url": "https://example.org/fictional",
      "quote": "Fictional Club recorded 79 points",
      "license": "synthetic-fixture",
      "attribution": "Synthetic test data author",
      "verifiedBy": "reviewer-a",
      "verifiedOn": "2026-11-16"
    }}
  ],
  "context": "fictional example, not a game question",
  "note": "This record is synthetic test data.",
  "unit": {"singular":"point","plural":"points"},
  "scale": {"min":50,"max":150,"step":1},
  "difficulty":"easy",
  "difficultyReason":"Fictional example only; not meant for players.",
  "ratings":{"recognition":5,"estimability":4,"surprise":4,"story":5,"clarity":5}
}
```

For `meaningful-comparison` or `estimable-derived`, add `compareWith` and two sourced values, and set `operation:"difference"`. The calculated answer is `first - second`, NOT an estimate from model memory. For summations, use `sum` and `customPrompt` to explain what is being combined. For `ranking`, specify `rankLabel` (e.g. `"fourth-highest scoring"`) and ensure the ranking population, ties and metric are explicit. **"Who" questions are not playable on the numeric window**, so always ask for the number.

## Editorial standard: appealing questions, not a statistics exam

Borrow **mechanics**, not designs/content: Fermi's reasoning and satisfying numerical reveal, Size It Up's mental reference point, Range Squeeze's meaningful interval risk, Wordle's brief repeatable ritual, and Connections' considered editorial difficulty. Playlin chart placement does not measure retention.

Favor these kinds in this order, adjusted to the actual sport:
- `famous-moment`: an iconic play/game/season players recognize.
- `meaningful-comparison`: two recognizable players, teams or eras; meaningful difference.
- `surprising-record`: delightful, shocking or counterintuitive result.
- `season-story`: a compelling team's regular season and playoff arc.
- `estimable-derived`: calculated, reason-able comparison, not arbitrary arithmetic.
- `streak`: a memorable streak; avoid an answer mechanically given by the wording.
- `team-leader`: a known subject whose number is interesting.
- `ranking` and `ordinary-average`: **low priority**. Only approve with unusually strong storytelling and estimability.

Each candidate gets 1–5 ratings for recognition, estimability, surprise, story, clarity. Automated quality is weighted **22% / 30% / 20% / 18% / 10%** respectively; approval additionally requires **estimability >=3**, **surprise + story >=6**, composite **>=3.4**, and for rankings/averages, story **>=4**. These are editorial heuristics, **not proven retention scores**. The final reviewer can improve weak drafts or reject them; do not fill a quota with uninspiring stats.

A proposed five-question day must contain **Easy → Medium → Hard → Hard → Expert**, >=3 kinds and no more than 2 of any one kind. It needs a coherent, NBA/NFL/etc. appropriate theme, a memorable finale, and reasonable numeric scales. Scale constraints are 5–400 whole steps, answer strictly inside and >=8% away from edges. The same type should not dominate a run of days. Themes are selected deterministically, prioritizing strong editorial scores and rotating away from a repeated previous theme. Review the whole calendar for era/franchise/athlete coverage beyond these machine checks.

## Acceleration without sacrificing quality

- **Batch by research subject**: ask an agent to analyze 6–10 well-chosen teams, seasons, players or tournaments in parallel, returning structured *sourced facts*. Do not open 100 nearly identical web searches.
- **Produce a surplus**: 60–80 candidate questions for a target of 50 approved (10 days), or scale the ratio according to source quality. A candidate target is **not** a quota for published questions.
- **Use deterministic templates** to turn facts into numeric prompts. The model writes human-sounding hooks and reveals afterward; the numbers and comparisons remain deterministic.
- **Separate duties**: researcher supplies value and source; fact checker verifies actual source and scope; editor judges enjoyment, variety and number scale; license reviewer checks permissible reuse; critic samples finished days and can veto.
- **One reviewed content PR** for a substantial batch, not one PR for every day. Always inspect existing `data/nba`, previous candidates, approved proposals and `content/days` before adding facts. No published-answer/scale/ID/order rewrites.
- **No paid services** and no scraping disallowed sources; don't treat accessible pages or software package licences as blanket dataset permissions.

## Quality gates & limitations

`factory:check` fails for approved candidates with missing sign-offs, bad scales, unacceptable questions, unknown source policies, host restrictions, duplicate IDs/prompts, malformed evidence or unsupported derivations; it **allows drafts** because a draft is not a release. `plan` demands enough approved candidates for complete themed days and fails rather than filling with weak items. The existing `content:check`, NBA validator, published lock, unit tests, and browser QA remain authoritative at release.

Important limits: the code cannot establish the truth of an external page, the legality of a dataset, or genuine user appeal. A checked URL is only a URL; signatures are human review records; title and story quality still require real judgment. No source values, questions, verified dates or rights should be fabricated to satisfy a publishing target.

## How to answer future user requests

On a future instruction like **"add 20 NBA days"**, **"create 15 NFL days"**, or **"expand the Survival question pool"**:

1. Read this file and root `AGENTS.md`, inspect current calendar and source policy.
2. Create research batches using `factory init`; gather verifiable numeric claims into JSON, *not* game-ready content; seek interestingness and estimability.
3. Run `factory generate`, use an independent agent or reviewer to verify and mark eligible candidates, run `factory check`.
4. Run `factory plan` for however many verified themed slates are possible, spread similar subjects apart, and review them.
5. Integrate the approved proposals through the existing sport-specific release pipeline, not by bypassing the locks. If it is another sport, add its vetted publisher/adapter first instead of weakening the NBA-only checker.
6. Test content, sources, scoring, mobile gameplay and share links; merge one substantive PR only when reviewed and passing CI. Distinguish actual published days from proposals in the report.
