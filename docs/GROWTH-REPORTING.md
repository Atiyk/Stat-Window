# V5.7 growth report (import-based)

The report uses the existing Vercel Web Analytics pageview counts. It requires Node.js and no additional service.

1. In the project’s Analytics dashboard, select Production and one complete Eastern-aligned day or a window of up to seven days. Confirm the export’s timezone and allow for reporting lag. In Pages, open the three-dot menu and export as CSV. Normalize it to UTF-8 `path,count` with one row per path, using **pageviews**. Include `/` and the fixed `/e/…` paths. If the export only contains visitors, use the API workflow below. Vercel’s panel export includes up to 250 entries. Missing paths are not assumed zero.
2. Run `node scripts/growth-report.mjs pages.csv --period daily --from 2026-11-28 --to 2026-11-28`. For a weekly report use `--period weekly` and the actual first and last dates. An opening partial week is allowed.
3. For a comparable prior window, add `--previous prior.csv --previous-from YYYY-MM-DD --previous-to YYYY-MM-DD`. The prior window must end the day before the current report and match its length. For CSV, confirm these declared dates against the export. For current team usage, add `--usage N` using the team-month number in Vercel.
4. Use `scripts/analytics-readout.ts` for detailed diagnostics. The statistical safeguards proposed in PR #8 were applied to the current implementation. Impossible funnel counts suppress percentages, and an experiment interval requires enough data with neither arm at a boundary. D1 and D7 show event counts because the exports do not link those counts to an acquisition cohort.

## Optional API import

The connected Vercel Web Analytics API can query read-only production aggregates. Use `visits/aggregate` or the equivalent aggregate pageviews tool, group by `requestPath`, and use the filter `environment eq 'production' and (requestPath eq '/' or startswith(requestPath, '/e/s1/'))` with a limit of 100. Request from the first Eastern midnight through one millisecond before the following Eastern midnight after the last day. In November, for example, the first official day begins at `2026-11-28T05:00:00.000Z` and ends at `2026-11-29T04:59:59.999Z`. The provider returns the upper edge rounded to the hour. The report checks that the returned window matches the declared dates, including across daylight-saving changes.

Save the response as `analytics.json` and pass it in place of `pages.csv`. If the API groups paths under `Others`, use a complete CSV instead. The existing connected aggregate query was verified. The report reads local files and needs no access token. Reports should stay private. No recurring job or delivery is configured.

[Vercel Pages export](https://vercel.com/docs/analytics/using-web-analytics) · [Vercel Web Analytics API](https://vercel.com/docs/analytics/web-analytics-api)

## Illustrative output (not live data)

```
# Stat Window daily growth report: 2026-11-28 to 2026-11-28
Official s1 events only; root page views include beta and QA. Missing rows are not assumed to be zero.

Game-root page views (not unique visits): 80
New browser events: not supplied / no matching row | returning browser-day events: 2
Daily starts: 40 | finishes: 30 | aggregate finish ratio: 75% (aggregate, not joined)
Trend: unavailable (no preceding equal-length export).
share/daily: native 4 | clipboard not supplied / no matching row | native-image not supplied / no matching row | image-saved not supplied / no matching row | cancelled not supplied / no matching row | failed not supplied / no matching row
weekly/share: native not supplied / no matching row | clipboard not supplied / no matching row | native-image not supplied / no matching row | image-saved not supplied / no matching row | cancelled not supplied / no matching row | failed not supplied / no matching row
Challenge: playable arrivals not supplied / no matching row; starts not supplied / no matching row; finishes not supplied / no matching row (not joined recipients).
Referral landing / start / complete: unavailable (aggregate events, not unique players).
Return indicators: D1 2; D7 not supplied / no matching row (event counts only; no day-aligned cohort denominator). Weekly opens: not supplied / no matching row.
Sampled question signals (~10%): unavailable.
Game failures: not supplied / no matching row; comparison failures: not supplied / no matching row. Team monthly analytics usage: unavailable (enter provider usage, not export totals).
Cautions: browser events ≠ people; share outcomes ≠ delivery; same-period counts are not individually linked. Export lag, missing rows, blocked storage and opt-out may bias results.
Next action: Review the most active referral channels and keep the launch baseline stable.
```

## Referral event ceiling sensitivity

Existing measurement guide models 6.3 events per starter. A fully attributed completed game adds at most three referral events on its landing/start/finish. The following is a conservative sensitivity that adds three to the baseline even though some referral cost may already be included; 30 days, all starters attributed and finish, no other projects.

| Daily starters | Baseline views | Maximum extra referral views | Conservative total |
|---:|---:|---:|---:|
|100|18,900|9,000|27,900|
|250|47,250|22,500|69,750|
|500|94,500|45,000|139,500|
|1,000|189,000|90,000|279,000|

Vercel currently lists 50,000 events per Hobby team-month. The report does not generate analytics events. Production API receipt of a beta email referral landing and separate QA gameplay events was verified. The V5.7 referral journey still requires a post-deploy receipt check. [Web Analytics pricing](https://vercel.com/docs/analytics/limits-and-pricing)
