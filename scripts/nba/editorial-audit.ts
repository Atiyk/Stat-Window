/** Deterministic NBA future editorial quality audit. No automatic score/rating changes. */
import { eraOf, loadNbaData, LADDER, nbaEditorialIssue } from './model.ts';
const { calendar, facts, sources } = loadNbaData();
const by = new Map(facts.map(f => [f.id, f]));
// Locks advance with the New York puzzle day. Explicit overrides can only tighten it.
const localToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const requestedCutoff = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const cutoff = requestedCutoff && requestedCutoff > localToday ? requestedCutoff : localToday;
const days = calendar.days.filter(d => d.date > cutoff);
const weak: string[] = [];
const weakReveal: string[] = [];
const weakFinale: string[] = [];
const structural: string[] = [];
const provenance: string[] = [];
const sourceHosts = new Set(sources.filter((source) => source.reviewStatus === 'approved').flatMap((source) => source.hosts));
const eras: Record<string, number> = {};
for (const day of days) {
  const fs = day.questions.map(id => by.get(id));
  if (fs.some(f => !f)) { structural.push(day.date + ': unknown fact'); continue; }
  const q = fs as NonNullable<(typeof fs)[number]>[];
  for (const f of q) {
    const era = eraOf(f.season);
    eras[era] = (eras[era] ?? 0) + 1;
    let host: string | undefined;
    try { host = new URL(f.source.url).hostname; } catch { /* malformed source */ }
    if (!host || !sourceHosts.has(host) || !f.source.quote?.trim()) provenance.push(day.date + ': ' + f.id + ': missing or unapproved primary evidence');
    for (const [index, bonus] of (f.question.funFacts ?? []).entries()) {
      let bonusHost: string | undefined;
      try { bonusHost = new URL(bonus.source.url).hostname; } catch { /* malformed source */ }
      if (!bonusHost || !sourceHosts.has(bonusHost) || !bonus.source.quote?.trim()) provenance.push(day.date + ': ' + f.id + ': bonus ' + index + ' missing or unapproved evidence');
    }
  }
  for (const [slot, targets] of [[0, weak], [2, weakReveal], [4, weakFinale]] as const) {
    const fact = q[slot];
    if (fact && nbaEditorialIssue(slot, fact.question.ratings)) targets.push(`${day.date}: ${fact.id}`);
  }
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
console.log(JSON.stringify({
  cutoff, days: days.length, weakQ1: weak.length, weakQ3: weakReveal.length, weakQ5: weakFinale.length,
  structuralCount: structural.length, provenanceCount: provenance.length, eras,
  weak, weakReveal, weakFinale, structural, provenance,
}, null, 2));
// Slot and evidence issues are publication failures; --strict also enforces slate structure here.
// --report-only is for inventory, never for publication/CI.
if (!process.argv.includes('--report-only') &&
    (weak.length || weakReveal.length || weakFinale.length || provenance.length ||
      (process.argv.includes('--strict') && structural.length))) process.exitCode = 1;
