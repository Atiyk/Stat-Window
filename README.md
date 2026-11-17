# Stat Window

A daily NBA numbers game. Five real, sourced NBA facts a day; for each one, drag two brackets to frame a window you're sure the answer sits inside. The tighter the window, the more it scores. Miss, and the round scores zero.

Free, no sign-up, same puzzle for everyone, new one at midnight UTC.

## Run it
```bash
npm install
npm run dev            # http://localhost:5173
npm test               # unit tests (scoring, dates, state machine, storage, content schema)
npm run test:e2e       # builds, then runs Playwright on desktop and mobile Chrome
npm run build          # content check + typecheck + production build to dist/
```

## How it's built
- Vite + React 19 + strict TypeScript. No backend, no database, no paid services.
- `src/engine/`: the game, independent of React. Pure scoring (`scoring.ts`), UTC day policy (`daily.ts`), an explicit state machine (`game.ts`: ready → adjusting → locked → revealing → resolved → complete), validated browser save (`storage.ts`), stats and share text (`summary.ts`).
- `src/content/`: zod schema for questions, and a lazy loader so only the day being played is downloaded.
- `content/days/YYYY-MM-DD.json`: one file per day, five questions each, with source URL and quote. NBA days are generated from `data/nba` by `npm run content:publish`, never edited by hand.
- `content/published.lock.json`: the scoring fields (ids, answers, scales, order) of every day. `npm run content:check` fails if a published day changes them; `npm run content:lock` records changes to days not yet out.
- Same-puzzle links: `/?day=YYYY-MM-DD&vs=N` opens that day's five for a friend (`src/engine/challenge.ts`).
- `data/nba/`, `db/migrations/`, `scripts/nba/`: the NBA fact database, SQLite schema, validators, publisher and reports (`docs/nba/`).
- `src/ui/`: the ruler interaction, round, results and help screens. One stylesheet, `src/styles.css`.

## Docs
- [Scoring specification](docs/SCORING.md)
- [Content inventory and publishing workflow](docs/CONTENT.md)
- [Visual identity and design rationale](docs/DESIGN.md)
- [Content audit of every question](docs/CONTENT-AUDIT.md)
- [Measurement: events, privacy, how to turn analytics on](docs/MEASUREMENT.md)
- [QA evidence and known limitations](docs/QA.md)
- [Skill application ledger](docs/SKILLS.md)

## Deploying
The Vercel project builds `main` with `npm run build` and serves `dist/` (see `vercel.json`). Merging to `main` publishes; pull requests get preview deployments. The build fails if any content is invalid, so bad data can't ship.

## Known limitations
- Progress is stored in this browser only (localStorage). It is not anti-cheat, and it doesn't sync across devices.
- Future slates are public files in a static site. Fine for a free game; move slates behind an edge function before offering prizes.
- The game launched with mixed-sport days (2026-11-15 and 11-16; they stay playable from the archive and by link). From the NBA cutover in `data/nba/calendar.json` it is NBA-only: 50 themed days built from a checked fact database in `data/nba` (see [docs/CONTENT.md](docs/CONTENT.md) and [docs/NBA_DATA_RIGHTS.md](docs/NBA_DATA_RIGHTS.md)). After the last day the game says there's no new puzzle until more are published.
- Analytics are off until the owner enables Vercel Web Analytics and sets `VITE_ANALYTICS=vercel` (see docs/MEASUREMENT.md).

## Adding questions in any sport

All new content requests use the [Question Factory](docs/QUESTION-FACTORY.md). Start with `npm run factory -- init --sport NBA --topic "2019 Raptors"`, research and source the facts, then `generate`, independent editorial review, `check`, and `plan`. This is **sport-agnostic** (NBA, NFL, MLB, soccer, etc.) but staged only; it never rewrites published puzzles or skips the established publisher. Agents must follow [AGENTS.md](AGENTS.md). No additional paid tools are required.
