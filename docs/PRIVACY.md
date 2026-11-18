# Privacy (source for /privacy.html)

Plain-language notice for players. The served page is `public/privacy.html`; keep the two in step. Last updated 2026-11-18.

## What Stat Window collects

Stat Window has no accounts, no ads, no tracking cookies and no third-party marketing pixels. Your game history (rounds, scores, streaks, settings) is saved **in your own browser** (localStorage) and never uploaded.

Two optional things leave your browser:

| What | Exactly what is sent | Why | Where it goes | How long |
|---|---|---|---|---|
| **Play counts** | A page view, then one virtual page view per game event from a fixed list (for example `/e/lock/daily/r3/hit`, `/e/complete/daily/300-399`). Score is only a 100-point band. No answers, no typed text, no query strings, no identifier from us. Vercel derives coarse country, browser and device type from the request; it says it does not use cookies. | To see whether new players understand the game, where they drop off and whether they come back. | Vercel Web Analytics (Vercel Inc., USA), as our processor. | Shown in our dashboard for 30 days on the Hobby plan; Vercel's own retention per its policy. |
| **Today's score in the daily comparison** | The day, your five windows (the low and high end you locked, used only to re-score your game on the server), and a random 22-character code made in your browser. The server stores **only** your total (0 to 500) under a salted hash of that code, plus a count per score. Your IP address (for IPv6, its network part) is used as a salted hash to limit abuse: a per-minute request count (2 minutes) and a per-day count of stored scores (about a day). It is never stored with your score. | So you can see where today's score sits among other players (your percentile), and so one browser counts once. | Upstash Redis (Upstash Inc., US East region) via Vercel Functions (Vercel Inc., USA), as our processors. | The record linked to your code: 7 days, then it expires. The count per score, with no codes: up to 400 days. |

We do not sell or share this data, build profiles, track you across sites, or fingerprint your device. A browser is not a person: we cannot link your phone and laptop, and we never claim to.

## Your choices

- **Turn either off** any time: the "Privacy and your data" button on the results screen, or "Privacy choices" in How it works. Turning analytics off takes effect immediately.
- **Global Privacy Control / Do Not Track:** if your browser sends either signal, both start **off**. Analytics stays off; the results screen asks before adding your score. You can still switch either on yourself.
- **EU, EEA, UK and Switzerland:** your score is only added after you tap "Count my score" (the server checks the country of the request, which it does not store). If the location is unknown we ask too. Before you answer, the app sends only today's date to ask whether a yes is needed: no code is created and your windows are not sent.
- **Delete my scores:** removes every score your browser sent that is still linked to its code (the last 7 days), then replaces the code. Clearing this site's data in your browser deletes your local history and the code.
- Gameplay never depends on either: if they are blocked, offline or off, the game works the same.

## Children

Stat Window is a general-audience sports game and is not directed at children under 13. It collects no names, emails or contact details from anyone.

## Changes and contact

Material changes are noted on this page with a new date. Questions: open an issue at https://github.com/Atiyk/Stat-Window/issues (do not post personal information there).

## Notes for maintainers (not on the public page)

- Legal basis (EU/UK): consent for score submission in consent countries (asked in-app); legitimate interest for cookieless aggregate analytics, with GPC/DNT and an in-app opt-out honoured. The browser-local code is stored only to provide the comparison the player asked for. This is an engineering reading, **not legal advice**; have it reviewed before any formal launch in the EU/UK.
- Nothing personal appears in logs: the API never logs bodies, keys or IPs.
- If a new field is ever added to the submission, update this page, `docs/PERCENTILES.md` and the Privacy dialog in the same PR.
