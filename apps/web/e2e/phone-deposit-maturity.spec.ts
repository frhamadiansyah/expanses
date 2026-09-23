import { test } from '@playwright/test';
import { COMBOS, comboName, HAND_COMBOS, walk } from './deposit-maturity';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

// Four of the 20 by thumb: one of each choice, both currencies, both payouts, both tax states.
const PICK = [
  'IDR · principal · at_maturity · taxed',
  'IDR · principal · monthly · tax-free',
  'USD · close · monthly · taxed',
  'USD · principal_interest · at_maturity · tax-free',
];

for (const combo of COMBOS.filter((c) => PICK.includes(comboName(c)))) {
  test(`walks ${comboName(combo)} on a phone`, async ({ page }) => {
    await walk(page, combo);
  });
}

// And "Recorded it myself" by thumb, on the walk where it changes the most: a close recorded by hand posts nothing,
// so the deposit keeps its principal and stays open.
for (const combo of HAND_COMBOS.filter((c) => comboName(c) === 'IDR · close · at_maturity · tax-free')) {
  test(`walks ${comboName(combo)} · first by hand on a phone`, async ({ page }) => {
    await walk(page, combo, true);
  });
}
