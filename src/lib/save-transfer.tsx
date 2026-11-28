import { useEffect, useState } from 'react';
import { createSaveStore, emptySave, mergeTransferredSave, SAVE_KEY, UNTIMED_PRACTICE_KEY } from '../engine/storage';
import { CANONICAL_ORIGIN, LEGACY_ORIGIN } from './site';
import { loadPrivacy, savePrivacy, PRIVACY_KEY } from './privacy';
import { deleteMyScores } from './scores';

const TRANSFER = 'move-stat-window';
// Re-offer migration once to browsers that used the original saves-only transfer.
const DONE = 'stat-window:origin-moved:v2';
const LEGACY_PRIVACY = 'legacy-privacy';
const PRIVACY_MOVED = 'stat-window:origin-privacy-moved:v1';
const IMPORT = 'import-saves';
const RESTRICTIONS_HASH = '#sw-legacy-privacy=';

/** No analytics on the old redirect or receiving page: privacy must be applied first. */
export function isOriginTransferPage(): boolean {
  return location.origin === LEGACY_ORIGIN || location.hostname === 'statwindow.app' ||
    (location.origin === CANONICAL_ORIGIN && new URLSearchParams(location.search).get(TRANSFER) === '1');
}
const localClock = /^stat-window:shot:daily:v1:\d{4}-\d{2}-\d{2}:[a-z0-9-]+$/;
const sessionClock = /^stat-window:(?:shot:(?:practice:)?v1:[a-z0-9-]+|practice-start:v1:\d{4}-\d{2}-\d{2})$/;
const saveKeys = [SAVE_KEY, UNTIMED_PRACTICE_KEY] as const;

function atOrigin(origin: string): URL {
  const url = new URL(origin);
  url.pathname = location.pathname;
  url.search = location.search;
  url.hash = location.hash;
  return url;
}

export function legacyImportLink(): string | undefined {
  if (location.origin !== CANONICAL_ORIGIN) return undefined;
  try { if (localStorage.getItem(DONE)) return undefined; } catch { /* storage unavailable */ }
  const url = atOrigin(LEGACY_ORIGIN);
  url.searchParams.set(IMPORT, '1');
  return url.href;
}

function clocks(storage: Storage, pattern: RegExp): Record<string, number> {
  const starts: Record<string, number> = {};
  for (const key of Object.keys(storage)) {
    const start = Number(storage.getItem(key));
    if (pattern.test(key) && start > 0 && start <= Date.now() + 1000) starts[key] = start;
  }
  return starts;
}

function restrictions() {
  const p = loadPrivacy(localStorage);
  return { analyticsOff: p.analytics === 'off', scoresOff: p.scores === 'off' || p.deleting === true, asked: p.asked };
}

/** The same-tab fallback carries only restrictive bits, never codes, scores or other data.
 * The fragment is not sent to the server and is removed before analytics starts. */
export function applyLegacyPrivacyRedirect(): void {
  if (location.origin !== CANONICAL_ORIGIN || !location.hash.startsWith(RESTRICTIONS_HASH)) return;
  const raw = location.hash.slice(RESTRICTIONS_HASH.length);
  const match = /^([01]{3})&(.*)$/.exec(raw);
  if (!match) return;
  const [, bits, original] = match;
  let hash: string;
  try { hash = decodeURIComponent(original!); } catch { return; }
  if (hash !== '' && !hash.startsWith('#')) return;
  const patch = { ...(bits![0] === '1' ? { analytics: 'off' as const } : {}), ...(bits![1] === '1' ? { scores: 'off' as const } : {}), ...(bits![2] === '1' ? { asked: true } : {}) };
  // savePrivacy also keeps the choices in memory if browser storage is blocked.
  savePrivacy(patch);
  try { history.replaceState(history.state, '', location.pathname + location.search + hash); } catch { /* leave the restriction marker for reload */ }
}

function exportProgress(includeGames = true) {
  const saves = saveKeys.map((key) => includeGames ? createSaveStore(localStorage, key).load() : emptySave());
  return { includeGames, saves, daily: includeGames ? clocks(localStorage, localClock) : {}, tab: includeGames ? clocks(sessionStorage, sessionClock) : {}, privacy: restrictions() };
}

