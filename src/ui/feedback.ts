/**
 * Sound (opt-in, off by default) and haptics, synthesised with Web Audio so
 * there are no audio files to download or license.
 */
let ctx: AudioContext | null = null;
let enabled = false;
let lastTick = 0;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (on && !ctx && typeof AudioContext !== 'undefined') ctx = new AudioContext();
  if (on) void ctx?.resume();
}

function blip(freq: number, duration: number, type: OscillatorType, gain: number, when = 0, glideTo?: number): void {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + duration);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function buzz(ms: number | number[]): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}

export const feedback = {
  tick(): void {
    const now = performance.now();
    if (now - lastTick < 28) return;
    lastTick = now;
    blip(1800, 0.018, 'square', 0.025);
  },
  lock(): void {
    blip(140, 0.12, 'triangle', 0.25, 0, 70);
    blip(900, 0.04, 'square', 0.04);
    buzz(12);
  },
  roll(): void {
    blip(600, 0.02, 'square', 0.02);
  },
  hit(points: number): void {
    const base = 520 + points * 3;
    blip(base, 0.14, 'triangle', 0.18);
    blip(base * 1.5, 0.22, 'triangle', 0.14, 0.09);
    if (points >= 90) blip(base * 2, 0.3, 'sine', 0.12, 0.18);
    buzz(points >= 90 ? [14, 50, 14, 50, 24] : [14, 50, 18]);
  },
  miss(): void {
    blip(180, 0.26, 'sawtooth', 0.08, 0, 110);
    buzz(40);
  },
};
