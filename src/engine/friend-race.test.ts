import { describe, expect, it } from 'vitest';
import { raceHighlight, raceOutcome, raceStanding } from './friend-race';

const friend = [48, 61, 0, 100, 38];

describe('raceStanding: equivalent rounds only', () => {
  it('compares after the same number of completed rounds, never revealing later friend rounds', () => {
    expect(raceStanding([], friend)).toEqual({ completed: 0, you: 0, friend: 0, lead: 0, remaining: 5 });
    expect(raceStanding([70], friend)).toEqual({ completed: 1, you: 70, friend: 48, lead: 22, remaining: 4 });
    expect(raceStanding([70, 20, 10], friend)).toEqual({ completed: 3, you: 100, friend: 109, lead: -9, remaining: 2 });
  });
  it('clamps to five rounds', () => {
    expect(raceStanding([1, 1, 1, 1, 1, 1], friend).completed).toBe(5);
  });
});

describe('raceOutcome', () => {
  it('names the winner by total', () => {
    expect(raceOutcome(250, 247, null, null)).toEqual({ result: 'won', margin: 3, byTime: false });
    expect(raceOutcome(200, 247, 1, 2)).toEqual({ result: 'lost', margin: 47, byTime: false });
  });
  it('breaks a tie on answer time only when both times are valid', () => {
    expect(raceOutcome(247, 247, 50_000, 61_000)).toEqual({ result: 'won', margin: 0, byTime: true });
    expect(raceOutcome(247, 247, 70_000, 61_000)).toEqual({ result: 'lost', margin: 0, byTime: true });
    expect(raceOutcome(247, 247, null, 61_000)).toEqual({ result: 'tie', margin: 0, byTime: false });
    expect(raceOutcome(247, 247, 61_000, 61_000)).toEqual({ result: 'tie', margin: 0, byTime: false });
  });
});

describe('raceHighlight: only true statements', () => {
  it('a lead taken on the final question', () => {
    expect(raceHighlight([40, 50, 20, 60, 80], friend)).toBe('You took the lead on the final question.');
  });
  it('a lead lost on the final question', () => {
    expect(raceHighlight([60, 70, 10, 100, 0], friend)).toBe('Your friend took the lead on the final question.');
  });
  it('wire to wire', () => {
    expect(raceHighlight([90, 90, 90, 100, 90], friend)).toBe('You led after every question.');
    expect(raceHighlight([0, 0, 0, 0, 0], friend)).toBe('Your friend led after every question.');
  });
  it('a comeback from behind', () => {
    // Behind by 48 after Q1 and Q2, ahead from Q3 to the end.
    expect(raceHighlight([0, 61, 60, 100, 30], friend)).toBe('You came back from 48 down.');
    // The same for the friend.
    expect(raceHighlight([90, 60, 0, 0, 0], friend)).toBe('Your friend came back from 42 down.');
  });
  it('says nothing when nothing notable happened', () => {
    expect(raceHighlight([48, 61, 0, 100, 38], friend)).toBeNull();
    expect(raceHighlight([48, 61, 0, 100], friend)).toBeNull(); // unfinished
  });
});
