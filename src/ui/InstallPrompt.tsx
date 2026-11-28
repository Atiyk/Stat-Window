import { useId, useRef, useState, useSyncExternalStore } from 'react';
import './install-prompt.css';

type NativeInstallEvent = Event & {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const dismissalKey = 'stat-window:install-suggestion-hidden';
const installedMode = typeof window === 'undefined' ? null : window.matchMedia('(display-mode: standalone)');
const listeners = new Set<() => void>();
let nativeInstall: NativeInstallEvent | null = null;
let hidden = false;

function readDismissal(): boolean {
  try {
    return window.localStorage.getItem(dismissalKey) === '1';
  } catch {
    return false;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

function hideSuggestion() {
  nativeInstall = null;
  hidden = true;
  try {
    window.localStorage.setItem(dismissalKey, '1');
  } catch {
    // Keep the dismissal for the lifetime of this page if storage is unavailable.
  }
  publish();
}

// Results imports this module at startup. The browser can offer installation
// while someone is still playing, so capture the event before Results mounts.
if (typeof window !== 'undefined') {
  hidden = readDismissal();
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    nativeInstall = hidden ? null : (event as NativeInstallEvent);
    publish();
  });
  window.addEventListener('appinstalled', hideSuggestion);
  window.addEventListener('storage', (event) => {
    if (event.key === dismissalKey || event.key === null) {
      hidden = readDismissal();
      publish();
    }
  });
  installedMode?.addEventListener?.('change', publish);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function installMethod(): 'native' | 'ios' | 'android' | null {
  const browser = navigator as Navigator & { standalone?: boolean };
  if (hidden || installedMode?.matches || browser.standalone) return null;
  if (nativeInstall) return 'native';
  if (/iPhone|iPad|iPod/i.test(browser.userAgent) || (/Macintosh/i.test(browser.userAgent) && browser.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(browser.userAgent)) return 'android';
  return null;
}

export function InstallPrompt({ completedDays, onDismiss }: { completedDays: number; onDismiss: () => void }) {
  const method = useSyncExternalStore(subscribe, installMethod, () => null);
  const guideId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [prompting, setPrompting] = useState(false);
  // Installing from a publisher frame is not a dependable browser capability.
  if (typeof window !== 'undefined' && window.self !== window.top) {
    return <p className="install-prompt-guide">Playing inside another site? <a href="/" target="_blank" rel="noopener noreferrer">Open Stat Window in a new tab</a> to use your browser’s install options. Saved scores may not carry over between browser contexts.</p>;
  }
  if (completedDays < 2 || !method) return null;

  const dismiss = () => {
    if (root.current?.contains(document.activeElement)) onDismiss();
    hideSuggestion();
  };

  const install = async () => {
    const event = nativeInstall;
    if (!event) {
      setGuideOpen((open) => !open);
      return;
    }
    if (prompting) return;
    setPrompting(true);
    try {
      await event.prompt();
      // Closing the system prompt is also a dismissal of the suggestion.
      await event.userChoice;
      dismiss();
    } catch {
      nativeInstall = null;
      setGuideOpen(true);
      publish();
    } finally {
      setPrompting(false);
    }
  };

  const manual = method !== 'native';
  return (
    <div className="install-prompt" ref={root}>
      <div className="install-prompt-actions">
        <button
          type="button"
          className="btn btn-link"
          aria-expanded={manual ? guideOpen : undefined}
          aria-controls={manual ? guideId : undefined}
          aria-disabled={prompting}
          onClick={() => void install()}
        >
          {manual ? 'Add to Home Screen' : 'Install Stat Window'}
        </button>
        <button type="button" className="btn btn-link" aria-label="Hide install suggestion" onClick={dismiss}>
          Hide
        </button>
      </div>
      {manual && (
        <p className="install-prompt-guide" id={guideId} hidden={!guideOpen}>
          {method === 'ios'
            ? 'In Safari, tap Share. You may find it in the page menu. Choose Add to Home Screen. If you see Open as Web App, leave it on, then tap Add. If you opened this inside another app and the option is missing, use its menu to open the game in Safari. Your saved scores may not carry over.'
            : 'Open your browser’s menu and look for Install app or Add to Home screen. If you opened this inside another app and the option is missing, use its menu to open the game in your usual browser. Your saved scores may not carry over.'}
        </p>
      )}
    </div>
  );
}
