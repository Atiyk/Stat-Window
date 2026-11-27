# Stat Window Question Factory (all sports)

This is the **canonical workflow** for every future request to add questions, regardless of sport. Designed for GPT/Codex and other coding agents. See root `AGENTS.md`.

**Mandatory engagement review:** use [NBA daily selection and sequencing](EDITORIAL-SEQUENCING.md) to review the five-question arc before an editor approves or publishes a new slate. A sourced answer is not automatically a fun one.

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

The same commands work for `--sport NFL`, `--sport MLB`, `--sport NHL`, `--sport SOCCER`, or any other sport. Add a **reviewed policy file** under `data/question-factory/policies/<sport>.json` for each new sport: approved hosts must reflect independently established license/terms permissions. `init` creates a **blank, explicitly unapproved** policy for new sports. The NBA rights register (`docs/NBA_DATA_RIGHTS.md`) approves Wikipedia and, for single facts a person reads by hand one page at a time, Basketball-Reference. Agents research on Wikipedia only: Basketball-Reference's terms forbid automated access, so no scraper, bot or agent fetch ever touches it. The factory policy `data/question-factory/policies/nba.json` lists `en.wikipedia.org` and the Basketball-Reference / Sports Reference hosts. Never use NBA.com or scraped GitHub/Kaggle mirrors. Research facts are not permission to bulk copy an upstream dataset.

`npm run factory -- check` checks all committed candidate batches. `npm run factory:check` is the CI-friendly equivalent. **Neither command approves drafts.**

## Question formats and the 2/2/1 rule (NBA, taxonomy v2 from V5.2)

Players see three formats (`PLAYER_FORMATS` in `src/content/formats.ts`). The format is the question's single primary task; subjects, eras and stat families never count toward it.

| Format | What the player sees | Fact spec (`question.format`) |
|---|---|---|
| `recall` | A clear numerical question on its own. | Omit `format`. Write `{kind: "recall", derive}` only when the answer is computed (a gap, a share, a sum), or `{kind: "recall", ranking: {population, ties}}` for a rank or count. |
| `reference` | The prompt prints a related verified figure that helps the estimate. | `{kind: "reference", references: [factId, ...]}`; the prompt must print each reference's figure. |
| `missing-point` | A small bar chart of related verified observations with one gap: the answer. | `{kind: "missing-point", chart: {title, unit, points: [{label, fact}]}}` |

`difference`, `ratio`, `ranking` and `trajectory` are **retired** (`RETIRED_FORMATS`). They stay in the storage schema only because published beta days, saved runs and the Survival reserve keep the label they were played with. A former difference or trajectory question keeps its derivation and becomes `recall`, or `reference`/`missing-point` if that is genuinely what the player sees. Never relabel a question with a format it doesn't use.

### The 2/2/1 rule

Every official slate (from `VARIETY_FROM`, 2026-11-30):
1. two questions of one format, two of another, one of the third: all three formats present;
2. no retired format;
3. a format sequence (format per slot) different from the previous and the next official day;
4. the single format rotates across the season. `data/nba/editorial/v52/plan.json` gives each day's target `sequence` and `single`; keep the day's `single` and move slots within the day only if it stays 2/2/1 and differs from its neighbours.

Enforcement:
- `slateFormatIssues` and `sequenceIssues` in `src/content/formats.ts` are the one implementation.
- `validateNba` (`scripts/nba/model.ts`) runs both on the calendar, so `content:check`, `content:publish:check`, the build and CI fail on a bad day or a repeated sequence. `content:check` also runs `slateFormatIssues` on day files, which must carry `meta.format`.
- The factory's `selectSlate` (`scripts/question-factory/core.ts`) only proposes official slates that pass `slateFormatIssues`. A research fact sets `format` to `reference` or `missing-point`; otherwise it counts as `recall`. `plan` does not check sequences across days, so the NBA validator catches those after integration.
- `scripts/nba/formats.test.ts`, block "V5.2 official-season audit": one audit decision per official slot in `data/nba/editorial/v52-audit.json` matching the calendar, every day 2/2/1, no repeated consecutive sequence, and each format the single on at least a quarter of days.
- `scripts/nba/formats.ts` `formatIssues` checks each spec: references printed in the prompt, chart size and labels, same unit and family, bars within the scale and on its step, bars not in value order around the gap, a derivation shown in `source.derivation`.