function importClocks(payload: unknown, storage: Storage, pattern: RegExp) {
  if (!payload || typeof payload !== 'object') return;
  for (const [key, start] of Object.entries(payload)) {
    if (!pattern.test(key) || typeof start !== 'number' || !(start > 0 && start <= Date.now() + 1000)) continue;
    const existing = Number(storage.getItem(key));
    storage.setItem(key, String(existing > 0 && existing <= Date.now() + 1000 ? Math.min(existing, start) : start));
  }
}

type TransferData = ReturnType<typeof exportProgress>;

function receiveProgress(payload: TransferData) {
  const merged = saveKeys.map((key, i) => mergeTransferredSave(createSaveStore(localStorage, key).load(), payload.saves[i]));
  if (merged.some((save) => !save)) throw new Error('Invalid save');
  saveKeys.forEach((key, i) => localStorage.setItem(key, JSON.stringify(merged[i])));
  importClocks(payload.daily, localStorage, localClock);
  importClocks(payload.tab, sessionStorage, sessionClock);
  // Only restrictive preferences cross origins. Never copy a score/erasure code,
  // opt a player in, or overwrite a distinct destination score identity.
  const p = loadPrivacy(localStorage);
  const choices = payload.privacy;
  if (choices && typeof choices === 'object') {
    if (choices.analyticsOff === true) p.analytics = 'off';
    if (choices.scoresOff === true) p.scores = 'off';
    if (choices.asked === true) p.asked = true;
    localStorage.setItem(PRIVACY_KEY, JSON.stringify(p));
  }
  if (payload.includeGames !== false) localStorage.setItem(DONE, '1');
}

/**
 * Both windows are top-level so the original browser storage is accessible.
 * The query flag coordinates startup; save contents travel only via postMessage.
 */
