import { useId, useState } from 'react';
import type { Question } from '../content/schema';
import type { PlayerFormat } from '../content/formats';
import { guideFor } from '../content/teaching';
import './teaching.css';

/**
 * A question's context and an optional format tip. The tip opens in place
 * without affecting the clock. The worked example is available after lock-in.
 */
export function FormatCue({ question, context, live, onGuide }: {
  question: Question;
  /** The display category line (contextLabel). */
  context: string;
  /** A question is on screen and the window is still editable. */
  live: boolean;
  onGuide?: ((format: PlayerFormat) => void) | undefined;
}) {
  const guide = guideFor(question.meta?.format);
  const [open, setOpen] = useState(false);
  const panel = useId();

  return (
    <div className="format-cue" data-format={guide.format}>
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
      <div id={panel} className="format-cue__detail" hidden={!open}>
        <p>{guide.tip}</p>
        {!live && onGuide && (
          <button type="button" className="btn-link" onClick={() => onGuide(guide.format)}>Try a worked {guide.label.toLowerCase()} example</button>
        )}
      </div>
    </div>
  );
}
