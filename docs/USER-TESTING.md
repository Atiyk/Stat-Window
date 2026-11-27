# Fan test script (5–10 people, run by the owner)

A short, free, in-person or video-call session with basketball fans you already know. No recruiting, no payment, no recordings unless the person agrees. Five to ten sessions find most of the big usability problems; they do **not** measure how many people would come back. Treat what you learn as reasons to change things, not as statistics.

## Before you start
- Use the person's own phone if possible (iPhone and Android both, if you can find both). Note the browser.
- Daily Five: send the plain link, https://www.statwindow.app/. Nothing else.
- Survival (only once it is on a Preview deployment): send the preview URL with `/?survival`. Never test Survival on production while the flag is off.
- Say only: "This is a small basketball numbers game. Please think out loud. I'm testing the game, not you, and I won't help unless you're completely stuck." Then stop talking.
- Keep two columns on your sheet: **what they did or said** (observed) and **what you think it means** (your guess). Don't mix them.

## Tasks (about 10 minutes)

| # | Task you read out | Watch for (don't prompt) |
|---|---|---|
| 1 | "Here's the link. Go ahead." | Time until the first bracket move. Where they tap first. Do they read the hint? |
| 2 | (let them play round 1) | After the reveal on a miss: face, words. Do they understand why they scored what they did? |
| 3 | "Keep going until it ends." | Total time for five rounds. Any round where they stall for more than ~20 s, and on what. |
| 4 | "If you wanted a friend to try these same five, what would you do?" | Do they find the challenge button unaided? What do they expect the friend to see? |
| 5 | Open their shared link in a **second, fresh browser** (a private window or another phone). | Does the friend's screen show the same puzzle and the sender's score? Any confusion? |
| 6 | Survival only: "There's a longer mode. Try it." | Do they understand the minimum score before locking? Reaction when the lock refuses a loose window? Where the run ends, and do they say "I didn't know that" (knowledge) or "I didn't get it" (UI)? Do they press "Run it again" without being asked? |

## Questions afterwards (2–3 minutes, open-ended)
1. "Would you play this again tomorrow? Why, or why not?"
2. "Which question was the most interesting? Which was the least?"
3. "Was anything confusing or annoying?"
4. Survival only: "Did the run end fairly?"

Don't ask "Did you like it?" or explain the scoring before they've played.

## Scorecard (one row per person)

| Person (initials) | Phone / browser | Time to first move (s) | Round 1 understood without help (y/n) | Finished five (y/n), time (min) | Found challenge (y/n) | Friend link worked in fresh browser (y/n) | Would play tomorrow (yes / maybe / no) + reason | Most / least interesting question | Survival: rounds reached, reason ended (knowledge / UI / unclear), pressed again (y/n) | Biggest problem seen |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

## Hypotheses this tests
- H1: A first-time fan makes a first bracket move within 20 seconds without help.
- H2: A miss still feels worth it because the reveal teaches something ("oh, I didn't know that").
- H3: Five rounds take under four minutes.
- H4: The challenge link is found unaided and works in a fresh browser.
- H5: Survival's minimum is clear before the first lock, and runs end because of knowledge, not the interface.
- H6: At least some testers press "Run it again" on their own.

A hypothesis "holds" only as a direction: e.g. 4 of 5 people did it. If 2 or more people hit the same problem, fix it before launch; one person hitting it is a note.

## What this can't tell you
Whether strangers come back next week, how many share, or how Survival changes daily play. That is what the analytics funnel and the experiment in `docs/SURVIVAL.md` are for, once real traffic arrives.

## Not yet tested by anyone on the team
As of 2026-11-16: no session on a real iPhone (Safari) or Android phone, and nothing with VoiceOver or TalkBack. Automated checks ran in desktop Chrome and an emulated Pixel 7 only. Please note screen-reader or Safari problems if a tester uses them.
