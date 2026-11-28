# V5.7 growth report (import-based)

No new event, identifier, analytics service or paid API. This companion to analytics-readout.ts focuses on an actionable one-minute report; PR #8 owns experiment interval hardening separately.

1. From Vercel Analytics > Pages, select one complete Eastern-aligned day or a 1–7 day reporting window. Check the provider timezone and reporting lag. Copy counts into a UTF-8 CSV with header path,count, one row per distinct path. Include / and fixed /e/… virtual paths; normalize provider exports to this format. Unknown/missing paths are not assumed zero. Do not include raw URLs or individual data.
2. Run `node scripts/growth-report.mjs pages.csv --period daily --from 2026-11-28 --to 2026-11-28`. For weekly use --period weekly and the actual first/last dates (opening partial week is allowed).
3. Optionally add --previous prior.csv only for an immediately preceding, same-duration, comparable official window; the script cannot verify the prior export's provenance. Add --usage N using the current team-month usage displayed by Vercel, not the report's event sums.
4. Use the existing analytics-readout.ts for detailed diagnostics. Save reports privately; no delivery or scheduling is configured. The report has no network access. Automated dashboard export access has not been established.

D1/D7 are event counts, not retention estimates, until day-aligned acquisition denominators are available. No ratio is represented as individual conversion. Missing rows, small denominators and aggregate numerator > denominator suppress misleading conclusions. The actual provider reporting timezone and data completeness must be checked by the owner.

## Illustrative output (not live data)

```
# Stat Window daily growth report: 2026-11-28 to 2026-11-28
Official s1 events only; root page views include beta and QA. Missing rows are not assumed to be zero.

Game-root page views (not unique visits): 80
New browsers: not supplied / no matching row | returning browser-day events: 2
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

The 50,000 team-month allowance is the value documented in the current repository; recheck the provider's current usage and terms before relying on it. This change adds zero event volume. No production receipt was tested in this staging pass.
