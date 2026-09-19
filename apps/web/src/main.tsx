import { type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { bootstrap } from './db/bootstrap';
import { opfsSnapshots } from './db/snapshots';
import { OpeningScreen } from './features/recovery/OpeningScreen';
import { RecoveryScreen } from './features/recovery/RecoveryScreen';
import { registerServiceWorker } from './lib/pwa';
import './styles.css';

registerServiceWorker();

// One store for the whole page: the recovery screen reads it on every path, whether it was reached by a
// failure or asked for on purpose.
const snapshots = opfsSnapshots();

const root = createRoot(document.getElementById('root')!);

const params = new URLSearchParams(window.location.search);
const recoveryMode = params.has('recover') || window.location.hash === '#recover';

function Message({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
      {children}
    </div>
  );
}

async function start() {
  // Something is on screen before the engine is even asked for, so a slow device never shows a blank page.
  root.render(<OpeningScreen stage={{ stage: 'opening' }} />);
  try {
    const result = await bootstrap((stage) => root.render(<OpeningScreen stage={stage} />));
    if (!result.ok) {
      root.render(<RecoveryScreen reason={result.reason} snapshots={snapshots} />);
      return;
    }
    const app = result.app;
    if (import.meta.env.DEV) {
      const { loadSample, pushOverBudget, wantsOverBudget, wantsSample } = await import('./db/dev-sample');
      if (wantsSample()) {
        root.render(<Message title="Loading sample data…" body="Replacing the data in this browser with the sample household." />);
        await loadSample(app.database);
        return;
      }
      if (wantsOverBudget()) await pushOverBudget(app.database, app.ws);
    }
    root.render(
      <StrictMode>
        <App app={app} />
      </StrictMode>,
    );
  } catch (error) {
    // openSafely names every failure it knows about; anything that still lands here is unnamed, so it is
    // shown the same way as the rest rather than as a blank page.
    root.render(
      <RecoveryScreen
        reason={{
          kind: 'cannot-open',
          headline: 'We could not finish opening your data.',
          detail: error instanceof Error ? error.message : String(error),
          exportable: true,
        }}
        snapshots={snapshots}
      />,
    );
  }
}

if (recoveryMode) {
  // Recovery mode never opens the database, and never waits for the single-tab lock either: the VFS keeps
  // no handles, so a user (or a test) can export, restore and start fresh even when opening is what breaks.
  root.render(
    <RecoveryScreen
      reason={{ kind: 'cannot-open', headline: 'Recovery', detail: 'Opened in recovery mode. Nothing has failed.', exportable: true }}
      requested
      snapshots={snapshots}
    />,
  );
} else if ('locks' in navigator) {
  // opfs-sahpool allows one connection; a second tab must not open the database.
  void navigator.locks.request('expanses-db', { ifAvailable: true }, async (lock) => {
    if (!lock) {
      root.render(
        <Message title="Already open in another tab" body="Close the other Expanses tab, then reload this one.">
          <p className="mt-4 text-sm">
            <a className="text-slate-900 underline underline-offset-2" href="?recover">
              Or open the recovery tools
            </a>
          </p>
        </Message>,
      );
      return;
    }
    await start();
    await new Promise(() => undefined);
  });
} else {
  void start();
}
