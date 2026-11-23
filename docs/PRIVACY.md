> **V3 deletion integrity:** A daily percentile deletion first withdraws consent, then requires a valid server deletion confirmation before discarding the old random browser code. Failures retain the code and stop new score submissions. The server stores only a 9-day, HMAC-only revocation marker after a successful DELETE so delayed submissions cannot silently recreate scores. This is separate from deferred public leaderboards. Independent testing and exact-SHA CI are still required.

# Privacy (source for /privacy.html)

Plain-language notice for players. The served page is `public/privacy.html`; keep the two in step. Last updated 2026-11-22.

## What Stat Window collects

Stat Window has no accounts, no ads, no tracking cookies and no third-party marketing pixels. Your game history (rounds, scores, active answer times, streaks, settings) is saved **in your own browser** (localStorage) and never uploaded.

Three optional things leave your browser (the third is disabled until separately reviewed):

| What | Exactly what is sent | Why | Where it goes | How long |
|---|---|---|---|---|
| **Play counts** | A page view, then one virtual page view per game event from a fixed list (for example `/e/lock/daily/r3/hit`, `/e/complete/daily/300-399`). Score is only a 100-point band. No answers, no typed text, no query strings, no identifier from us. Vercel derives coarse country, browser and device type from the request; it says it does not use cookies. | To see whether new players understand the game, where they drop off and whether they come back. | Vercel Web Analytics (Vercel Inc., USA), as our processor. | Shown in our dashboard for 30 days on the Hobby plan; Vercel's own retention per its policy. |
| **Today's score in the daily comparison** | The day, your five windows (the low and high end you locked, used only to re-score your game on the server), and a random 22-character code made in your browser. The server stores **only** your total (0 to 500) under a salted hash of that code, plus a count per score. Your IP address (for IPv6, its network part) is used as a salted hash to limit abuse: a per-minute request count (2 minutes) and a per-day count of stored scores (about a day). It is never stored with your score. | So you can see where today's score sits among other players (your percentile), and so one browser counts once. | Upstash Redis (Upstash Inc., US East region) via Vercel Functions (Vercel Inc., USA), as our processors. | The record linked to your code: 7 days, then it expires. The count per score, with no codes: up to 400 days. |

**Global rankings (not enabled yet):** Joining is a separate explicit choice from the daily comparison. The browser sends the five locked windows and a random browser code; the server re-scores the official slate, stores only an HMAC of the code and score in a public pseudonymous ranking, and retains linked scores until 30 days after the end of each relevant day, week, month or 120-day season period. Each 120-day block of linked daily records expires after its last potentially retained board expires; continued play does not extend older blocks. Day, week, month and season rankings are public; a generated nickname identifies your entry. You can leave and request deletion of all still-retained linked leaderboard entries from the results screen. **Choose Leave before clearing site data:** clearing your browser code first removes your ability to request erasure of its linked entries; the scores remain public until their stated expiry; if deletion fails or is rate-limited, new submissions stop in this browser immediately but the random code is retained only for deletion retry; those entries may remain public, and the app must not claim success. Until erasure is confirmed, the results screen offers a retry even after a reload; do not clear site data before a successful deletion. A successful erasure temporarily retains a nonpublic HMAC-only browser-code revocation marker for at most 48 hours to block delayed score submissions from restoring deleted entries. No score or browser code is stored in the marker. While the service is disabled no global scores are collected. A failed deletion must be retried. The current beta implementation is not yet approved for live collection; see docs/LEADERBOARDS.md.\n\nWe do not sell or share this data, build profiles, track you across sites, or fingerprint your device. A browser is not a person: we cannot link your phone and laptop, and we never claim to.

## Your choices

- **Turn either off** any time: the "Privacy and your data" button on the results screen, or "Privacy choices" in How it works. Turning analytics off takes effect immediately.
- **Global Privacy Control / Do Not Track:** if your browser sends either signal, both start **off**. Analytics stays off; the results screen asks before adding your score. You can still switch either on yourself.
- **EU, EEA, UK and Switzerland:** your score is only added after you tap "Count my score" (the server checks the country of the request, which it does not store). If the location is unknown we ask too. Before you answer, the app sends only today's date to ask whether a yes is needed: no code is created and your windows are not sent.
- **Daily calendar reminder:** the results screen offers a repeating event for your own calendar, at the same New York (US Eastern) hour each day, like the puzzle, which opens at midnight New York time. The `.ics` file is static and the same for everyone who picks that hour; fetching it is an ordinary request to our host (Vercel), like loading the page. The Google Calendar link opens Google with fixed text, that hour and the New York time zone (never yours), and Google's own policy applies there. The app doesn't store whether you added a reminder. Opening the game from the event adds one dated entry to the app's existing list of counts already sent today, so it is counted once a day. We only count taps on the links and opens from the event, and only if play counts are on. Delete the event in your calendar to stop.
- **Delete my scores:** removes every score your browser sent that is still linked to its code (the last 7 days), then replaces the code and turns the daily comparison off, so the same days aren't sent again. You can tick it back on. Clearing this site's data in your browser deletes your local history and the code.
- Gameplay never depends on either: if they are blocked, offline or off, the game works the same.

## Children

Stat Window is a general-audience sports game and is not directed at children under 13. It collects no names, emails or contact details from anyone.

## Changes and contact

Material changes are noted on this page with a new date. Questions: open an issue at https://github.com/Atiyk/Stat-Window/issues (do not post personal information there).

## Notes for maintainers (not on the public page)

- Legal basis (EU/UK): consent for score submission in consent countries (asked in-app); legitimate interest for cookieless aggregate analytics, with GPC/DNT and an in-app opt-out honoured. The browser-local code is stored only to provide the comparison the player asked for. This is an engineering reading, **not legal advice**; have it reviewed before any formal launch in the EU/UK.
- Nothing personal appears in logs: the API never logs bodies, keys or IPs.
- If a new field is ever added to the submission, update this page, `docs/PERCENTILES.md` and the Privacy dialog in the same PR.

The daily shot clock saves its starting timestamp in this tab's session storage and, for the unfinished official daily question only, also in this browser's local storage so another tab cannot grant a fresh 24 seconds. This timestamp stays on the device and is never transmitted. It is deleted on lock/timeout or when the player clears the site's browser data; an abandoned round's timestamp can remain until that data is cleared. This is not an anti-cheat mechanism across devices or private windows.
