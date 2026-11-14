import { test } from '@playwright/test';
import { splitCostsJourney } from './trip-split-costs';

/* A shared trip's Split costs and Plan switches on the phone (owner, 14 Nov 2026). E2E_MOCKUP_SHOTS writes the screens. */

test.describe.configure({ timeout: 240_000 });

test('a shared trip in one pot: ＋ and ⚙, Split costs off asked first, no Split row, Plan off, both back on', async ({ page }) => {
  await splitCostsJourney(page, process.env.E2E_MOCKUP_SHOTS);
});
