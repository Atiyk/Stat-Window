# NBA daily question selection and sequence — editorial gate

## Goal
Not five increasingly obscure facts. Five satisfying basketball judgments that make someone want to finish, compare and return tomorrow.

A 24-second per-question shot clock means every prompt must be scannable and **estimable**. Memorizing a 1983 micro-record is not the desired skill.

## Before locking any future day
1. **Q1: easy, recognizable, quick win.** A current or widely known player, famous team or iconic game. A newcomer should understand it in <5 seconds and have a plausible range in <15.
2. **Q2: recognizable plus curiosity.** Extend Q1's narrative or introduce a vivid contrast. Use a different stat family.
3. **Q3: surprise/reveal.** A striking number that fans will want to tell friends. This is the mid-game reward, not trivia homework.
4. **Q4: tougher judgment.** Require real basketball knowledge, but the range must allow informed estimation rather than one exact memorized number.
5. **Q5: satisfying finish.** Highest difficulty may be fine, but finish on a *memorable* star, rivalry, record or comeback, not an obscure unguessable split. Make the reveal worth waiting for.

## Editorial rejection tests
- Can't name a recognizable person/team/event in Q1 or Q5? Rework the slate.
- Two adjacent questions feel like the same arithmetic or same player-stat pair? Replace one.
- Can a reasonable fan bound the answer before time expires? If not, rephrase or drop.
- Does an average fan need to know the exact record to have any chance? Reject.
- Is the answer already in the prompt, prior reveal or another day's bonus fact? Reject.
- Are historical windows biased around the same relative scale position? Keep the existing build gate.
- Is a theme title hiding spoilers or editorially unnecessary? Keep it spoiler-free and concise.

## First look at seven upcoming days (audit, NOT a publication change)
- **Nov 22, Russell/Wilt/Baylor:** Q1 eight Celtics titles is a decent hook; Q4 quarter rebounds and Q5 half rebounds feel too similar and too obscure under a shot clock. Replace one with an iconic Wilt/Russell moment through the canonical factory.
- **Nov 23, 72–10 Bulls:** Strong recognizable opener, but two Rodman rebound angles compete. Consider an MJ/Pippen moment near the finish.
- **Nov 24, 2006/2011 Finals:** Strong narrative and finale. Favor this structure.
- **Nov 25, Splash season:** Strong subject familiarity. Keep Curry's record overtime as the finale.
- **Nov 26, Rip City:** Five obscure historical splits is a poor casual-fan day. Highest-priority content rebuild. Keep the story but replace at least two prompts with estimable, resonant NBA questions.
- **Nov 27, Mamba:** Great household-name hook; a full run of Kobe facts risks narrow variety. Candidate for novice testing.
- **Nov 28, Rock bottom:** Themed losing streak narrative is interesting; make the last reveal vivid rather than another dry number.

## Workflow and release safeguards
- Generate replacement candidates via docs/QUESTION-FACTORY.md and its actual source checks.
- Independent source and editorial approval for all replacements.
- Do not re-order or change a published score fingerprint; never invalidate saved results or prior links.
- Future pre-release changes go through the NBA calendar publisher, content locks and full CI, not client-only runtime reshuffling.
- Test the candidate slate with five casual NBA fans and five enthusiast NBA fans; record which question caused stall, frustration, laughter or surprise. A 24-second timer is a content stress test.
- Measure first-round touch, each lock, five-question completion and next-day return. Retention effects are hypotheses until actual cohort data are collected.
