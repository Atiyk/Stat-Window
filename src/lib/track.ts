/**
 * Measurement hook. Deliberately a no-op today: no third-party analytics, no
 * cookies, no identifiers. See docs/MEASUREMENT.md for the plan and the free,
 * privacy-respecting sink to plug in here later.
 */
export type TrackEvent =
  | { name: 'daily_start'; number: number }
  | { name: 'round_lock'; number: number; round: number; points: number; hit: boolean }
  | { name: 'daily_complete'; number: number; total: number }
  | { name: 'share'; number: number; method: 'native' | 'clipboard' | 'failed' }
  | { name: 'practice_start'; day: string }
  | { name: 'return_visit'; daysSinceLast: number };

type Sink = (e: TrackEvent) => void;
let sink: Sink = (e) => {
  if (import.meta.env.DEV) console.debug('[track]', e);
};

export function setTrackSink(next: Sink): void {
  sink = next;
}

export function track(e: TrackEvent): void {
  try {
    sink(e);
  } catch {
    /* measurement must never break the game */
  }
}
