import { useEffect, useState } from 'react';
import { isIos, isStandalone, requestPersistentStorage } from '../../lib/pwa';
import { Button } from '../../ui';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

const DISMISS_KEY = 'expanses.install-hint.dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallHint() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const standalone = isStandalone();

  useEffect(() => {
    void requestPersistentStorage().then(setPersisted);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (standalone || dismissed) return null;
  const ios = isIos();
  if (!ios && !installEvent && persisted !== false) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // storage unavailable; hide for this session only
    }
    setDismissed(true);
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-[var(--ph-info-panel)] px-3 py-2 text-sm text-[var(--ph-info-ink)]" role="status">
      <span className="flex-1">
        {ios
          ? 'Install Expanses: tap Share, then “Add to Home Screen”. Otherwise Safari may delete your data after 7 days without a visit.'
          : 'Install Expanses as an app so the browser keeps your data.'}
      </span>
      {installEvent && (
        <Button
          onClick={() => {
            void installEvent.prompt();
            setInstallEvent(null);
          }}
        >
          Install
        </Button>
      )}
      <Button variant="ghost" onClick={dismiss}>
        Dismiss
      </Button>
    </div>
  );
}
