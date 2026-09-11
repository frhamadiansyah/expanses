import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { bootstrap } from './db/bootstrap';
import { registerServiceWorker } from './lib/pwa';
import './styles.css';

registerServiceWorker();

const root = createRoot(document.getElementById('root')!);

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </div>
  );
}

async function start() {
  root.render(<Message title="Opening your data…" body="Starting the local database on this device." />);
  try {
    const app = await bootstrap();
    root.render(
      <StrictMode>
        <App app={app} />
      </StrictMode>,
    );
  } catch (error) {
    root.render(<Message title="Could not open the database" body={error instanceof Error ? error.message : String(error)} />);
  }
}

// opfs-sahpool allows one connection; a second tab must not open the database.
if ('locks' in navigator) {
  void navigator.locks.request('expanses-db', { ifAvailable: true }, async (lock) => {
    if (!lock) {
      root.render(<Message title="Already open in another tab" body="Close the other Expanses tab, then reload this one." />);
      return;
    }
    await start();
    await new Promise(() => undefined);
  });
} else {
  void start();
}