### Reference quality

A shared unit alone does not make two numbers comparable. A coach's age does not help estimate a young MVP's age; another young MVP's age does. Good anchors are comparable players or styles, similar achievements, the same career stage, comparable playoff performances, related team records, or a familiar benchmark that gives scale. Reject an anchor within about 5% of the answer or one that effectively discloses it, and reject misleading comparisons. If no reference helps, make the question recall and rebalance the day with another slot. The editorial note for every reference question says why the reference materially helps.

### Chart quality

The chart tells a basketball story: a player's scoring evolution, title teams' win totals, historic playoff nights, comparable players in similar roles, an outlier. Several unrelated numbers that share a unit are not a story. Rules:
- 3 to 7 bars (prefer 3 to 5, readable inside 24 seconds), labels of 14 characters or fewer ("Kobe '06"), title of 48 or fewer;
- the same stat family and unit as the question;
- bars ordered by season, chronology or name, never by value around the hidden bar (the validator rejects it);
- every bar at or below the scale max and representable at the question's step;
- the prompt says what the bars are in a few words; the note says what story the chart tells.

### Supports, reveals and the five-question arc

- A reference or chart bar must come from a fact played as a daily on a strictly earlier day, or sitting in the reserve.
- Reveals and fun facts give concise, sourced context (about 140 characters): perspective, history, a comparison, a story. They never restate the question or the answer, and they skip "Benchmark:" lines and empty adjectives. Every fun fact carries its source name, URL and a short verbatim quote.
- Q1 is an accessible opener, Q2 an interesting estimation decision, Q3 a change in presentation or reasoning, Q4 more demanding, Q5 a memorable final shot that stays interesting even when the score is poor. The hidden ladder (easy, medium, hard, hard, expert) and the rating guards below still apply.

### Recording editorial changes

Record one decision per slot (`retained`, `reframed` with a `patch`, or `replaced` with a `newFact`) with `scripts/nba/revise.ts`. Several disjoint batches: `--batch a.json,b.json`; while editors work in parallel, `--check --scope FROM..TO`. `"format": null` in a patch returns a question to plain recall. A reframe never changes the answer. `scripts/nba/editorial-brief.ts` prints a range and its support pool; `scripts/nba/variety-report.ts` prints the day-by-day mix. Independent editorial review of every changed slot is required before release. Earlier audits (`launch-audit.json`, `v51-audit.json`) are frozen records; V5's spec details are in [V5.md](V5.md).

## Working data contract

1. **Research batch**: `data/question-factory/batches/<slug>.json`. Fields: `version:1`, `id`, `sport`, `topic`, `author`, `themes` and `facts`. Create themed research groups around a team-season, player run, matchup, era or remarkable event; research broadly once, reuse sources efficiently, and spread related days apart.
2. **Themes**: `{id,title,subtitle,recap}`. From Phase 1 the theme title and recap are **not shown to players**; they stay in the schema to group research, rotate subjects and review a calendar. Still write them carefully (the publisher and reviews use them). Avoid spoilers in titles/subtitles. Question facts refer to `theme: id`.
3. **Research fact**: `{id, theme,kind,subject,event,statistic,values,operation,context,note,unit,scale,difficulty,difficultyReason,ratings}`. Every input value needs its own `source` with `url`, `quote`, `license`, `attribution`, `verifiedBy`, `verifiedOn`. The quote must literally state the input number. `operation` is `literal`, `difference` or `sum`. The factory calculates derived answers from those numbers. Both operands must currently use the **same source URL**, because the staged game schema exports one primary source. Keep the evidence even though primary gameplay hides citations. Use `customPrompt` when the default template falls short.
4. **Generated candidate**: `data/question-factory/candidates/<slug>.json`. `generate` creates suggestions with `review.status:"draft"`. It never invents source numbers, auto-verifies a link, or grants legal approval. Candidates can be edited directly. Run `generate` only once; it refuses to overwrite your edited review work.
5. **Independent editorial sign-off**: approve a candidate after checking the cited page, verifying the statistical scope, confirming rights and reviewing the question and reveal. Complete `review.factChecker`, `editor`, `rightsReviewer` and `reviewedOn`. For NBA entries, add `review.notes` explaining the clues an NBA fan can estimate from and why the published answer or bonus fact is worth learning. Name a different fact-checker and editor. These fields record reviewers' attestations.
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

