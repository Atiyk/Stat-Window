import { useCallback, useEffect, useRef, useState } from 'react';
import type { Question } from '../content/schema';
import type { Window } from '../engine/scoring';
import { formatValue, unitFor } from '../lib/format';

type Props = {
  question: Pick<Question, 'min' | 'max' | 'step' | 'unit'>;
  window: Window;
  editable: boolean;
  /** After the reveal the answer leads; the window steps down and says whose it is. */
  caption?: string | undefined;
  onFirstTouch?: (() => void) | undefined;
  onChange: (w: Window, moving: 'lo' | 'hi') => void;
};

/**
 * A typed bracket value, or null when it isn't a number. Spaces and thousands commas
 * are ignored; on a decimal scale a lone comma is read as the decimal mark ("27,4"),
 * since a phone's keypad may offer only that.
 */
export function parseTyped(text: string, step: number): number | null {
  let t = text.trim().replace(/\s/g, '');
  if (step < 1 && !t.includes('.') && /^-?\d*,\d+$/.test(t)) t = t.replace(',', '.');
  t = t.replace(/,/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The phone keyboard for a scale: digits only unless it needs a decimal mark or a minus sign. */
export function keyboardFor(q: Pick<Question, 'step' | 'min'>): 'numeric' | 'decimal' | 'text' {
  return q.min < 0 ? 'text' : q.step < 1 ? 'decimal' : 'numeric';
}

/** The two ends of the window, set huge. Tap either number to type an exact value. */
export function Readout({ question: q, window: w, editable, caption, onChange, onFirstTouch }: Props) {
  const [editing, setEditing] = useState<'lo' | 'hi' | null>(null);
  useEffect(() => {
    if (!editable) setEditing(null);
  }, [editable]);

  return (
    <div className="readout" data-caption={caption ? true : undefined}>
      {caption && <span className="readout-caption">{caption}</span>}
      <Bound which="lo" q={q} value={w.lo} editable={editable} editing={editing === 'lo'} setEditing={setEditing} onFirstTouch={onFirstTouch}
        onCommit={(v) => onChange({ lo: v, hi: w.hi }, 'lo')} />
      <span className="readout-to" aria-hidden="true">to</span>
      <Bound which="hi" q={q} value={w.hi} editable={editable} editing={editing === 'hi'} setEditing={setEditing} onFirstTouch={onFirstTouch}
        onCommit={(v) => onChange({ lo: w.lo, hi: v }, 'hi')} />
      <span className="readout-unit">{unitFor(w.hi, q.unit)}</span>
    </div>
  );
}

function Bound(props: {
  which: 'lo' | 'hi';
  q: Pick<Question, 'min' | 'max' | 'step' | 'unit'>;
  value: number;
  editable: boolean;
  editing: boolean;
  setEditing: (w: 'lo' | 'hi' | null) => void;
  onFirstTouch?: (() => void) | undefined;
  onCommit: (v: number) => void;
}) {
  const { which, q, value, editable, editing, setEditing, onCommit, onFirstTouch } = props;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [draft, setDraft] = useState('');
  const label = which === 'lo' ? 'Low end' : 'High end';
  const formatted = formatValue(value, q.step);
  const focusInput = useCallback((input: HTMLInputElement | null) => {
    input?.focus({ preventScroll: true });
    input?.select();
  }, []);

  useEffect(() => {
    if (editing || !restoreFocus.current) return;
    restoreFocus.current = false;
    buttonRef.current?.focus({ preventScroll: true });
  }, [editing]);

  useEffect(() => {
    if (editing) setDraft(String(value));
  }, [editing, value]);

  const commit = () => {
    const n = parseTyped(draft, q.step);
    if (editable && n !== null) onCommit(n);
    setEditing(null);
  };

  if (editing && editable) {
    const minimum = formatValue(q.min, q.step);
    const maximum = formatValue(q.max, q.step);
    return (
      <input
        ref={focusInput}
        className="bound bound-input"
        data-bound={which}
        data-wide-value={Math.max(minimum.length, maximum.length) >= 6 || undefined}
        aria-label={`${label}, between ${minimum} and ${maximum}`}
        inputMode={keyboardFor(q)}
        enterKeyHint="done"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== 'Escape') return;
          e.preventDefault();
          restoreFocus.current = true;
          if (e.key === 'Enter') commit();
          else setEditing(null);
        }}
      />
    );
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      className="bound"
      data-bound={which}
      data-wide-value={formatted.length >= 6 || undefined}
      disabled={!editable}
      aria-label={editable ? `${label}: ${formatted}. Type an exact number` : `${label}: ${formatted}`}
      onClick={() => {
        onFirstTouch?.();
        setDraft(String(value));
        setEditing(which);
      }}
    >
      {formatted}
    </button>
  );
}
