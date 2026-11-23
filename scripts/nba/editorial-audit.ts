/** Deterministic NBA future editorial quality audit. No automatic score/rating changes. */
import { loadNbaData, LADDER } from './model.ts';
import { middleNeedsReview } from './editorial-ratings.ts';
const { calendar, facts } = loadNbaData();
const by = new Map(facts.map(f => [f.id, f]));
// Locks advance with the New York puzzle day. Explicit overrides can only tighten it.
const localToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const requestedCutoff = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const cutoff = requestedCutoff && requestedCutoff > localToday ? requestedCutoff : localToday;
const days = calendar.days.filter(d => d.date > cutoff);
const weak: string[] = [];
const weakFinale: string[] = [];
const weakMiddle: string[] = [];
const finaleMonotony: string[] = [];
let previousFinaleFamily = '';
let finaleFamilyRun = 0;
// Inventory only: do NOT invent or inflate ratings, alter facts or automatically fail publication.
const weakMiddle: { date: string; round: number; id: string; ratings: { interest: number; recognizability: number; estimability: number } }[] = [];
const weakMiddleDays = new Set<string>();
const weakMiddleByRound = [0, 0, 0];
const structural: string[] = [];
const provenance: string[] = [];
const sourceHost = 'en.wikipedia.org';
for (const day of days) {
  const fs = day.questions.map(id => by.get(id));
  if (fs.some(f => !f)) { structural.push(day.date + ': unknown fact'); continue; }
  const q = fs as NonNullable<(typeof fs)[number]>[];
  for (const f of q) {
    let host: string | undefined;
    try { host = new URL(f.source.url).hostname; } catch { /* malformed source */ }
    if (host !== sourceHost || !f.source.quote?.trim()) provenance.push(day.date + ': ' + f.id + ': missing or unapproved primary evidence');
    for (const [index, bonus] of (f.question.funFacts ?? []).entries()) {
      let bonusHost: string | undefined;
      try { bonusHost = new URL(bonus.source.url).hostname; } catch { /* malformed source */ }
      if (bonusHost !== sourceHost || !bonus.source.quote?.trim()) provenance.push(day.date + ': ' + f.id + ': bonus ' + index + ' missing or unapproved evidence');
    }
  }
  const r = q[0]!.question.ratings;
  if (r.interest < 4 || r.recognizability < 4 || r.estimability < 3) weak.push(day.date + ': ' + q[0]!.id);
  for (let index = 1; index <= 3; index++) {
    const ratings = q[index]!.question.ratings;
    if (middleNeedsReview(ratings)) {
      weakMiddle.push({ date: day.date, round: index + 1, id: q[index]!.id, ratings: {
        interest: ratings.interest, recognizability: ratings.recognizability, estimability: ratings.estimability,
      } });
      weakMiddleDays.add(day.date);
      weakMiddleByRound[index - 1] = (weakMiddleByRound[index - 1] ?? 0) + 1;
    }
  }
  for (let i = 1; i <= 3; i++) {
    const ratings = q[i]!.question.ratings;
    if (ratings.interest < 3 || ratings.recognizability < 3 || ratings.estimability < 3) {
      weakMiddle.push(day.date + ': Q' + (i + 1) + ' ' + q[i]!.id);
    }
  }
  const finaleFamily = q[4]!.family;
  finaleFamilyRun = finaleFamily === previousFinaleFamily ? finaleFamilyRun + 1 : 1;
  previousFinaleFamily = finaleFamily;
  if (finaleFamilyRun > 3) finaleMonotony.push(day.date + ': ' + finaleFamily + ' (' + finaleFamilyRun + ' consecutive Q5s)');
  const end = q[4]!.question.ratings;
  if (end.interest < 4 || end.recognizability < 4 || end.estimability < 3 || end.surprise < 4) weakFinale.push(day.date + ': ' + q[4]!.id);
  if (q.some((f,i) => f.question.difficulty !== LADDER[i])) structural.push(day.date + ': ladder');
  if (new Set(q.map(f => f.family)).size < 3) structural.push(day.date + ': stat families');
  if (new Set(q.map(f => f.player ?? f.franchise ?? f.family)).size < 3) structural.push(day.date + ': subjects');
  if (q.some((f,i) => i > 0 && f.family === q[i-1]!.family)) structural.push(day.date + ': adjacent duplicate family');
  for (const key of ['franchise','player'] as const) {
    const counts = new Map<string,number>();
    for (const f of q) if (f[key]) counts.set(f[key]!, (counts.get(f[key]!) ?? 0)+1);
    if ([...counts.values()].some(n => n > 2)) structural.push(day.date + ': repeated ' + key);
  }
}
// Cross-day engagement: four identical finale stat families in a row is monotonous,
 // even if each individual expert question is independently strong.
const finaleMonotony: string[] = [];
for (let i = 3; i < days.length; i++) {
  const window = days.slice(i - 3, i + 1);
  const families = window.map(day => by.get(day.questions[4]!)?.family);
  if (families[0] && families.every(family => family === families[0])) {
    finaleMonotony.push(window[0]!.date + '–' + window[3]!.date + ': ' + families[0]);
  }
}
console.log(JSON.stringify({cutoff,days:days.length,weakQ1:weak.length,weakQ5:weakFinale.length,weakMiddleCount:weakMiddle.length,weakMiddleDays:weakMiddleDays.size,weakQ2:weakMiddleByRound[0],weakQ3:weakMiddleByRound[1],weakQ4:weakMiddleByRound[2],weakMiddle,structuralCount:structural.length,finaleMonotonyCount:finaleMonotony.length,weak,weakFinale,structural,finaleMonotony},null,2));
// Q1 is always a publication failure; --strict additionally enforces Q5 and slate structure.
// --report-only is for inventory, never for publication/CI.
if (!process.argv.includes('--report-only') && (weak.length || provenance.length)) process.exitCode=1;
if (process.argv.includes('--strict') && (weak.length || weakFinale.length || structural.length || finaleMonotony.length || provenance.length)) process.exitCode=1;
