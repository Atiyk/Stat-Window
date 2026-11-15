import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Question } from '../content/schema';
import type { Window } from '../engine/scoring';
import { formatValue, niceTicks, unitFor } from '../lib/format';
import { feedback } from './feedback';

type Grab = { kind: 'lo' | 'hi' } | { kind: 'band'; offset: number; width: number };

export type RulerReveal = {
  /** 0..1 progress of the marker's travel; 1 = landed. */
  readonly progress: number;
  readonly hit: boolean | null;
};

type Props = {
  question: Question;
  window: Window;
  interactive: boolean;
  reveal: RulerReveal | null;
  onChange: (w: Window, moving?: 'lo' | 'hi') => void;
  onCommit: () => void;
  onFirstTouch: () => void;
};

export function Ruler({ question: q, window: w, interactive, reveal, onChange, onCommit, onFirstTouch }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const grab = useRef<Grab | null>(null);
  const pointerId = useRef<number | null>(null);
  const [dragging, setDragging] = useState<Grab['kind'] | null>(null);

  const span = q.max - q.min;
  const pct = useCallback((v: number) => ((v - q.min) / span) * 100, [q.min, span]);
  const ticks = useMemo(() => niceTicks(q.min, q.max, 5), [q.min, q.max]);

  const valueAt = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return q.min;
    const r = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return q.min + t * span;
  };

  const emit = (next: Window, moving?: 'lo' | 'hi') => {
    if (next.lo !== w.lo || next.hi !== w.hi) feedback.tick();
    onChange(next, moving);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive || pointerId.current !== null) return; // ignore a second finger
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const v = valueAt(e.clientX);
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-grab]')?.dataset.grab;
    let g: Grab;
    if (target === 'lo' || target === 'hi') {
      g = { kind: target };
    } else if (target === 'band') {
      g = { kind: 'band', offset: v - w.lo, width: w.hi - w.lo };
    } else {
      // Tap on open track: the nearer bracket jumps there and keeps following.
      g = { kind: Math.abs(v - w.lo) <= Math.abs(v - w.hi) ? 'lo' : 'hi' };
      emit(g.kind === 'lo' ? { lo: v, hi: w.hi } : { lo: w.lo, hi: v }, g.kind);
    }
    grab.current = g;
    pointerId.current = e.pointerId;
    try {
      trackRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* some synthetic or cancelled pointers can't be captured; dragging still works inside the track */
    }
    setDragging(g.kind);
    onFirstTouch();
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || e.pointerId !== pointerId.current) return;
    const v = valueAt(e.clientX);
    if (g.kind === 'band') {
      const lo = Math.min(q.max - g.width, Math.max(q.min, v - g.offset));
      emit({ lo, hi: lo + g.width });
    } else if (g.kind === 'lo') emit({ lo: v, hi: w.hi }, 'lo');
    else emit({ lo: w.lo, hi: v }, 'hi');
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== pointerId.current) return;
    grab.current = null;
    pointerId.current = null;
    setDragging(null);
  };

  const onKey = (which: 'lo' | 'hi') => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const big = Math.max(q.step, Math.round(span / 10 / q.step) * q.step);
    const cur = which === 'lo' ? w.lo : w.hi;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = cur - (e.shiftKey ? big : q.step);
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = cur + (e.shiftKey ? big : q.step);
        break;
      case 'PageDown':
        next = cur - big;
        break;
      case 'PageUp':
        next = cur + big;
        break;
      case 'Home':
        next = which === 'lo' ? q.min : w.lo;
        break;
      case 'End':
        next = which === 'hi' ? q.max : w.hi;
        break;
      case 'Enter':
        onCommit();
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    onFirstTouch();
    emit(which === 'lo' ? { lo: next, hi: w.hi } : { lo: w.lo, hi: next }, which);
  };

  const unit = (v: number) => `${formatValue(v, q.step)} ${unitFor(v, q.unit)}`;
  const landed = reveal !== null && reveal.progress >= 1;
  const markerValue = reveal ? q.min + (q.answer - q.min) * reveal.progress : q.answer;
  const state = !landed ? 'open' : reveal?.hit ? 'hit' : 'miss';

  return (
    <div className="ruler" data-state={state} data-dragging={dragging ?? undefined}>
      <div
        ref={trackRef}
        className="ruler-track"
        data-interactive={interactive || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div className="ruler-ticks" aria-hidden="true">
          {ticks.minor.map((t) => (
            <span key={`m${t}`} className="tick" style={{ left: `${pct(t)}%` }} />
          ))}
          {ticks.major.map((t) => (
            <span key={`M${t}`} className="tick tick-major" style={{ left: `${pct(t)}%` }}>
              <span className="tick-label">{formatValue(t, q.step < 1 ? 0.1 : q.step)}</span>
            </span>
          ))}
        </div>

        <div
          className="band"
          data-grab={interactive ? 'band' : undefined}
          style={{ left: `${pct(w.lo)}%`, width: `${pct(w.hi) - pct(w.lo)}%` }}
          aria-hidden="true"
        />

        {(['lo', 'hi'] as const).map((which) => {
          const v = which === 'lo' ? w.lo : w.hi;
          return (
            <div
              key={which}
              className={`bracket bracket-${which}`}
              data-grab={interactive ? which : undefined}
              style={{ left: `${pct(v)}%` }}
              role="slider"
              tabIndex={interactive ? 0 : -1}
              aria-label={which === 'lo' ? 'Low end of your window' : 'High end of your window'}
              aria-valuemin={which === 'lo' ? q.min : w.lo}
              aria-valuemax={which === 'lo' ? w.hi : q.max}
              aria-valuenow={v}
              aria-valuetext={unit(v)}
              aria-disabled={!interactive || undefined}
              onKeyDown={onKey(which)}
            >
              <span className="bracket-shape" />
              <span className="bracket-grip" />
              <span className="bracket-tag" aria-hidden="true">
                {formatValue(v, q.step)}
              </span>
            </div>
          );
        })}

        {reveal && (
          <div
            className="marker"
            data-landed={landed || undefined}
            style={{ left: `${pct(markerValue)}%` }}
            aria-hidden="true"
          >
            <span className="marker-flag">{formatValue(landed ? q.answer : markerValue, q.step)}</span>
            <span className="marker-pin" />
          </div>
        )}
      </div>
    </div>
  );
}
