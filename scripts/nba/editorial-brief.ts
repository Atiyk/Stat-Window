/**
 * Read-only working brief for a V5.1 editorial batch: every slot in a date range with
 * its current format, scale and text, plus the support pool a reframe may print
 * (facts already played as a daily before the slot's day, and the reserve).
 *
 *   node --experimental-strip-types scripts/nba/editorial-brief.ts --from 2026-11-30 --to 2026-12-14 [--pool]
 */
import { loadNbaData } from './model.ts';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : undefined; };
const from = arg('--from') ?? '0000-00-00';
const to = arg('--to') ?? '9999-99-99';
const { facts, calendar } = loadNbaData();
const by = new Map(facts.map((f) => [f.id, f]));
const playedOn = new Map(calendar.days.flatMap((d) => d.questions.map((id) => [id, d.date] as const)));

for (const d of calendar.days.filter((x) => x.date >= from && x.date <= to)) {
  console.log(`\n## ${d.date}`);
  d.questions.forEach((id, i) => {
    const f = by.get(id)!;
    const q = f.question;
    console.log(`Q${i + 1} ${q.difficulty} ${id} [${q.format?.kind ?? 'recall'}] family=${f.family} season=${f.season} ${f.player ?? f.franchise ?? ''}`);
    console.log(`   answer=${f.answer} ${f.unit.plural} scale=${q.min}-${q.max} step ${q.step} ratings=${JSON.stringify(q.ratings)}`);
    console.log(`   prompt: ${q.prompt}`);
    console.log(`   context: ${q.context} | reveal: ${q.reveal}`);
    console.log(`   quote: ${f.source.quote}${f.source.derivation ? ` | derivation: ${f.source.derivation}` : ''}`);
  });
}

if (process.argv.includes('--pool')) {
  // A support must be played strictly before the day that prints it, or sit in the reserve.
  console.log(`\n## Support pool for days from ${from} (played before ${from}, or reserve)`);
  const pool = facts.filter((f) => { const p = playedOn.get(f.id); return p === undefined ? calendar.reserve.includes(f.id) : p < from; });
  const byFamily = new Map<string, typeof pool>();
  for (const f of pool) byFamily.set(f.family, [...(byFamily.get(f.family) ?? []), f]);
  for (const [fam, fs] of [...byFamily].sort()) {
    console.log(`\n${fam}:`);
    for (const f of fs) console.log(`  ${f.id} = ${f.answer} ${f.unit.plural} (${f.season ?? 'n/a'}, ${f.player ?? f.franchise ?? ''}) ${playedOn.get(f.id) ? `played ${playedOn.get(f.id)}` : 'reserve'}`);
  }
}