export function OriginTransfer({ children }: { children: React.ReactNode }) {
  const legacy = location.origin === LEGACY_ORIGIN;
  const bare = location.hostname === 'statwindow.app';
  const target = atOrigin(CANONICAL_ORIGIN);
  const params = new URLSearchParams(location.search);
  const privacyPage = legacy && params.get(LEGACY_PRIVACY) === '1';
  const explicitImport = legacy && params.get(IMPORT) === '1';
  if (privacyPage) target.searchParams.delete(LEGACY_PRIVACY);
  if (explicitImport) target.searchParams.delete(IMPORT);
  const receiving = location.origin === CANONICAL_ORIGIN && target.searchParams.get(TRANSFER) === '1';
  if (receiving) target.searchParams.delete(TRANSFER);

  const [message, setMessage] = useState('');
  const [moving, setMoving] = useState(false);
  const [done, setDone] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseMessage, setEraseMessage] = useState('');
  const [hasRestrictions] = useState(() => {
    if (!legacy) return false;
    try { return Object.values(restrictions()).some(Boolean); } catch { return true; }
  });
  const [needsTransfer] = useState(() => {
    if (!legacy) return false;
    try {
      const privacyNeedsMove = hasRestrictions && localStorage.getItem(PRIVACY_MOVED) !== JSON.stringify(restrictions());
      if (!explicitImport && (localStorage.getItem(DONE) || localStorage.getItem(PRIVACY_MOVED))) return privacyNeedsMove;
      const { saves, daily, tab } = exportProgress();
      return privacyNeedsMove || saves.some((save) => [save.runs, save.practice].some((runs) =>
        Object.values(runs ?? {}).some((run) => run.results.length > 0 || run.guess))) ||
        Object.keys(daily).length > 0 || Object.keys(tab).length > 0;
    } catch { return true; }
  });

  useEffect(() => {
    if (bare || (legacy && !needsTransfer && !privacyPage)) {
      // Reapply restrictions even on an automatic redirect, including after a prior move.
      if (legacy) continueToSite(); else location.replace(target.href);
    }
    if (!receiving) return;
    const opener = window.opener as Window | null;
    if (!opener) {
      location.replace(target.href);
      return;
    }
    const onProgress = (event: MessageEvent) => {
      if (event.origin !== LEGACY_ORIGIN || event.source !== opener || event.data?.type !== 'stat-window:transfer') return;
      try {
        receiveProgress(event.data.payload);
        opener.postMessage({ type: 'stat-window:transferred' }, LEGACY_ORIGIN);
        location.replace(target.href);
      } catch {
        setMessage('Couldn’t save your games here. Return to the old tab to try again.');
      }
    };
    window.addEventListener('message', onProgress);
    opener.postMessage({ type: 'stat-window:ready' }, LEGACY_ORIGIN);
    const timeout = window.setTimeout(() => setMessage('The transfer didn’t finish. Return to the old tab to try again.'), 8000);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', onProgress);
    };
    // This component runs before the game starts, on the initial address only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function continueToSite() {
    const destination = new URL(target);
    if (legacy) {
      const p = restrictions();
      if (Object.values(p).some(Boolean)) {
        const bits = [p.analyticsOff, p.scoresOff, p.asked].map(Boolean).map(Number).join('');
        destination.hash = RESTRICTIONS_HASH + bits + '&' + encodeURIComponent(destination.hash);
      }
      // Do not mark completion until a popup acknowledges durable receipt. An old
      // visit can retry, and the branded site can always offer the explicit import.
    }
    location.replace(destination.href);
  }

  const move = (includeGames: boolean) => {
    const destination = new URL(target);
    destination.searchParams.set(TRANSFER, '1');
    const popup = window.open(destination.href, '_blank');
    if (!popup) {
      setMessage('Allow pop-ups for this page and try again.');
      return;
    }
    setMoving(true);
    setMessage('Opening your games on statwindow.app…');
    const onReply = (event: MessageEvent) => {
      if (event.origin !== CANONICAL_ORIGIN || event.source !== popup) return;
      if (event.data?.type === 'stat-window:ready') {
        try {
          popup.postMessage({ type: 'stat-window:transfer', payload: exportProgress(includeGames) }, CANONICAL_ORIGIN);
        } catch {
          finish('Couldn’t read your saved games. Check your browser storage settings and try again.');
        }
      } else if (event.data?.type === 'stat-window:transferred') {
        try {
          if (includeGames) localStorage.setItem(DONE, '1');
          localStorage.setItem(PRIVACY_MOVED, JSON.stringify(restrictions()));
        } catch { /* destination already confirmed the save */ }
        setDone(true);
        finish(includeGames ? 'Your saved games are open in the new tab.' : 'Your privacy settings are applied in the new tab.');
      }
    };
    const finish = (status: string) => {
      clearTimeout(timeout);
      window.removeEventListener('message', onReply);
      setMoving(false);
      setMessage(status);
    };
    const timeout = window.setTimeout(() => finish('The transfer didn’t finish. Try again.'), 10000);
    window.addEventListener('message', onReply);
  };

  const erase = async () => {
    setErasing(true);
    try {
      const result = await deleteMyScores();
      setEraseMessage(result === 'deleted' ? 'Legacy linked scores deleted.' : result === 'nothing' ? 'No legacy score code found.' : 'Deletion not confirmed. Keep this browser’s data and try again.');
    } catch { setEraseMessage('Deletion not confirmed. Keep this browser’s data and try again.'); }
    finally { setErasing(false); }
  };

  if (!legacy && !bare && !receiving) return children;
  return (
    <main className="main">
      <section className="question-block">
        <h1 className="question">Stat Window has a new address</h1>
        {legacy && !privacyPage && needsTransfer && !done && (
          <>
            <p><button type="button" className="btn btn-primary" onClick={() => move(true)} disabled={moving}>Move saved games</button></p>
            <p>Moving games also preserves privacy restrictions from this browser.</p>
            {hasRestrictions && <p><button type="button" className="btn-link" onClick={() => move(false)} disabled={moving}>Move privacy settings only</button></p>}
          </>
        )}
        <p role="status">{message || (receiving ? 'Moving your saved games…' : '')}</p>
        {legacy && privacyPage && (
          <>
            <p>Legacy score deletion uses the original browser code. This does not delete saved games or scores linked to a different browser code on the new site.</p>
            <p><button type="button" className="btn btn-primary" onClick={() => void erase()} disabled={erasing}>Delete legacy comparison scores</button></p>
            <p role="status">{eraseMessage}</p>
          </>
        )}
        {legacy && !privacyPage && <p><a className="btn-link" href={LEGACY_ORIGIN + '/?legacy-privacy=1'}>Manage legacy score deletion</a></p>}
        {!receiving && <button type="button" className="btn-link" onClick={continueToSite} disabled={moving}>{needsTransfer && !privacyPage && !done ? 'Continue without moving saves' : 'Continue to statwindow.app'}</button>}
      </section>
    </main>
  );
}
