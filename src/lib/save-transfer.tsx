import { useEffect, useState } from 'react';
import { createSaveStore, mergeTransferredSave, SAVE_KEY, UNTIMED_PRACTICE_KEY } from '../engine/storage';
import { CANONICAL_ORIGIN, LEGACY_ORIGIN } from './site';

const TRANSFER = 'move-stat-window';
const DONE = 'stat-window:origin-moved:v1';
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
  return atOrigin(LEGACY_ORIGIN).href;
}

function clocks(storage: Storage, pattern: RegExp): Record<string, number> {
  const starts: Record<string, number> = {};
  for (const key of Object.keys(storage)) {
    const start = Number(storage.getItem(key));
    if (pattern.test(key) && start > 0 && start <= Date.now() + 1000) starts[key] = start;
  }
  return starts;
}

function exportProgress() {
  const saves = saveKeys.map((key) => createSaveStore(localStorage, key).load());
  return { saves, daily: clocks(localStorage, localClock), tab: clocks(sessionStorage, sessionClock) };
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
  localStorage.setItem(DONE, '1');
}

/**
 * Both windows are top-level so the original browser storage is accessible.
 * The query flag coordinates startup; save contents travel only via postMessage.
 */
export function OriginTransfer({ children }: { children: React.ReactNode }) {
  const legacy = location.origin === LEGACY_ORIGIN;
  const bare = location.hostname === 'statwindow.app';
  const target = atOrigin(CANONICAL_ORIGIN);
  const receiving = location.origin === CANONICAL_ORIGIN && target.searchParams.get(TRANSFER) === '1';
  if (receiving) target.searchParams.delete(TRANSFER);

  const [message, setMessage] = useState('');
  const [moving, setMoving] = useState(false);
  const [done, setDone] = useState(false);
  const [needsTransfer] = useState(() => {
    if (!legacy) return false;
    try {
      if (localStorage.getItem(DONE)) return false;
      const { saves, daily, tab } = exportProgress();
      return saves.some((save) => [save.runs, save.practice].some((runs) =>
        Object.values(runs ?? {}).some((run) => run.results.length > 0 || run.guess))) ||
        Object.keys(daily).length > 0 || Object.keys(tab).length > 0;
    } catch { return true; }
  });

  useEffect(() => {
    if (bare || (legacy && !needsTransfer)) location.replace(target.href);
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

  const move = () => {
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
          popup.postMessage({ type: 'stat-window:transfer', payload: exportProgress() }, CANONICAL_ORIGIN);
        } catch {
          finish('Couldn’t read your saved games. Check your browser storage settings and try again.');
        }
      } else if (event.data?.type === 'stat-window:transferred') {
        try { localStorage.setItem(DONE, '1'); } catch { /* destination already confirmed the save */ }
        setDone(true);
        finish('Your saved games are open in the new tab.');
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

  if (!legacy && !bare && !receiving) return children;
  return (
    <main className="main">
      <section className="question-block">
        <h1 className="question">Stat Window has a new address</h1>
        {legacy && needsTransfer && !done && (
          <p><button type="button" className="btn btn-primary" onClick={move} disabled={moving}>Move saved games</button></p>
        )}
        <p role="status">{message || (receiving ? 'Moving your saved games…' : '')}</p>
        {!done && <a className="btn-link" href={target.href}>{needsTransfer || receiving ? 'Continue without moving saves' : 'Continue to statwindow.app'}</a>}
      </section>
    </main>
  );
}
