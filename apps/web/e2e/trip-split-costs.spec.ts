import { test } from '@playwright/test';
import { splitCostsJourney } from './trip-split-costs';

/* A shared trip's Split costs and Plan switches on the desktop (owner, 14 Nov 2026): the same journey as the phone's. */

test.describe.configure({ timeout: 240_000 });

test('a shared trip in one pot on the desktop: ＋ and ⚙, Split costs off asked first, no Split row, Plan off, both back on', async ({ page }) => {
  await splitCostsJourney(page);
});
