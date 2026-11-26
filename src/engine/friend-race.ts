/**
 * Friend ghost race. A v2 challenge link carries the sender's five round scores, so
 * the recipient can be compared round by round. Every comparison is between
 * equivalent rounds: after you finish round n you see the friend's first n rounds,
 * never a later one.
 *
 * The scores come from a URL anyone can edit. They are a friendly comparison, not a
 * verified result, and the copy must never claim otherwise.
 */

export const RACE_ROUNDS = 5;

export type RaceStanding = { completed: number; you: number; friend: number; lead: number; remaining: number };

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function raceStanding(you: readonly number[], friend: readonly number[]): RaceStanding {
  const completed = Math.min(you.length, friend.length, RACE_ROUNDS);
  const y = sum(you.slice(0, completed));
  const f = sum(friend.slice(0, completed));
  return { completed, you: y, friend: f, lead: y - f, remaining: RACE_ROUNDS - completed };
}

export type RaceOutcome = { result: 'won' | 'lost' | 'tie'; margin: number; byTime: boolean };

/** Higher total wins. A level total is broken by total answer time only when both times are known. */
export function raceOutcome(youTotal: number, friendTotal: number, youMs: number | null, friendMs: number | null): RaceOutcome {
  if (youTotal !== friendTotal) return { result: youTotal > friendTotal ? 'won' : 'lost', margin: Math.abs(youTotal - friendTotal), byTime: false };
  if (youMs !== null && friendMs !== null && youMs !== friendMs) return { result: youMs < friendMs ? 'won' : 'lost', margin: 0, byTime: true };
  return { result: 'tie', margin: 0, byTime: false };
}

/** Running lead (you minus friend) after each of the five rounds. */
export function raceLeads(you: readonly number[], friend: readonly number[]): number[] {
  const out: number[] = [];
  let lead = 0;
  for (let i = 0; i < RACE_ROUNDS; i++) {
    lead += (you[i] ?? 0) - (friend[i] ?? 0);
    out.push(lead);
  }
  return out;
}

/** One true sentence about how the race went, or null when nothing stands out. */
export function raceHighlight(you: readonly number[], friend: readonly number[]): string | null {
  if (you.length < RACE_ROUNDS || friend.length < RACE_ROUNDS) return null;
  const leads = raceLeads(you, friend);
  const final = leads[RACE_ROUNDS - 1]!;
  const before = leads[RACE_ROUNDS - 2]!;
  if (final > 0 && before <= 0) return 'You took the lead on the final question.';
  if (final < 0 && before >= 0) return 'Your friend took the lead on the final question.';
  if (leads.every((l) => l > 0)) return 'You led after every question.';
  if (leads.every((l) => l < 0)) return 'Your friend led after every question.';
  if (final > 0) {
    const worst = -Math.min(...leads);
    if (worst > 0) return `You came back from ${worst} down.`;
  }
  if (final < 0) {
    const worst = Math.max(...leads);
    if (worst > 0) return `Your friend came back from ${worst} down.`;
  }
  return null;
}
