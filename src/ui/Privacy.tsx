import { useEffect, useRef, useState } from 'react';
import { analyticsAllowed, browserSignal, loadPrivacy, savePrivacy, scoresShownOn, type Privacy as Prefs } from '../lib/privacy';
import { deleteMyScores } from '../lib/scores';
import { analyticsEnabled, resumeAnalytics, track } from '../lib/track';

/**
 * In-app privacy controls. The full notice is /privacy.html (docs/PRIVACY.md is the source).
 * Turning analytics off or on takes effect at once; it also keeps the choice for later visits.
 */
export function PrivacyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrivacy());
  const [status, setStatus] = useState<string | null>(null);
  const signal = browserSignal();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setPrefs(loadPrivacy());
      setStatus(null);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const counting = analyticsAllowed(prefs, signal);
  // Unticked until the player says yes wherever the server asked first (or the browser sends GPC/DNT).
  const scoring = scoresShownOn(prefs, signal);

  return (
    <dialog ref={ref} className="help privacy" aria-labelledby="privacy-title" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="help-body">
        <h2 id="privacy-title" className="help-title" tabIndex={-1} autoFocus>
          Privacy and your data
        </h2>
        <p>
          There’s no account, no ads and no tracking cookies. Your game history stays in this browser. Two optional things leave it:
        </p>
        <label className="privacy-row">
          <input
            type="checkbox"
            checked={analyticsEnabled && counting}
            disabled={!analyticsEnabled}
            onChange={(e) => {
              const on = e.target.checked;
              setPrefs(savePrivacy({ analytics: on ? 'on' : 'off' }));
              // Off takes effect at once (every event re-checks the choice); on starts analytics now, not at the next visit.
              if (on) resumeAnalytics();
            }}
          />
          <span>
            <strong>Play counts.</strong> Events like “round 3 locked” or “game finished”, with a 100-point score band, go to
            Vercel Web Analytics. We set no cookies or IDs, and answers and full links are never sent.
            {!analyticsEnabled && ' Not active on this site build.'}
          </span>
        </label>
        <label className="privacy-row">
          <input
            type="checkbox"
            checked={scoring}
            onChange={(e) => {
              const on = e.target.checked;
              setPrefs(savePrivacy({ scores: on ? 'on' : 'off' }));
              track({ name: 'privacy', choice: on ? 'scores-on' : 'scores-off' });
            }}
          />
          <span>
            <strong>Today’s score in the daily comparison.</strong> Your total for today’s official puzzle joins a tally of scores so you
            can see your percentile. It’s linked to a random code made in this browser for 7 days, then only an unlinked count remains.
            Your five windows are checked by the server and not kept.
            {prefs.scores === 'unset' && prefs.asked && ' Where you are, we ask first: it’s off until you tick it or tap “Count my score”.'}
          </span>
        </label>
        {signal && (
          <p className="help-small">Your browser sends Global Privacy Control or Do Not Track, so both start off. You can switch them on here.</p>
        )}
        <p>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={async () => {
              setStatus('Deleting…');
              const r = await deleteMyScores();
              if (r !== 'failed') track({ name: 'privacy', choice: 'deleted' });
              setPrefs(loadPrivacy());
              setStatus(
                r === 'deleted'
                  ? 'Done. Scores this browser sent in the last 7 days are deleted, its code is replaced, and the daily comparison is off until you tick it again.'
                  : r === 'nothing'
                    ? 'Nothing to delete: this browser hasn’t sent a score that’s still kept. The daily comparison is now off.'
                    : 'Couldn’t reach the server. Try again later.',
              );
            }}
          >
            Delete my scores
          </button>
        </p>
        {status && (
          <p className="help-small" role="status">
            {status}
          </p>
        )}
        <p className="help-small">
          Clearing this site’s data in your browser also deletes your saved games and the random code. Full notice:{' '}
          <a href="/privacy.html" target="_blank" rel="noopener">
            privacy policy
          </a>
          .
        </p>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
