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
          Each day brings five real NBA numbers. For each one, drag the two brackets in to frame a window you’re
          sure the answer sits inside. Then lock it and watch where the real number lands.
        </p>
        <p>
          <strong>Tighter pays more.</strong> A window one notch wide is worth 100. The whole ruler is worth 0. If the
          answer lands outside your window, that round scores 0.
        </p>
        <ul className="help-examples">
          <li data-kind="hit">
            <span className="help-glyph" aria-hidden="true">✓</span>
            <span>
              <strong>Inside.</strong> Warriors’ wins: you framed 66–78, the answer was 73. That’s 54 points.
            </span>
          </li>
          <li data-kind="miss">
            <span className="help-glyph" aria-hidden="true">✕</span>
            <span>
              <strong>Outside.</strong> Kobe’s biggest night: you framed 55–70, the answer was 81. That’s 0, and the window
              is shown hatched.
            </span>
          </li>
        </ul>
        <table className="help-table">
          <caption>What a window is worth, if it’s right</caption>
          <tbody>
            <tr><th scope="row">A tenth of the ruler</th><td>83</td></tr>
            <tr><th scope="row">A fifth</th><td>65</td></tr>
            <tr><th scope="row">Half</th><td>26</td></tr>
          </tbody>
        </table>
        <p>
          Prefer exact numbers? Tap either big number to type it. On a keyboard, Tab to a bracket and use the arrow keys
          (Shift moves further, Enter locks). Tap the ruler outside your window to pull that side straight to it.
        </p>
        <p className="help-small">
          A new puzzle opens every day at midnight UTC, the same five for everyone. From {formatDay(NBA_CUTOVER)} every puzzle is NBA; the earlier mixed-sport days stay playable. Your progress stays in this browser;
          there’s no account.{' '}
          {analyticsEnabled
            ? 'We count plays without cookies or IDs (rounds locked, games finished, shares) to improve the game. Today’s total can feed a daily percentile, kept with a random code from this browser for 7 days; your windows are checked, then discarded. No names, no answers kept.'
            : 'Today’s total can feed a daily percentile, kept with a random code from this browser for 7 days; your windows are checked, then discarded. No names, no answers kept.'}{' '}
          {onPrivacy && (
            <>
              <button type="button" className="btn-link" onClick={onPrivacy}>
                Privacy choices
              </button>
              .{' '}
            </>
          )}
          Every answer links to its source. NBA facts are checked against Wikipedia articles by Wikipedia contributors,
          used under{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">
            CC BY-SA 4.0
          </a>
          .
        </p>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </dialog>
  );
}
