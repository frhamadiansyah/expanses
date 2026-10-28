import { expect, test, type Page } from '@playwright/test';
import { household } from './bill-pause';

const SHOT = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/bill-history-sheet.png';

/** Gym's own page with this month paid from the pay sheet. */
async function paidGym(page: Page) {
  await household(page);
  await page.getByTestId('bill-row').filter({ hasText: 'Gym' }).click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pay', exact: true }).click();
  await page.getByRole('dialog', { name: 'Pay Gym' }).getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('just-paid')).toBeVisible();
  return page.getByTestId('bill-history');
}

test('on a phone: a paid month in History opens a sheet to open or undo its payment', async ({ page }) => {
  const history = await paidGym(page);
  const row = history.getByRole('button', { name: /bill/ });
  await expect(row).toContainText('paid');
  await row.click();

  const sheet = page.getByRole('dialog', { name: /^Gym · .* bill$/ });
  await expect(sheet.getByRole('button', { name: 'Open payment' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Undo payment' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.screenshot({ path: SHOT });

  // Cancel leaves the month paid.
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);

  // Open payment lands on the receipt, and back returns to the bill.
  await row.click();
  await sheet.getByRole('button', { name: 'Open payment' }).click();
  await expect(page).toHaveURL(/\/transactions\//);
  await expect(page.getByTestId('hero-amount')).toContainText('350.000');
  await page.goBack();
  await expect(page.getByTestId('bill-history')).toContainText('paid');

  // Undo payment asks once, then the month is no longer paid.
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await page.getByTestId('bill-history').getByRole('button', { name: /bill/ }).click();
  await sheet.getByRole('button', { name: 'Undo payment' }).click();
  await expect(page.getByTestId('bill-history')).toHaveCount(0);
  expect(asked).toHaveLength(1);
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pay', exact: true })).toBeVisible();
});

test('on a phone: declining the Undo payment confirm keeps the month paid', async ({ page }) => {
  const history = await paidGym(page);
  page.once('dialog', (dialog) => void dialog.dismiss());
  await history.getByRole('button', { name: /bill/ }).click();
  await page.getByRole('dialog', { name: /^Gym · / }).getByRole('button', { name: 'Undo payment' }).click();
  await expect(history).toContainText('paid');
});

test('on a phone: a skipped month still opens Unskip next to a paid one', async ({ page }) => {
  await paidGym(page);
  // The payment settled this month; skip the next one ahead.
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Skip' }).click();
  const history = page.getByTestId('bill-history');
  await expect(history.getByText('Skipped')).toHaveCount(1);
  await history.getByRole('button', { name: /bill/ }).filter({ hasText: 'Skipped' }).click();
  await expect(page.getByRole('dialog', { name: /bill · skipped$/ }).getByRole('button', { name: 'Unskip' })).toBeVisible();
});