NBA research facts also require `coverage`. For example, `{ "family": "rebounds-game", "seasonYear": 1995, "team": "chi", "player": "dennis-rodman" }`. Use the canonical franchise ID and the same player and event slugs across batches. Include all applicable keys. Supply at least one of `team`, `player` or `event`. Use the season's starting year or `null` for facts with no meaningful date, such as rules. Dates determine decade coverage. Research themes can be as narrow as a single game because the planner combines multiple themes into a daily NBA slate.

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

A proposed five-question day must contain **Easy → Medium → Hard → Hard → Expert**, at least three question kinds, and at most two of each kind. Difficulty stays internal. The scale needs 5–400 whole steps and the answer must sit at least 8% away from either edge. The non-NBA planner uses research themes to group slates and rotates themes between days when possible.

NBA slates mix at least three subjects and three stat families across at least two dated decades. The planner caps any team, player, named event or stat family at two per day, with no consecutive questions from the same stat family. Q1 needs recognizable context and an estimable answer. Q2 can take a less obvious angle on a familiar subject. Q3 needs a genuine surprise. Q4 should reward informed judgment. Q5 needs recognition, estimability and a surprising finish. The Q1/Q5 guard uses recognition and story of at least 4 and estimability of at least 3. Q3/Q5 also need surprise of at least 4. An editor reviews the five together, including any accidental spoilers across questions, and verifies that the ratings reflect the actual experience.

## Acceleration without sacrificing quality

- **Batch by research subject**: ask an agent to analyze 6–10 well-chosen teams, seasons, players or tournaments in parallel, returning structured *sourced facts*. Do not open 100 nearly identical web searches.
- **Produce a surplus**: 60–80 candidate questions for a target of 50 approved (10 days), or scale the ratio according to source quality. A candidate target is **not** a quota for published questions.
- **Use deterministic templates** to turn facts into numeric prompts. The model writes human-sounding hooks and reveals afterward; the numbers and comparisons remain deterministic.
- **Separate duties**: researcher supplies value and source; fact checker verifies actual source and scope; editor judges enjoyment, variety and number scale; license reviewer checks permissible reuse; critic samples finished days and can veto.
- **One reviewed content PR** for a substantial batch, not one PR for every day. Always inspect existing `data/nba`, previous candidates, approved proposals and `content/days` before adding facts. No published-answer/scale/ID/order rewrites.
- **No paid services** and no scraping disallowed sources; don't treat accessible pages or software package licences as blanket dataset permissions.

## Quality gates & limitations

`factory:check` validates approved candidates for dated sign-offs, prompt length, scales, source policies and evidence for each number. It also checks draft and approved candidates for duplicate IDs, prompts and facts. The near-duplicate check flags highly overlapping wording with the same answer and sport inside a batch, across research batches, and against the scheduled and archived daily calendar. Distinct years written in both questions distinguish dates. When two questions cover different events, make the scope explicit in the prompt. `plan` requires approved candidates and reports how many eligible slates it found. Run the canonical NBA publisher checks after staging and retain the published lock. The source, era and sequence inventory is available with `node --experimental-strip-types scripts/nba/editorial-audit.ts --strict`.

Important limits: the code cannot establish the truth of an external page, the legality of a dataset, or genuine user appeal. A checked URL is only a URL; signatures are human review records; title and story quality still require real judgment. No source values, questions, verified dates or rights should be fabricated to satisfy a publishing target.

## How to answer future user requests

On a future instruction like **"add 20 NBA days"**, **"create 15 NFL days"**, or **"expand the Survival question pool"**:

1. Read this file and root `AGENTS.md`, inspect current calendar and source policy.
2. Create research batches using `factory init`; gather verifiable numeric claims into JSON, *not* game-ready content; seek interestingness and estimability.
3. Run `factory generate`, use an independent agent or reviewer to verify and mark eligible candidates, run `factory check`.
4. Run `factory plan` for the requested slates and review them in order. Check that adjacent days vary in subject, era and prompt form, and change the research mix if the planner cannot fill the requested dates.
5. Integrate the approved proposals through the existing sport-specific release pipeline, not by bypassing the locks. If it is another sport, add its vetted publisher/adapter first instead of weakening the NBA-only checker.
6. Test content, sources, scoring, mobile gameplay and share links; merge one substantive PR only when reviewed and passing CI. Distinguish actual published days from proposals in the report.
