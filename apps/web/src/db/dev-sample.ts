import type { Database } from '@expanses/db';

/**
 * Development only: `?load-sample` replaces this browser's data with dev-data/sample.sqlite3, built by
 * `SAMPLE_OUT=../../apps/web/dev-data/sample.sqlite3 npx vitest run test/sample-data.test.ts` in packages/db.
 *
 * The call site sits behind import.meta.env.DEV, so a production build contains neither this nor the file.
 */
export const wantsSample = () => new URLSearchParams(window.location.search).has('load-sample');

export async function loadSample(database: Database): Promise<void> {
  const files = import.meta.glob<string>('/dev-data/sample.sqlite3', { query: '?url', import: 'default' });
  const url = files['/dev-data/sample.sqlite3'];
  if (!url) throw new Error('No dev-data/sample.sqlite3 yet. Build it from packages/db with SAMPLE_OUT (see src/db/dev-sample.ts).');
  const response = await fetch(await url());
  if (!response.ok) throw new Error(`Could not read the sample file (${response.status})`);
  await database.importBytes(new Uint8Array(await response.arrayBuffer()));
  window.history.replaceState(null, '', window.location.pathname);
  window.location.reload();
}
