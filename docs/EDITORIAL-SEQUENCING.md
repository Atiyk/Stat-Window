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

## V3 mixed-slate publication — 2026-11-22

This change remixes **only the 66 not-yet-published NBA slates** (2026-11-23 onward) from already sourced, reviewed numeric facts. Every question retains its original ID, answer, scoring scale, source excerpt, reveal and difficulty; no new sourced claims are invented. Each day uses five different storylines/teams rather than five splits of a single club. The canonical `data/nba/calendar.json` and generated `content/days/*.json` plus future entries of `content/published.lock.json` must stay byte-consistent.

**Editorial caveat:** 66 opening slots but only 42 existing eligible easy questions currently meet the combined interest >=4, recognizability >=4, estimability >=3 bar. We front-load those 42 into the first 42 future days. The final 24 days retain the less compelling sourced easy candidates pending new independent fact research and verification. No weaker easy is reclassified merely to pass a numerical gate. All future slates are labelled as mixed; the previous single-team theme title and recap no longer represent the content.

**Remaining human gate:** an independent basketball editor must review each remixed five-question arc, especially Q5, and confirm that the daily variety feels fun rather than mechanically shuffled. The scripts and automated checks alone cannot establish enjoyment. Run full `content:publish:check`, `content:check`, `nba:report:check`, `survival:catalog:check`, `factory:check` and complete CI before merging. This worker cannot claim those checks ran locally.

## Editorial re-sequencing follow-up — 2026-11-22

This worker swapped **13** previously source-documented, already high-rated medium Q2 questions into weaker future Q1 slots, and moved each displaced weaker opener to the vacated Q2 slot. Original numerical answers, source URLs, source excerpts, fun facts and ratings were **not altered**. Only difficulty labels and editorial reasons were changed for the swapped facts. 22 future daily slates and their future-only scoring locks were regenerated deterministically from the canonical NBA data shape. No published day on or before 2026-11-22 was changed.

This is **partial remediation, not editorial PASS**: 11 future Q1 remain below the engagement threshold. The moved specialist Q2 questions and all Q5 finales still need independent basketball-fan review; source excerpts are inherited from the existing corpus and were not independently re-opened in this run. The existing Q1 validator still warns on post-January-3 dates. Run `node --experimental-strip-types scripts/nba/editorial-audit.ts --strict` to inspect remaining failures; it intentionally fails while there are blockers. Run the canonical publisher and full content/source/CI gates before integrating. No rating was inflated to meet the threshold.

Swap record (date, new opener, old opener moved to source date Q2):
- 2027-01-14: nba-hawks15-january-wins ⇄ 2026-11-27: nba-warriors75-season-wins
- 2027-01-23: nba-paul08-regular-apg ⇄ 2027-01-03: nba-booker17-70
- 2027-01-09: nba-nash05-regular-apg ⇄ 2027-01-04: nba-rockets18-wins
- 2027-01-16: nba-miller95-8-points ⇄ 2027-01-08: nba-celtics84-wins
- 2027-01-04: nba-kawhi19-playoffs-ppg ⇄ 2026-12-01: nba-miller92-57
- 2027-01-10: nba-giannis21-playoffs-ppg ⇄ 2026-12-11: nba-bucks71-wins
- 2027-01-12: nba-cavs09-home-wins ⇄ 2026-11-26: nba-shot-clock-24
- 2027-01-15: nba-iverson01-season-ppg ⇄ 2026-12-18: nba-pistons89-wins
- 2027-01-05: nba-jordan86-63 ⇄ 2027-01-10: nba-allstar10-attendance
- 2027-01-06: nba-spurs14-march-wins ⇄ 2027-01-12: nba-howard09-g4-blocks
- 2027-01-07: nba-rose11-season-ppg ⇄ 2026-12-10: nba-jordan93-g4-55
- 2027-01-13: nba-jokic23-finals-average ⇄ 2027-01-05: nba-lakers00-wins
- 2027-01-18: nba-lebron16-finals-ppg ⇄ 2026-12-16: nba-spurs14-streak
