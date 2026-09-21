import { test } from '@playwright/test';
import { JOURNEYS } from './set-aside-journeys';

/* The combination walk on the phone's own shell: the same journeys, the figures typed on the keypad digit by digit. */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // No live rates: a save never waits on the network, and the dollars read as the app's own rates make them.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

for (const journey of JOURNEYS) test(journey.title, ({ page }) => journey.run(page));
