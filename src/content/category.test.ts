import { describe, expect, it } from 'vitest';
import type { Question } from './schema';
import { contextLabel } from './category';

function stub(id: string, sport: string, context: string): Question {
  return { id, sport, context } as Question;
}

describe('concise question contexts', () => {
  it('uses the verified NBA fact metadata without leaking answers', () => {
    expect(contextLabel(stub('nba-kings02-regular-wins', 'NBA', 'Sacramento · Webber, Peja and Bibby')))
      .toBe('2000s · Sacramento Kings');
    expect(contextLabel(stub('nba-iguodala15-votes', 'NBA', '2015 NBA Finals · MVP voting')))
      .toBe('2010s · NBA Finals');
  });

  it('keeps already-prefixed legacy categories from repeating the sport', () => {
    expect(contextLabel(stub('old-nba', 'NBA', 'NBA · 2015–16 season · 82 games')))
      .toBe('NBA · 2015–16 season · 82 games');
    expect(contextLabel(stub('old-nhl', 'NHL', 'NHL · Edmonton Oilers')))
      .toBe('NHL · Edmonton Oilers');
  });

  it('preserves specific context on the older mixed-sport archives', () => {
    expect(contextLabel(stub('old-olympics', 'Olympic Games', '2000–2016')))
      .toBe('Olympic Games · 2000–2016');
  });
});
