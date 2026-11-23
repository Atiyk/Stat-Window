import { useEffect, useRef } from 'react';
import { analyticsEnabled } from '../lib/track';
import { NBA_CUTOVER } from '../content/cutover';
import { formatDay } from '../lib/format';

export function Help({ open, onClose, onPrivacy }: { open: boolean; onClose: () => void; onPrivacy?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="help" aria-labelledby="help-title" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="help-body">
        <h2 id="help-title" className="help-title" tabIndex={-1} autoFocus>
          How it works
        </h2>
        <div className="help-diagram" aria-hidden="true">
          <span className="help-band" />
          <span className="help-bracket help-bracket-lo" />
          <span className="help-bracket help-bracket-hi" />
          <span className="help-pin" />
        </div>
        <p>
          Drag the brackets to frame your guess, then lock the window before the 24-second buzzer.
          The clock keeps running if you switch tabs or reload.
        </p>
        <p>
          <strong>Tighter pays more.</strong> Catch the answer with a one-notch window for 100 points.
          A window covering nearly the whole ruler scores 0 even if it catches the answer. A miss or timeout earns zero.
        </p>
        <ul className="help-examples">
          <li data-kind="hit">
            <span className="help-glyph" aria-hidden="true">✓</span>
            <span>
              <strong>Inside.</strong> In the Warriors practice round, 73 wins lands inside 66–78 and earns 75 points.
            </span>
          </li>
          <li data-kind="miss">
            <span className="help-glyph" aria-hidden="true">✕</span>
            <span>
              <strong>Outside.</strong> Kobe’s 81 points are outside 55–70. That earns zero and the window turns dashed.
            </span>
          </li>
        </ul>
        <p>
          Prefer exact numbers? Tap either big number to type it. On a keyboard, Tab to a bracket and use the arrow keys
          (Shift moves further, Enter locks). Tap the ruler outside your window to pull that side straight to it.
        </p>
        <p className="help-small">
          A new puzzle opens every day at 12:00 AM Eastern, the same five for everyone. From {formatDay(NBA_CUTOVER)} every puzzle is NBA; the earlier mixed-sport days stay playable. Your progress stays in this browser;
          there’s no account.{' '}
          {analyticsEnabled
            ? 'We count plays without cookies or IDs (rounds locked, games finished, shares) to improve the game. Today’s total can feed a daily percentile, kept with a random code from this browser for 7 days; your windows are checked, then discarded. Names and answers are never kept.'
            : 'Today’s total can feed a daily percentile, kept with a random code from this browser for 7 days; your windows are checked, then discarded. Names and answers are never kept.'}{' '}
          {onPrivacy && (
            <>
              <button type="button" className="btn-link" onClick={onPrivacy}>
                Privacy choices
              </button>
              .{' '}
            </>
          )}
        </p>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </dialog>
  );
}
