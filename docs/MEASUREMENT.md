# Measurement

Nothing here has been validated with real players yet. No retention, completion or share numbers exist until the steps under "Turning it on" are done and traffic arrives.

## What is wired

`src/lib/track.ts` sends a fixed set of events to **Vercel Web Analytics**, which the project's Hobby plan includes at no cost.

- **Why page views:** on Hobby, Vercel's custom events are not available ("Custom Events are available on Enterprise and Pro plans", [Vercel docs](https://vercel.com/docs/analytics/custom-events)). So each event is sent as a *virtual page view* on a path under `/e/…`, using the package's `pageview()` call. The counts appear in the dashboard's **Pages** list, one row per path.
- **Cost:** Hobby includes 50,000 events a month (page views and virtual page views both count). At the limit, collection pauses; "You will not pay for any additional usage" ([Vercel limits and pricing](https://vercel.com/docs/analytics/limits-and-pricing)). Rough budget: about 16 events per complete game (page view, visit, start, first touch, five locks, five Nexts, completion, share), so roughly 3,000 complete games a month before collection pauses.
- **Off by default.** Events are sent only when the build sets `VITE_ANALYTICS=vercel`. Local runs, CI and builds without the variable send nothing (in development they log to the console instead).
- **Privacy:** no cookies or identifiers from us, no answers, no typed text, no scores beyond a 100-point band. Every path segment comes from the fixed list below. Real page-view URLs are stripped of their query string, so challenge links (`?day=…&vs=…`) are not collected. Browsers that send Global Privacy Control or Do Not Track send nothing. The help dialog says what is counted.

### Turning it on (owner, about two minutes)

1. Vercel dashboard → the `stat-window` project → **Analytics** → **Enable** Web Analytics (Hobby, free).
2. Project **Settings → Environment Variables** → add `VITE_ANALYTICS` = `vercel` for **Production** only.
3. Redeploy production (or merge anything to `main`).
4. Check: open the site, play a round, then look for `/e/start/daily` and `/e/lock/daily/r1/…` under Analytics → Pages. If they appear, events are flowing.

Until step 2 is done, production sends nothing, exactly as before this change.

## Event dictionary

`mode` is `daily` (today's official puzzle, or the player's own unfinished daily from yesterday), `practice` (an earlier day from the archive) or `challenge` (any run opened from a friend's same-puzzle link, including today's puzzle opened that way).

| Path | Fired when | Answers |
| --- | --- | --- |
| `/e/visit/new` | first time this browser opens the game (needs working localStorage) | new browsers |
| `/e/visit/return/gap-{1,2-6,7plus}[/day1,/day7]` | first open on a new UTC day by a browser seen before. `gap` = days since its last visit. `/day1` or `/day7` is added when the browser's first visit was exactly 1 or 7 days earlier | next-day and day-7 returns |
| `/e/start/{mode}` | a fresh run opens (no rounds saved yet) | game starts |
| `/e/first-touch/{mode}` | first bracket move of round 1 | did the first screen make sense? |
| `/e/lock/{mode}/r{1-5}/{hit,miss}` | a round is locked | drop-off by round, hit rate per round |
| `/e/next/{mode}/r{1-5}` | Next pressed after round N's reveal | round completion |
| `/e/exit/{mode}/r{n}` | page hidden or closed mid-run (best effort) | where people leave |
| `/e/complete/{mode}/{0-99,…,400-500}` | round 5 locked | completion, score bands |
| `/e/share/{mode}/{native,clipboard,failed,cancelled}` | share button result | share attempts |
| `/e/challenge-open/{today,past,future,invalid}[/with-score]` | page opened with a `?day=` link | challenge links that worked |

### Metrics, and how to read them

| Metric | From | Early hypothesis to test |
| --- | --- | --- |
| First-screen understanding | `first-touch/daily` ÷ `start/daily` | > 90% |
| Q1 → all five | `complete/daily/*` ÷ `lock/daily/r1/*` | > 70% |
| Round drop-off | `lock/…/r{n}` across n | no single round loses > 10% |
| Share attempts | `share/daily/{native,clipboard}` ÷ `complete/daily/*` | > 10% |
| Challenge pull | `start/challenge` and `complete/challenge/*` ÷ shares | any is a signal |
| Next-day return | `visit/return/…/day1` ÷ `visit/new` from the previous day | > 25% |
| Day-7 return | `visit/return/…/day7` ÷ `visit/new` seven days earlier | > 15% |

## What these numbers are not

- **Browsers, not people.** One person on a phone and a laptop is two browsers. Clearing site data makes a returning player look new. Private windows always look new.
- **A share is an attempt, not a delivery.** `native` means the share sheet was opened and the player picked a target; whether they sent it is not observable. `clipboard` means it was copied, not pasted. Pasted links that are never opened are invisible.
- **Challenge opens are link opens, not verified new players.** `/e/challenge-open/*` counts any visit with a `?day=` link, including the sender re-opening their own.
- **Exits are best effort.** Browsers may drop events sent while a page closes.
- **Counts can be blocked or faked.** Ad blockers block Vercel's script; anyone can call the endpoint. Treat everything as directional. Nothing here is a leaderboard or a verified competition.
- With little traffic, report raw counts and ranges. Don't call a difference a win until both arms have enough completed games for the gap to be bigger than the noise.

## Experiments (once real events are flowing; not built yet)

Every player gets the same five questions on a given day, whatever their arm. Only presentation changes.

1. **First-round wording or reveal presentation.** Primary: Q1 → all-five completion. Guardrail: no new accessibility failures, no slower first paint.
2. **Share copy and challenge framing.** Primary: challenge starts per share attempt. Guardrail: the share text never contains an answer (unit-tested).
3. **Next-day teaser** from existing, non-secret metadata (for example the sports on tomorrow's slate, never questions or answers). Primary: next-day return. Guardrail: no countdown pressure, no future answers.

To run one: assign an arm per browser at random, store it in localStorage, add the arm as a path segment (`/e/x/{test}/{arm}/…`), and compare counts. Not built in this sprint because there is no traffic to measure it with yet.

## Monetization hypotheses (do not build until retention is proven)

The daily game stays free, with no ads in the play area and nothing that buys points.
1. **Archive pass:** past puzzles beyond the last 7 days, plus themed packs. Validate with `/e/start/practice` among returning browsers first.
2. **Private leagues:** a code that groups friends' daily scores. Needs a backend and anti-cheat (server-side slates).
3. **Sponsored themed weeks**, editorially separate from scoring.

Before any paid feature on Vercel, check whether the plan's terms allow commercial use; it may require a paid plan, which conflicts with the $0 constraint today.
