import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadNbaData } from './model.ts';
import { buildCatalog, CATALOG_PATH, leakHorizon, serializeCatalog, spentReserves } from './survival.ts';

describe('survival catalog', () => {
  const data = loadNbaData();
  it('the committed catalog is exactly what data/nba builds', () => {
    expect(readFileSync(CATALOG_PATH, 'utf8')).toBe(serializeCatalog(buildCatalog(data)));
  });
  it('a reserve that moves onto a day is caught', () => {
    const prev = buildCatalog(data);
    const moved = structuredClone(data);
    const id = moved.calendar.reserve.shift()!;
    moved.calendar.days[40]!.questions[0] = id;
    expect(spentReserves(prev, moved)).toEqual([id]);
    expect(spentReserves(prev, data)).toEqual([]);
  });
  it('holds a question back until the daily answer its text prints has been played', () => {
    const a = structuredClone(data.facts[0]!);
    const b = structuredClone(data.facts[1]!);
    a.id = 'nba-a';
    b.id = 'nba-b';
    b.season = a.season;
    b.answer = 4321;
    b.question.step = 1;
    a.question.reveal = 'They also won 4321 games that year.';
    const scheduled = new Map([['nba-a', '2026-11-20'], ['nba-b', '2026-12-30']]);
    expect(leakHorizon(a, scheduled, [a, b])).toEqual({ notBefore: '2026-12-31', leaks: ['nba-b'] });
    a.question.reveal = 'Nothing to see.';
    a.claim = 'Nothing.';
    a.source.quote = 'Nothing.';
    expect(leakHorizon(a, scheduled, [a, b]).notBefore).toBe('2026-11-21');
  });
});
