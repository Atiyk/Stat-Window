# NBA data rights register

The machine-readable register is `data/nba/sources.json`. `validateNba` (`scripts/nba/model.ts`) accepts a fact only when its source host belongs to an entry with `reviewStatus: "approved"`. It also has its own hard-coded `BANNED_HOSTS` list, checked first, that still names basketball-reference.com and sports-reference.com (see the open items). This page explains the decisions.

| Source | Status | Why |
|---|---|---|
| Wikipedia (en.wikipedia.org) | Approved | Article text is CC BY-SA 4.0. Individual numbers are facts. We restate each fact in our own words and store at most a 160-character unmodified excerpt as evidence, with a link and the license label. |
| Stat Window editorial | Approved | Prompts, reveals, theme titles, recaps, ranges, ratings and arithmetic are our own writing. |
| Basketball-Reference / Sports Reference | Approved for individual facts, manual access only | Approved by the owner on 2026-11-26, superseding the earlier Wikipedia-only rule. The data use policy says facts "cannot be copyrighted, so you are free to reuse facts found on this site". The same policy asks that nobody build "websites or tools based on data you scrape", and the terms ban "any automated means to access or use the Site" and any database that substitutes for it. So we cite single facts, restated in our own words with a link and credit, and a person reads each page by hand. See "How Basketball-Reference may be used" below. |
| NBA.com / stats.nba.com | Rejected | The terms of use say no Basketball Content "may be reproduced, republished … reused" and that NBA Statistics may not be used with "any fantasy game or other commercial product" or any service "that features a database". |
| GitHub / Kaggle dumps | Rejected | Usually scraped from NBA.com or Basketball-Reference. A CC0 or MIT label on a copy does not grant rights the original owner never gave. |

Exact excerpts and the URLs they were read from (2026-11-16) are in `sources.json` under `policyEvidence`.

## How Wikipedia was used
- About 85 article pages were read one at a time. No dumps, no API bulk export, no table scraping, nothing behind a login or rate limit.
- A fact counts as verified only when the article sentence states the number with the same population, scope and date. Where a number is derived (for example a percentage from two counts), the arithmetic is stored in `source.derivation`.
- **November 23, 2026 editorial polish:** Source evidence, article links, licence labels, and derivations remain in the verified fact database and day records. The game now shows only original Stat Window wording rather than a source disclosure after each answer.
- A separate [editorial credits page](/credits.html) lists the NBA references and earlier mixed-sport archive sources, credits their contributors, and links the CC BY-SA licence without interrupting question → answer → fact → next question.
- The short source extracts stored for editorial checking are not rendered in gameplay. If a future question or fact reproduces protected expression, attribution and licence requirements must be reviewed before publishing; retaining internal evidence alone does not satisfy required public credit.
- Facts about records that could still change carry an `asOf` date, and the validator refuses a "still/current/remains" quote without one.

## How Basketball-Reference may be used
- **Single facts only.** One number for one player, team, game or season, restated in our own prompt and reveal. No tables, no lists copied across, no derived dataset.
- **By hand, one page at a time.** A person opens the page in an ordinary browser and reads the figure. No scripts, bots, scrapers, crawlers, browser automation or AI agents, and that includes an agent's web-fetch tool. No bulk download, no API, no export.
- **Credit and link.** The fact's `source.url` is the exact page, and its credit names Basketball-Reference.com (Sports Reference). A short excerpt of 160 characters or fewer may be stored as evidence, as with Wikipedia.
- **Agents.** An agent can draft a question and name the page a person should check, but it never opens the page itself. Agent-run research stays on Wikipedia.

## Open items
Wikipedia's reuse guideline and the Wikimedia Terms of Use could not be fetched from the build environment on 2026-11-16 (the network policy blocks the Wikimedia policy pages). The register and credits page take a conservative approach to CC BY-SA 4.0, while questions and facts are written independently. A person should read [Reusing Wikipedia content](https://en.wikipedia.org/wiki/Wikipedia:Reusing_Wikipedia_content) once and confirm the attribution format is acceptable.

The Basketball-Reference approval is recorded in `sources.json`, but the code has not caught up. Until a reviewed code change lands, a fact citing a Basketball-Reference URL still fails:
- `BANNED_HOSTS` in `scripts/nba/model.ts`, plus two tests in `scripts/nba/nba.test.ts` that assume it: the gate case "a non-Wikipedia source" and the check that every generated slate cites en.wikipedia.org;
- the factory policy `data/question-factory/policies/nba.json`, whose `approvedHosts` lists only `en.wikipedia.org`;
- `public/credits.html` has no Basketball-Reference section yet; add one with the first fact that cites it.

Every fact in the database today cites Wikipedia.

## Rejected candidates
`data/nba/rejected.json` lists 23 facts that were dropped, with the reason (ambiguous scope, sources disagree, stat not officially recorded in that season, still-changing record, and so on). `docs/nba/validation.md` prints them.
