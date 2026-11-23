import { useEffect, useRef, useState } from 'react';
import { analyticsAllowed, browserSignal, loadPrivacy, savePrivacy, scoresShownOn, type Privacy as Prefs } from '../lib/privacy';
import { deleteMyScores } from '../lib/scores';
import { choice as rankingChoice, leave as deletePreviousRankings } from '../lib/leaderboard';
import { analyticsEnabled, resumeAnalytics, track } from '../lib/track';

/**
 * In-app privacy controls. The full notice is /privacy.html (docs/PRIVACY.md is the source).
 * Turning analytics off or on takes effect at once; it also keeps the choice for later visits.
 */
export function PrivacyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrivacy());
  const [status, setStatus] = useState<string | null>(null);
  // Avoid duplicate DELETEs and wasted free-tier calls from double taps.
  const eraseBusy = useRef(false);
  const [erasing, setErasing] = useState(false);
  const [hasHistoricalRankingKey, setHasHistoricalRankingKey] = useState(() => !!rankingChoice().key);
  const [rankingDeleteStatus, setRankingDeleteStatus] = useState<string | null>(null);
  const rankingDeleteBusy = useRef(false);
  const [deletingPreviousRanking, setDeletingPreviousRanking] = useState(false);
  const signal = browserSignal();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setPrefs(loadPrivacy());
      setStatus(null);
      setRankingDeleteStatus(null);
      setHasHistoricalRankingKey(!!rankingChoice().key);
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
            disabled={erasing || prefs.deleting === true}
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
            {prefs.deleting && ' Deletion is still unconfirmed. New submissions are blocked until you retry and the server confirms removal.'}
          </span>
        </label>
        {signal && (
          <p className="help-small">Your browser sends Global Privacy Control or Do Not Track, so both start off. You can switch them on here.</p>
        )}
        <p>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={erasing}
            onClick={async () => {
              if (eraseBusy.current) return;
              eraseBusy.current = true;
              setErasing(true);
              try {
                setStatus('Deleting…');
              // deleteMyScores() synchronously withdraws consent before it awaits
              // the network. Do not pre-mark an unused rotated key as pending:
              // consent is withdrawn immediately. Any existing code, even with missing
              // sent-day metadata, still needs a real server deletion confirmation.
              const pending = deleteMyScores();
              setPrefs(loadPrivacy());
              const r = await pending;
              if (r !== 'failed') track({ name: 'privacy', choice: 'deleted' });
              setPrefs(loadPrivacy());
              setStatus(
                r === 'deleted'
                  ? 'Done. Scores this browser sent in the last 7 days were checked for removal; any linked records were deleted, the old browser code was cleared, and the daily comparison is off until you tick it again.'
                  : r === 'nothing'
                    ? 'Nothing to delete: this browser hasn’t sent a score that’s still kept. The daily comparison is now off.'
                    : 'Deletion is not confirmed. New scores are blocked and your original code is saved for a retry.',
                );
              } finally {
                eraseBusy.current = false;
                setErasing(false);
              }
            }}
          >
            {erasing ? 'Deleting…' : 'Delete my scores'}
          </button>
        </p>
        {status && (
          <p className="help-small" role="status">
            {status}
          </p>
        )}
        {(hasHistoricalRankingKey || rankingDeleteStatus) && (
          <section aria-label="Previously saved global ranking data">
            {hasHistoricalRankingKey && (
              <p className="help-small">
                A previous test may have left a ranking code in this browser. Global rankings are deferred and no new entries are accepted. You can request removal here without playing a new game or opting in. If the server is unavailable, keep this browser data for retry.
              </p>
            )}
            {hasHistoricalRankingKey && <button type="button" className="btn btn-quiet" disabled={deletingPreviousRanking} onClick={async () => {
              if(rankingDeleteBusy.current)return;
              rankingDeleteBusy.current=true;
              setDeletingPreviousRanking(true);
              setRankingDeleteStatus('Requesting removal…');
              try {
                const result = await deletePreviousRankings();
                setHasHistoricalRankingKey(!!rankingChoice().key);
                setRankingDeleteStatus(result === 'deleted'
                  ? 'Your previous rankings were removed according to the server.'
                  : result === 'nothing'
                    ? 'There are no linked rankings to remove from this browser.'
                    : 'Removal is not confirmed. Your browser code is saved so you can retry later.');
              } finally {
                rankingDeleteBusy.current=false;
                setDeletingPreviousRanking(false);
              }
            }}>Delete any previously submitted rankings</button>}
            {rankingDeleteStatus && <p role="status" className="help-small">{rankingDeleteStatus}</p>}
          </section>
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
