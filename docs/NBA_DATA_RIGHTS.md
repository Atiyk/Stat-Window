# NBA data rights register

The machine-readable register is `data/nba/sources.json`. The validator only accepts a fact whose source host belongs to an **approved** entry, and rejects any host on a **rejected** entry by name. This page explains the decisions.

| Source | Status | Why |
|---|---|---|
| Wikipedia (en.wikipedia.org) | Approved | Article text is CC BY-SA 4.0. Individual numbers are facts. We restate each fact in our own words and store at most a 160-character unmodified excerpt as evidence, with a link and the license label. |
| Stat Window editorial | Approved | Prompts, reveals, theme titles, recaps, ranges, ratings and arithmetic are our own writing. |
| Basketball-Reference / Sports Reference | Rejected | The data use policy says facts can be reused but asks that nobody build "websites or tools based on data you scrape"; the terms ban automated access and databases that substitute for the site. A game built on a fact database is too close to that line, so it is not used at all. |
| NBA.com / stats.nba.com | Rejected | The terms of use say no Basketball Content "may be reproduced, republished … reused" and that NBA Statistics may not be used with "any fantasy game or other commercial product" or any service "that features a database". |
| GitHub / Kaggle dumps | Rejected | Usually scraped from the two sources above. A CC0 or MIT label on a copy does not grant rights the original owner never gave. |

Exact excerpts and the URLs they were read from (2026-11-16) are in `sources.json` under `policyEvidence`.

## How Wikipedia was used
- About 85 article pages were read one at a time. No dumps, no API bulk export, no table scraping, nothing behind a login or rate limit.
- A fact counts as verified only when the article sentence states the number with the same population, scope and date. Where a number is derived (for example a percentage from two counts), the arithmetic is stored in `source.derivation`.
- **November 23, 2026 editorial polish:** Source evidence, article links, licence labels, and derivations remain in the verified fact database and day records. The game now shows only original Stat Window wording rather than a source disclosure after each answer.
- A separate [NBA editorial credits page](/credits.html) lists the reference articles, credits their contributors, and links the CC BY-SA licence without interrupting question → answer → fact → next question.
- The short source extracts stored for editorial checking are not rendered in gameplay. If a future question or fact reproduces protected expression, attribution and licence requirements must be reviewed before publishing; retaining internal evidence alone does not satisfy required public credit.
- Facts about records that could still change carry an `asOf` date, and the validator refuses a "still/current/remains" quote without one.

## Open item
Wikipedia's reuse guideline and the Wikimedia Terms of Use could not be fetched from the build environment on 2026-11-16 (the network policy blocks the Wikimedia policy pages). The register and credits page take a conservative approach to CC BY-SA 4.0, while questions and facts are written independently. A person should read [Reusing Wikipedia content](https://en.wikipedia.org/wiki/Wikipedia:Reusing_Wikipedia_content) once and confirm the attribution format is acceptable.

## Rejected candidates
`data/nba/rejected.json` lists 18 facts that were dropped, with the reason (ambiguous scope, sources disagree, stat not officially recorded in that season, still-changing record, and so on). `docs/nba/validation.md` prints them.
