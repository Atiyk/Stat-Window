import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Question } from '../content/schema';
import { normalizeWindow } from '../engine/game';
import type { Window } from '../engine/scoring';
import { formatValue, niceTicks, unitFor } from '../lib/format';

type Bound = 'lo' | 'hi';
type Grab = { clientX: number; value: number; unitsPerPixel: number } & ({ kind: Bound } | { kind: 'band'; width: number });
const compactTick = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

export type RulerReveal = {
  /** 0..1 progress of the marker's travel; 1 = landed. */
  readonly progress: number;
  readonly hit: boolean | null;
  /** The end of the scale the flag starts from. */
  readonly from: number;
  readonly zero?: boolean;
  /** The scored distance beyond the closest bracket, excluding timeouts. */
  readonly missBy: number;
};

type Props = {
  question: Pick<Question, 'min' | 'max' | 'step' | 'answer' | 'unit'>;
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
  const latestWindow = useRef(w);
  const [dragging, setDragging] = useState<Grab['kind'] | null>(null);

  const span = q.max - q.min;
  const pct = useCallback((v: number) => ((v - q.min) / span) * 100, [q.min, span]);
  const ticks = useMemo(() => niceTicks(q.min, q.max, 5), [q.min, q.max]);

  useLayoutEffect(() => {
    latestWindow.current = w;
  }, [w]);

  useEffect(() => {
    const active = pointerId.current;
    if (interactive || active === null) return;
    grab.current = null;
    pointerId.current = null;
    setDragging(null);
    const track = trackRef.current;
    if (track?.hasPointerCapture(active)) track.releasePointerCapture(active);
  }, [interactive]);

  const emit = (next: Window, moving?: Bound) => {
    const snapped = normalizeWindow(q, next, moving);
    const prior = latestWindow.current;
    if (snapped.lo === prior.lo && snapped.hi === prior.hi) return;
    latestWindow.current = snapped;
    onChange(snapped, moving);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!interactive || pointerId.current !== null) return; // ignore a second finger
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const track = e.currentTarget.getBoundingClientRect();
    if (track.width === 0) return;
    const unitsPerPixel = span / track.width;
    const pointer = { clientX: e.clientX, unitsPerPixel };
    const v = q.min + (e.clientX - track.left) * unitsPerPixel;
    const nearest = v <= (w.lo + w.hi) / 2 ? 'lo' : 'hi';
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-grab]')?.dataset.grab;
    let g: Grab;
    if (target === 'lo' || target === 'hi') {
      // The generous handle targets can overlap. Pick the closest endpoint
      // even when the other handle is drawn on top of it.
      g = { ...pointer, kind: nearest, value: w[nearest] };
    } else if (target === 'band') {
      g = { ...pointer, kind: 'band', value: w.lo, width: w.hi - w.lo };
    } else {
      // A tap on the open track places the nearest bracket at that spot.
      g = { ...pointer, kind: nearest, value: v };
      emit({ ...w, [nearest]: v }, nearest);
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
    if (!interactive || !g || e.pointerId !== pointerId.current) return;
    // Grab wherever the finger lands without snapping a handle under it.
    const v = g.value + (e.clientX - g.clientX) * g.unitsPerPixel;
    if (g.kind === 'band') {
      const lo = Math.min(q.max - g.width, Math.max(q.min, v));
      emit({ lo, hi: lo + g.width });
    } else {
      emit({ ...latestWindow.current, [g.kind]: v }, g.kind);
    }
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
        onCommit(); // the reducer ignores it while the full scale is selected
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
  const markerValue = reveal ? reveal.from + (q.answer - reveal.from) * reveal.progress : q.answer;
  const state = !landed ? 'open' : reveal?.hit ? 'hit' : 'miss';
  const showGap = landed && reveal.missBy > 0;
  const nearestEdge = q.answer < w.lo ? w.lo : w.hi;
  const lo = pct(w.lo);
  const hi = pct(w.hi);
  const mid = (lo + hi) / 2;

  return (
    <div
      className="ruler"
      data-state={state}
      data-dragging={interactive ? dragging ?? undefined : undefined}
      data-zero={landed && reveal?.zero || undefined}
    >
      <div
        ref={trackRef}
        className="ruler-track"
        data-interactive={interactive || undefined}
        style={interactive ? { '--window-span': hi - lo } as CSSProperties : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => { onPointerMove(e); endDrag(e); }}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <div className="ruler-ticks" aria-hidden="true">
          {ticks.minor.map((t) => (
            <span key={`m${t}`} className="tick" style={{ left: `${pct(t)}%` }} />
          ))}
          {ticks.major.map((t) => (
            <span key={`M${t}`} className="tick tick-major" data-in-window={interactive && t >= w.lo && t <= w.hi || undefined} style={{ left: `${pct(t)}%` }}>
              <span className="tick-label">{Math.abs(t) >= 10_000 ? compactTick.format(t) : formatValue(t, q.step < 1 ? 0.1 : q.step)}</span>
            </span>
          ))}
        </div>

        <div
          className="band"
          data-grab={interactive ? 'band' : undefined}
          style={{ left: `${lo}%`, width: `${hi - lo}%` }}
          aria-hidden="true"
        />

        {showGap && (
          <span className="ruler-gap" aria-hidden="true" style={{
            left: `${pct(Math.min(nearestEdge, q.answer))}%`,
            width: `${(Math.abs(nearestEdge - q.answer) / span) * 100}%`,
          }} />
        )}

        {interactive && dragging === 'band' && (
          <span className="bracket-tag range-tag" aria-hidden="true"
            style={{ left: `${mid}%`, '--bracket-position': mid } as CSSProperties}>
            {formatValue(w.lo, q.step)}–{formatValue(w.hi, q.step)}
          </span>
        )}

        {(['lo', 'hi'] as const).map((which) => {
          const v = which === 'lo' ? w.lo : w.hi;
          const position = pct(v);
          return (
            <div
              key={which}
              className={`bracket bracket-${which}`}
              data-grab={interactive ? which : undefined}
              style={{ left: `${position}%`, '--bracket-position': position } as CSSProperties}
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
            style={{ '--marker-position': pct(markerValue) } as CSSProperties}
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
