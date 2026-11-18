import { describe, expect, it } from 'vitest';
import { creditFor, methodSentence } from './Sources';

describe('source credit', () => {
  it('credits any Wikipedia article to its contributors under CC BY-SA, however the day file named it', () => {
    expect(creditFor({ name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Wayne_Gretzky' })).toEqual({ name: 'Wikipedia contributors', licensed: true });
    expect(creditFor({ name: 'Wikipedia contributors (CC BY-SA 4.0)', url: 'https://en.wikipedia.org/wiki/X' })).toEqual({ name: 'Wikipedia contributors', licensed: true });
  });
  it('leaves other sources as written', () => {
    expect(creditFor({ name: 'NBA.com', url: 'https://www.nba.com/stats' })).toEqual({ name: 'NBA.com', licensed: false });
  });
  it('turns a derivation note into one clean sentence', () => {
    expect(methodSentence('152 − 79 = 73')).toBe('Method: 152 − 79 = 73.');
    expect(methodSentence('Converted 0.435 to 43.5%.')).toBe('Method: Converted 0.435 to 43.5%.');
    expect(methodSentence('multiply by 100. ')).toBe('Method: Multiply by 100.');
  });
});
