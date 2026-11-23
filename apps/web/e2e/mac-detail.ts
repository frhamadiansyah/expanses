import type { Page } from '@playwright/test';

/**
 * The Mac's v2 parts — the charts, the full tables, the extra boxes v1 leaves out (`src/ui/mac-detail.ts`) — drawn for
 * this page from its first load on. A wide journey that reads one of those parts, or an exact figure only they print,
 * calls this, best before its first `goto`; v1 is what the app draws without it.
 */
export async function macV2(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('cicis.mac-detail', 'v2'));
  // The app reads it once, as it starts: a page a beforeEach already opened is loaded again.
  if (page.url() !== 'about:blank') await page.reload();
}
