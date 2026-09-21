import { test } from '@playwright/test';
import { JOURNEYS } from './set-aside-journeys';

/* The combination walk on the desktop: every journey in `set-aside-journeys.ts`, amounts typed key by key. */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // No live rates: a save never waits on the network, and the dollars read as the app's own rates make them.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

for (const journey of JOURNEYS) test(journey.title, ({ page }) => journey.run(page));
