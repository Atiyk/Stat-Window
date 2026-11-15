# Stat Window

A daily sports numbers game. Five real, sourced sports facts a day; for each one, drag two brackets to frame a window you're sure the answer sits inside. The tighter the window, the more it scores. Miss, and the round scores zero.

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
- `content/days/YYYY-MM-DD.json`: one file per day, five questions each, with source URL and quote.
- `src/ui/`: the ruler interaction, round, results and help screens. One stylesheet, `src/styles.css`.

## Docs
- [Scoring specification](docs/SCORING.md)
- [Content inventory and publishing workflow](docs/CONTENT.md)
- [Visual identity and design rationale](docs/DESIGN.md)
- [Measurement plan and monetization hypotheses](docs/MEASUREMENT.md)
- [QA evidence and known limitations](docs/QA.md)
- [Skill application ledger](docs/SKILLS.md)

## Deploying
The Vercel project builds `main` with `npm run build` and serves `dist/` (see `vercel.json`). Merging to `main` publishes; pull requests get preview deployments. The build fails if any content is invalid, so bad data can't ship.

## Known limitations
- Progress is stored in this browser only (localStorage). It is not anti-cheat, and it doesn't sync across devices.
- Future slates are public files in a static site. Fine for a free game; move slates behind an edge function before offering prizes.
- 13 days of content ship at launch (through 2026-11-27). After that, the game honestly says there's no new puzzle until more are published.
