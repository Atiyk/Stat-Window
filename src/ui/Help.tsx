import { useEffect, useRef } from 'react';

export function Help({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        <h2 id="help-title" className="help-title">How it works</h2>
        <p>
          Each day brings five real sports numbers. For each one, drag the two brackets to frame a window you’re sure
          the answer sits inside.
        </p>
        <p>
          <strong>Tighter pays more.</strong> A window one notch wide is worth 100. The whole ruler is worth 0. If the
          answer lands outside your window, that round scores 0.
        </p>
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
          (Shift moves further, Enter locks).
        </p>
        <p className="help-small">
          A new puzzle opens every day at midnight UTC, the same five for everyone. Your progress stays in this browser;
          there’s no account and nothing is tracked. Every answer links to its source.
        </p>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </dialog>
  );
}
