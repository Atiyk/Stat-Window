# PMF measurement plan and monetization hypotheses

Nothing here has been validated yet. There are no users at launch, and no retention or willingness-to-pay data exists.

## What is wired today
`src/lib/track.ts` exposes a typed `track()` call that the game already fires at the right moments. Its sink is a **no-op** in production: no cookies, no identifiers, no third-party scripts, no network calls.

| Event | Fired when | Purpose |
| --- | --- | --- |
| `daily_start` | a fresh daily run opens | daily starts |
| `round_lock` | each round is locked (round, points, hit) | drop-off by round, difficulty per question |
| `daily_complete` | round 5 is locked (total) | completion rate, score distribution |
| `share` | share tapped (native / clipboard / failed) | share rate |
| `practice_start` | an earlier day is opened | appetite for the archive (monetization signal) |
| `return_visit` | reserved; derive from day-keyed saves | returning players |

## Step 1 (free): pageviews and referrers
Turn on **Vercel Web Analytics** in the project dashboard. On Hobby it includes 50,000 events a month, collection pauses (no charge) at the limit, and it is cookie-free. Custom events are Pro-only, so on the free plan it answers only "how many visits, from where". That is enough for week one.

## Step 2 (free): the five numbers that matter
Point `setTrackSink` at a free, privacy-respecting collector you control (for example a self-hosted Umami or Plausible community edition, or a tiny endpoint writing aggregate counters). Send no personal data: event name, puzzle number, round, points, and a random per-browser id kept in localStorage purely to count unique returners.

| Metric | Definition | Healthy early target (hypothesis) |
| --- | --- | --- |
| Daily starts | unique browsers firing `daily_start` per puzzle | grows week over week |
| Completion | `daily_complete` / `daily_start` | > 70% (five rounds should take ~3 min) |
| Share rate | `share` / `daily_complete` | > 10% |
| D1 return | browsers active on day N and N+1 | > 25% |
| 7-day retention | of a day's new browsers, share active on day 7 | > 15% |

Client-observed events can be blocked or faked; treat them as directional. A backend-verified count only becomes necessary for prizes or paid features.

## Experiments to run once there is traffic
1. **Scale tuning:** compare score distributions per question; if a question averages < 15 or > 75, its scale is off. Adjust future content, never past slates.
2. **First-run clarity:** share of new players who lock round 1 with the full window untouched (scores 0). If high, the hint isn't landing.
3. **Share card:** text-only today; test adding a generated image card.

## Monetization hypotheses (do not build until retention is proven)
The daily game stays free, with no ads in the play area and nothing that buys points.
1. **Archive pass:** past puzzles beyond the last 7 days, plus themed packs (e.g. "The 90s Bulls", "World Cup history"). Validate by measuring `practice_start` among regulars; a fake-door "unlock all past days" link counting clicks is the cheapest test.
2. **Private leagues:** a code that groups friends' daily scores. Needs a small backend and anti-cheat (server-side slates); price per league or per season.
3. **Sponsored themed weeks** (a league or brand presents a week of questions), editorially separate from scoring.

Before turning on any paid feature on Vercel, check whether the plan's terms allow commercial use; it may require moving from Hobby to a paid plan, which conflicts with the $0 constraint today.
