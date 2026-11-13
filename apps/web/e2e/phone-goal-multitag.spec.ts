import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addPriced } from './asset-page';
import { newGoal, openHolding } from './goal-funding';
import { goalCard, goalRow } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('phone: three buys of one holding are tagged to a goal in one go, and one left unticked stays out', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
  await addPriced(page, 'Gold bullion', 'Bar stock', [
    ['2026-01-12', '4', '7000000'],
    ['2026-02-16', '3', '5400000'],
    ['2026-03-09', '5', '9100000'],
  ]);

  await newGoal(page, 'Wedding fund');
  await page.getByRole('button', { name: /^Funding/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Funding' });
  await sheet.getByRole('button', { name: 'Tag a purchase' }).click();
  const buys = await openHolding(page, 'Bar stock');

  // All three are ticked on opening; the confirm counts them.
  const rows = buys.getByTestId('taggable-row');
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) await expect(row).toHaveAttribute('aria-checked', 'true');
  await expect(buys.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute('aria-checked', 'true');
  await expect(buys.getByRole('button', { name: 'Tag 3', exact: true })).toBeEnabled();

  // Select all clears them and disables the confirm; ticking two brings it back at Tag 2.
  await buys.getByRole('checkbox', { name: 'Select all' }).click();
  await expect(buys.getByRole('button', { name: 'Tag 0', exact: true })).toBeDisabled();
  await rows.nth(0).click();
  await rows.nth(2).click();
  await expect(buys.getByRole('button', { name: 'Tag 2', exact: true })).toBeEnabled();
  await buys.getByRole('checkbox', { name: 'Select all' }).click();
  await expect(buys.getByRole('button', { name: 'Tag 3', exact: true })).toBeEnabled();
  await rows.nth(1).click();

  // Two tagged, none of them on another goal: no question, back on the Funding sheet.
  await buys.getByRole('button', { name: 'Tag 2', exact: true }).click();
  await expect(sheet.getByTestId('tagged-row')).toHaveCount(2);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /^Funding/ })).toContainText('2 purchases');
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await expect(goalRow(page, 'Wedding fund')).toBeVisible();
  const card = await goalCard(page, 'Wedding fund');
  await expect(card.getByTestId('goal-link').filter({ hasText: 'Bar stock' })).toBeVisible();

  // A second goal takes all three: two serve Wedding fund, so one question names it and counts them.
  await newGoal(page, 'Study abroad');
  await page.getByRole('button', { name: /^Funding/ }).click();
  const second = page.getByRole('dialog', { name: 'Funding' });
  await second.getByRole('button', { name: 'Tag a purchase' }).click();
  const again = await openHolding(page, 'Bar stock');
  await expect(again.getByTestId('taggable-row')).toHaveCount(3);
  await again.getByRole('button', { name: 'Tag 3', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Move these purchases?' });
  await expect(ask).toContainText('2 of the ticked purchases serve Wedding fund');
  await ask.getByRole('button', { name: 'Move to this goal' }).click();
  await expect(second.getByTestId('tagged-row')).toHaveCount(3);
});
