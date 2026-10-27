import { expect, test } from '@playwright/test';
import { household } from './bill-pause';

test('on a phone: a skipped month in History opens a sheet that unskips it, and the bill is owed again', async ({ page }) => {
  await household(page);
  await page.getByTestId('bill-row').filter({ hasText: 'Gym' }).click();
  const actions = page.getByRole('group', { name: 'Actions' });
  await actions.getByRole('button', { name: 'Skip' }).click();

  const history = page.getByTestId('bill-history');
  await expect(history.getByText('Skipped')).toHaveCount(1);
  // This month is settled: Pay moves on to the next one, by name.
  await expect(actions.getByRole('button', { name: 'Pay', exact: true })).toHaveCount(0);

  await history.getByRole('button', { name: /bill/ }).click();
  const sheet = page.getByRole('dialog', { name: /bill · skipped$/ });
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(history.getByText('Skipped')).toHaveCount(1);

  await history.getByRole('button', { name: /bill/ }).click();
  await sheet.getByRole('button', { name: 'Unskip' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('bill-history')).toHaveCount(0);
  await expect(actions.getByRole('button', { name: 'Pay', exact: true })).toBeVisible();

  await page.goto('/bills');
  await expect(page.getByTestId('bills-total')).toContainText('500.000');
});

test('on a phone: a paused month in History is plain, not a button', async ({ page }) => {
  await household(page);
  await page.getByTestId('bill-row').filter({ hasText: 'Gym' }).click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pause' }).click();
  const pause = page.getByRole('dialog', { name: 'Pause' });
  await pause.getByRole('radio', { name: '1 month' }).click();
  await pause.getByRole('button', { name: 'Pause Gym' }).click();
  const history = page.getByTestId('bill-history');
  await expect(history.getByText('Paused')).toHaveCount(1);
  await expect(history.getByRole('button')).toHaveCount(0);
});
