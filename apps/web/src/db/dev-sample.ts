import { type BudgetLine, isoDate } from '@expanses/core';
import { budgetSheetFor, type Database, setBudgetOverride, type WorkspaceContext } from '@expanses/db';

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

/**
 * Development only: `?over-budget` pushes this month past two of its budgets, so the over-budget rows can be seen.
 *
 * It sets a one-month override at 70% of what each category has already spent, so the standing budgets are
 * untouched and the override can be cleared from the budget screen like any other.
 */
export const wantsOverBudget = () => new URLSearchParams(window.location.search).has('over-budget');

export async function pushOverBudget(database: Database, ws: WorkspaceContext): Promise<void> {
  const month = isoDate().slice(0, 7);
  const sheet = await budgetSheetFor(database, ws, month);
  const spent: BudgetLine[] = [];
  const walk = (lines: readonly BudgetLine[]) => {
    for (const line of lines) {
      if (line.capMinor !== null && line.totalMinor > 0 && line.overMinor === 0) spent.push(line);
      walk(line.children);
    }
  };
  walk(sheet.lines);
  // The two biggest spenders make the clearest over-budget rows.
  for (const line of spent.sort((a, b) => b.totalMinor - a.totalMinor).slice(0, 2)) {
    const amountMinor = Math.max(50_000, Math.round((line.totalMinor * 0.7) / 50_000) * 50_000);
    await setBudgetOverride(database, ws, { categoryAccountId: line.id, month, amountMinor });
  }
  window.history.replaceState(null, '', window.location.pathname);
}
