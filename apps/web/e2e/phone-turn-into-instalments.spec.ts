import { expect, test } from '@playwright/test';
import { openCard, walletCard } from './accounts';
import { addTransaction, choosePayment } from './add-transaction';
import { openNewAsset } from './add-asset';
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

  // The row opens the plan's page, which says how it counts — the app decides it, there is no switch.
  await page.goto(`/transactions?month=${bought.month}`);
  await page.getByTestId('transaction-row').filter({ hasText: 'Laptop' }).click();
  await page.getByTestId('receipt-instalments').click();
  await expect(page.getByTestId('instalment-plan-page')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Count spending' })).toHaveCount(0);
  await expect(page.getByTestId('plan-counting')).toContainText(/Counts Rp\s2\.000\.000 a month as Groceries spending/);
});

/*
 * An investment bought with the card (TF 139): a bond bought today on the card, turned into 6 months. Its instalments are
 * card repayments: billed on the statement, never spending. First billed is set to this month, so its first instalment
 * is on the statement open now.
 */
test('a bond bought with the card turned into 6: the statement bills 1 of 6, Cashflow spends nothing on it', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openCard(page, { name: 'Mitra Visa' });
  await page.goto('/wallet');
  await walletCard(page, 'Mitra Visa').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);

  await openNewAsset(page, 'Government bonds');
  await page.getByLabel('Name', { exact: true }).fill('ORI031');
  await page.getByLabel('Par value', { exact: true }).fill('6000000');
  await page.getByLabel('Purchase value', { exact: true }).fill('6000000');
  await page.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'Mitra Visa', 'Paid with');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  // The buy's receipt, opened from the card's statement (Cashflow lists no buy): the Instalments row, None, beside Open holding.
  await page.goto('/wallet');
  await walletCard(page, 'Mitra Visa').click();
  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: /^Actions for .*ORI031/ }).first().click();
  await page.getByRole('button', { name: 'Open receipt' }).click();
  const row = page.getByTestId('receipt-instalments');
  await expect(row).toContainText('None');
  await row.click();
  const sheet = page.getByRole('dialog', { name: 'Turn into instalments' });
  await sheet.getByRole('radio', { name: '6', exact: true }).click();
  const month = new Date().toISOString().slice(0, 7);
  await sheet.getByLabel('First billed').fill(month);
  await expect(sheet).toContainText(/An investment: Rp\s1\.000\.000 a month counts as saving, not spending/);
  await sheet.getByTestId('turn-into-save').click();
  await expect(sheet).toHaveCount(0);
  await expect(row).toContainText(/6 × Rp\s1\.000\.000/);
  // Never spread: no "counts Rp 0" on it.
  await expect(page.getByTestId('spread-caption')).toHaveCount(0);

  // The plan's page says it is saving: an investment is never spending.
  await row.click();
  await expect(page.getByTestId('plan-counting')).toContainText(/Investment: Rp\s1\.000\.000 a month counts as saving, not spending\./);
  await expect(page.getByRole('radiogroup', { name: 'Count spending' })).toHaveCount(0);

  // The statement bills it like any instalment.
  await page.goto('/wallet');
  await walletCard(page, 'Mitra Visa').click();
  await cardPage(page, 'Statement');
  await expect(page.getByTestId('statement-line').filter({ hasText: 'ORI031' }).getByTestId('instalment-pill')).toContainText('1 of 6');

  // Cashflow: no row for it at all — saving is neither money in nor out (owner 2026-11-16); the statement lists it.
  await page.goto('/transactions');
  await expect(page.getByTestId('transaction-row').first().or(page.getByText('No transactions in this period.'))).toBeVisible();
  await expect(page.getByTestId('instalment-row')).toHaveCount(0);
});
