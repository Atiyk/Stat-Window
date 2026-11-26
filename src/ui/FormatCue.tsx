import { useEffect, useId, useState } from 'react';
import type { Question } from '../content/schema';
import type { QuestionFormat } from '../content/formats';
import { guideFor } from '../content/teaching';
import { markFormatSeen, seenFormats } from '../lib/format-familiarity';
import './teaching.css';

/**
 * The format's one-line instruction under every question, with a nonblocking "?"
 * that expands a short explanation in place. It never opens an overlay and has no
 * access to the shot clock: opening, closing or ignoring it changes nothing about
 * the round's timing. A small "New" tag marks the first question of a format this
 * browser hasn't met (not plain recall, which the first-play example teaches); it
 * retires once that round resolves. The worked example opens only when no clock is
 * running (before the lock is impossible to reach from here).
 *
 * It owns the question's context line. Plain recall (taught by the first-play example)
 * and any resolved round need no instruction on screen, so the "?" sits at the end of
 * the context line and the instruction moves into the disclosure: the round keeps the
 * same height it had before the cue existed, which small screens need for the reveal.
 */
export function FormatCue({ question, context, live, resolved, onGuide }: {
  question: Question;
  /** The display category line (contextLabel). */
  context: string;
  /** A question is on screen and the window is still editable. */
  live: boolean;
  /** The round has resolved: the format counts as met. */
  resolved: boolean;
  onGuide?: ((format: QuestionFormat) => void) | undefined;
}) {
  const guide = guideFor(question.meta?.format);
  const [isNew] = useState(() => guide.format !== 'recall' && !seenFormats().has(guide.format));
  const [open, setOpen] = useState(false);
  const panel = useId();
  useEffect(() => {
    if (resolved) markFormatSeen(guide.format);
  }, [resolved, guide.format]);

  const compact = guide.format === 'recall' || resolved;
  const toggle = (
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
  );

  return (
    <div className="format-cue" data-format={guide.format} data-new={(isNew && !resolved) || undefined}>
      <p className="context">{context}{compact && toggle}</p>
      {!compact && (
        <p className="format-cue__line">
          {isNew && <span className="format-cue__new">New type</span>}
          <span className="sr-only">{guide.label}: </span>
          <span>{guide.instruction}</span>
          {toggle}
        </p>
      )}
      <div id={panel} className="format-cue__detail" hidden={!open}>
        <p><strong>{guide.label}.</strong> {compact && `${guide.instruction} `}{guide.detail}</p>
        {live ? (
          <p className="format-cue__note">The shot clock keeps running. Worked examples open in How to play after this question.</p>
        ) : onGuide ? (
          <button type="button" className="btn-link" onClick={() => onGuide(guide.format)}>Try a worked {guide.label.toLowerCase()} example</button>
        ) : null}
      </div>
    </div>
  );
}
