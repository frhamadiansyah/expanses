import { expect, test } from '@playwright/test';
import { openCard, walletCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, saveCardTerms } from './card-section';

/** The day of a month this many months back, in YYYY-MM-DD, and its month. */
function monthsAgo(months: number, day: number): { date: string; month: string } {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day));
  return { date: at.toISOString().slice(0, 10), month: at.toISOString().slice(0, 7) };
}

/*
 * Turn into instalments from the purchase itself (owner, 16 Nov 2026, option A). Invented: a laptop of Rp 12.000.000 on
 * the BCA Visa on the 10th of last month; statement on the month's last day, so it is on last month's statement and the
 * first instalment is billed this month.
 */
test('a card purchase turned into 6 months: 1 of 6 in Cashflow the next month, Rp 0 on the purchase day', async ({ page }) => {
  const bought = monthsAgo(1, 10);
  await openCard(page, { name: 'BCA Visa' });
  await page.goto('/wallet');
  await walletCard(page, 'BCA Visa').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Laptop', paidWith: 'BCA Visa', category: 'Groceries', amount: '12000000', date: bought.date });

  // Its receipt has an Instalments row, None until the purchase is turned.
  await page.goto(`/transactions?month=${bought.month}`);
  await page.getByTestId('transaction-row').filter({ hasText: 'Laptop' }).click();
  const row = page.getByTestId('receipt-instalments');
  await expect(row).toContainText('None');
  await row.click();

  const sheet = page.getByRole('dialog', { name: 'Turn into instalments' });
  await expect(sheet).toContainText('Laptop');
  await expect(sheet).toContainText('12.000.000');
  await sheet.getByRole('radio', { name: '6', exact: true }).click();
  await expect(sheet).toContainText(/Rp\s2\.000\.000/);
  // No Count spending here: a plan made from the purchase always counts each month.
  await expect(sheet.getByRole('radiogroup', { name: 'Count spending' })).toHaveCount(0);
  await expect(sheet).toContainText('counts as spending in each month from');
  await sheet.getByTestId('turn-into-save').click();
  await expect(sheet).toHaveCount(0);

  // The purchase says it is spread, and its row names the plan.
  await expect(page.getByTestId('spread-caption')).toContainText(/Spread over 6 months · counts Rp\s0 now/);
  await expect(row).toContainText(/6 × Rp\s2\.000\.000/);

  // Cashflow the month it was bought: listed, counting Rp 0, and its day adds nothing.
  await page.goto(`/transactions?month=${bought.month}`);
  const purchase = page.getByTestId('transaction-row').filter({ hasText: 'Laptop' });
  await expect(purchase).toContainText(/counts Rp\s0 now/);
  // A day that comes to nothing draws no total.
  await expect(page.getByTestId('day-total')).toHaveCount(0);

  // This month: the first instalment, 1 of 6, as spending.
  await page.goto('/transactions');
  const instalment = page.getByTestId('instalment-row').filter({ hasText: 'Laptop' });
  await expect(instalment).toContainText('1 of 6');
  await expect(instalment).toContainText(/2\.000\.000/);

  // The row opens the plan's page, which keeps the Count spending switch.
  await page.goto(`/transactions?month=${bought.month}`);
  await page.getByTestId('transaction-row').filter({ hasText: 'Laptop' }).click();
  await page.getByTestId('receipt-instalments').click();
  await expect(page.getByTestId('instalment-plan-page')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Count spending' })).toBeVisible();
});
