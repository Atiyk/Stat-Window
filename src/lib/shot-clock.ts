/**
 * Same-browser, cross-tab Daily Five deadline. Not an anti-cheat mechanism:
 * browsers can edit local storage; ranked scores remain unverified.
 */
type TimerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const shotStorageKey = (id: string) => 'stat-window:shot:v1:' + id;
function storages(): TimerStorage[] {
  if (typeof window === 'undefined') return [];
  const out: TimerStorage[] = [];
  try { out.push(window.sessionStorage); } catch { /* blocked */ }
  try { out.push(window.localStorage); } catch { /* blocked */ }
  return out;
}
export function readShotStart(key: string): number | null {
  let first: number | null = null;
  for (const store of storages()) {
    try {
      const raw = store.getItem(key);
      if (raw === null) continue;
      const time = Number(raw);
      if (Number.isFinite(time) && time > 0 && (first === null || time < first)) first = time;
    } catch { /* storage may fail */ }
  }
  return first;
}
export function rememberShotStart(key: string, at: number): number {
  const existing = readShotStart(key);
  const first = existing === null ? at : Math.min(existing, at);
  for (const store of storages()) {
    try { store.setItem(key, String(first)); } catch { /* memory fallback */ }
  }
  return first;
}
export function clearShotStart(key: string): void {
  for (const store of storages()) {
    try { store.removeItem(key); } catch { /* best-effort cleanup */ }
  }
}
