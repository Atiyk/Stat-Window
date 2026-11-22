import { useEffect, useRef, useState } from 'react';
import type { Question } from '../content/schema';
import type { Window } from '../engine/scoring';
import { formatValue, unitFor } from '../lib/format';

type Props = {
  question: Pick<Question, 'min' | 'max' | 'step' | 'unit'>;
  window: Window;
  editable: boolean;
  onFirstTouch?: (() => void) | undefined;
  onChange: (w: Window, moving: 'lo' | 'hi') => void;
};

/** The two ends of the window, set huge. Tap either number to type an exact value. */
export function Readout({ question: q, window: w, editable, onChange, onFirstTouch }: Props) {
  const [editing, setEditing] = useState<'lo' | 'hi' | null>(null);
  return (
    <div className="readout">
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const label = which === 'lo' ? 'Low end' : 'High end';

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const n = Number(draft.replace(/[,\s]/g, ''));
    if (draft.trim() !== '' && Number.isFinite(n)) onCommit(n);
    setEditing(null);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="bound bound-input"
        aria-label={`${label}, between ${formatValue(q.min, q.step)} and ${formatValue(q.max, q.step)}`}
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(null);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="bound"
      disabled={!editable}
      aria-label={`${label}: ${formatValue(value, q.step)}. Type an exact number`}
      onClick={() => {
        onFirstTouch?.();
        setDraft(String(value));
        setEditing(which);
      }}
    >
      {formatValue(value, q.step)}
    </button>
  );
}
