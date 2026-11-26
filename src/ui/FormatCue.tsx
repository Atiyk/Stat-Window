import { useEffect, useId, useState } from 'react';
import type { Question } from '../content/schema';
import type { PlayerFormat } from '../content/formats';
import { guideFor } from '../content/teaching';
import { isFirstEncounter, markFormatSeen } from '../lib/format-familiarity';
import './teaching.css';

/**
 * The question's context line, with the format's help one tap away. The first time this
 * browser meets a reference or missing-point question, its one-line instruction sits under the context line; once
 * that round resolves the format counts as met and the line is gone for good. The "?"
 * is always there: it expands a short explanation in place, never an overlay, and has
 * no access to the shot clock, so opening, closing or ignoring it changes nothing about
 * the round's timing. The worked example opens only once no clock is running.
 */
export function FormatCue({ question, context, live, resolved, onGuide }: {
  question: Question;
  /** The display category line (contextLabel). */
  context: string;
  /** A question is on screen and the window is still editable. */
  live: boolean;
  /** The round has resolved: the format counts as met. */
  resolved: boolean;
  onGuide?: ((format: PlayerFormat) => void) | undefined;
}) {
  const guide = guideFor(question.meta?.format);
  const [first] = useState(() => isFirstEncounter(guide.format));
  const [open, setOpen] = useState(false);
  const panel = useId();
  useEffect(() => {
    if (resolved) markFormatSeen(guide.format);
  }, [resolved, guide.format]);

  // Plain recall is the question itself (and what the home and the walkthrough teach), so it
  // never spends a line of the 320px round on an instruction; its "?" is still there.
  const showLine = first && guide.format !== 'recall' && !resolved;

  return (
    <div className="format-cue" data-format={guide.format} data-first={showLine || undefined}>
      <p className="context">
        <span className="context-text">{context}</span>
        <button
          type="button"
          className="format-cue__toggle"
          aria-expanded={open}
          aria-controls={panel}
          aria-label={`About ${guide.label.toLowerCase()} questions`}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">?</span>
        </button>
      </p>
      {showLine && (
        <p className="format-cue__line">
          <span className="sr-only">{guide.label}: </span>
          {guide.instruction}
        </p>
      )}
      <div id={panel} className="format-cue__detail" hidden={!open}>
        <p><strong>{guide.label}.</strong> {!showLine && `${guide.instruction} `}{guide.detail}</p>
        {live ? (
          <p className="format-cue__note">The shot clock keeps running. Worked examples open in How to play after this question.</p>
        ) : onGuide ? (
          <button type="button" className="btn-link" onClick={() => onGuide(guide.format)}>Try a worked {guide.label.toLowerCase()} example</button>
        ) : null}
      </div>
    </div>
  );
}
