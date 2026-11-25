import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';

/*
 * Bills that repeat every few weeks (owner's mockup, 25 Nov 2026): a prepaid electricity token, Rp 1.000.000 roughly
 * every 3 weeks — 3 Nov, 24 Nov, then 15 Dec and 5 Jan. Invented bank and figures. The browser's clock stands on
 * Wed 25 Nov 2026.
 */

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-11-25T10:00:00'));
});

async function addToken(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '20000000', opened: '2026-10-01' });
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Electricity');
  await page.getByLabel('Amount', { exact: true }).fill('1000000');
  await pickBillCategory(page, 'Electricity');
  await pickBillPaidFrom(page, 'Bank Contoh');
  await page.getByLabel('Repeats').selectOption({ label: 'Every few weeks' });
  // Every N weeks from a start day: no Bill date, no Due by, no month, no sinking fund.
  await expect(page.getByLabel('Every', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Bill date')).toHaveCount(0);
  await expect(page.getByLabel('Due by')).toHaveCount(0);
  await expect(page.getByLabel('Starting')).toHaveCount(0);
  await expect(page.getByText('Sinking fund')).toHaveCount(0);
  await expect(page.getByTestId('weekly-bill-note')).toHaveText('The next one is counted from the last payment, so paying early or late moves the rest with it.');
  await page.getByLabel('Starts on').fill('2026-11-03');
  await shot(page, 'form-new');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}

async function payOn(page: Page, day: string) {
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pay' }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay Electricity' });
  // Paid for the day it is paid: no month to choose, none to skip.
  await expect(sheet.getByLabel('For')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Skip this month' })).toHaveCount(0);
  await sheet.getByLabel('Paid on').fill(day);
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(sheet).toHaveCount(0);
}

test('a bill every 3 weeks: two payments in November, each on its day, and the next ones counted from the last', async ({ page }) => {
  await addToken(page);
  const bill = page.getByTestId('bill-row').filter({ hasText: 'Electricity' });
  await expect(bill).toBeVisible();
  await bill.click();
  await expect(page.getByRole('heading', { name: 'Electricity' })).toBeVisible();
  // No month's bill, nothing to skip or pause.
  const actions = page.getByRole('group', { name: 'Actions' });
  await expect(actions.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await expect(actions.getByRole('button', { name: 'Pause' })).toHaveCount(0);
  await expect(page.getByTestId('bill-hero')).toContainText('Every 3 weeks');
  await expect(page.getByTestId('bill-date-next')).toContainText('Tue, 3 Nov');
  await expect(page.getByTestId('bill-date-next')).toContainText('Overdue · 22 days');

  await payOn(page, '2026-11-03');
  await payOn(page, '2026-11-24');

  await expect(page.getByTestId('bill-status')).toHaveText(/^≈ Rp\s?1\.448\.000 a month · next 15 Dec$/);
  await expect(page.getByTestId('bill-date-after')).toContainText('Tue, 5 Jan');
  await expect(page.getByTestId('bill-date-after')).toContainText('3 weeks after 15 Dec');
  await expect(page.getByTestId('bill-date-next')).toContainText('Tue, 15 Dec');
  await expect(page.getByTestId('bill-date-next')).toContainText('Due · in 20 days');
  const paid = page.getByTestId('bill-date-paid');
  await expect(paid).toHaveCount(2);
  await expect(paid.nth(0)).toContainText('Tue, 24 Nov');
  await expect(paid.nth(0)).toContainText('Paid · Bank Contoh');
  await expect(paid.nth(1)).toContainText('Tue, 3 Nov');
  // Neither of the two November payments is "paid twice".
  await expect(page.getByText(/paid twice/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss' }).click().catch(() => undefined);
  await shot(page, 'bill-page');

  // A payment opens as a paid month does: undone, the next one is 3 weeks after 3 Nov again.
  await paid.nth(0).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Undo payment' }).click();
  await expect(paid).toHaveCount(1);
  await expect(page.getByTestId('bill-date-next')).toContainText('Tue, 24 Nov');
  await expect(page.getByTestId('bill-date-next')).toContainText('Overdue · 1 day');
});

test('Edit bill reads a bill by weeks back as it was saved', async ({ page }) => {
  await addToken(page);
  await page.getByTestId('bill-row').filter({ hasText: 'Electricity' }).click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Repeats')).toHaveValue('weeks');
  await expect(page.getByLabel('Every', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Starts on')).toHaveValue('2026-11-03');
  await page.getByLabel('Every', { exact: true }).selectOption('2');
  await shot(page, 'form-edit');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('bill-hero')).toContainText('Every 2 weeks');
  await expect(page.getByTestId('bill-date-after')).toContainText('2 weeks after 3 Nov');
});
