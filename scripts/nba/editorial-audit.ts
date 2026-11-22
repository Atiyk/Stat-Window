/** Deterministic NBA future editorial quality audit. No automatic score/rating changes. */
import { loadNbaData, LADDER } from './model.ts';
const { calendar, facts } = loadNbaData();
const by = new Map(facts.map(f => [f.id, f]));
const cutoff = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? '2026-11-22';
const days = calendar.days.filter(d => d.date > cutoff);
const weak: string[] = [];
const weakFinale: string[] = [];
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
console.log(JSON.stringify({cutoff,days:days.length,weakQ1:weak.length,weakQ5:weakFinale.length,structuralCount:structural.length,weak,weakFinale,structural},null,2));
// Q1 is always a publication failure; --strict additionally enforces Q5 and slate structure.
// --report-only is for inventory, never for publication/CI.
if (!process.argv.includes('--report-only') && (weak.length || provenance.length)) process.exitCode=1;
if (process.argv.includes('--strict') && (weak.length || weakFinale.length || structural.length || provenance.length)) process.exitCode=1;
