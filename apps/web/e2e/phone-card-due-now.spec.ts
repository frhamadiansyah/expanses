import { expect, test } from '@playwright/test';
import { openAccount, openCard, walletCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, saveCardTerms, showCardBack } from './card-section';
import { pickView } from './wallet';

/** Where to keep the two screens for comparing with the mockup, when asked for. */
const shots = process.env.DUE_NOW_SHOTS;

/** The day of a month this many months back, in YYYY-MM-DD, and its month. */
function monthsAgo(months: number, day: number): { date: string; month: string } {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day));
  return { date: at.toISOString().slice(0, 10), month: at.toISOString().slice(0, 7) };
}

/*
 * Wallet and the card's back count only what is due now (owner, 17 Nov 2026; mockup 2026-11-17-instalments-wallet,
 * Wallet option 2 and card back B). Invented: BCA Tahapan Rp 6.000.000; BCA Visa, limit Rp 30.000.000, a Rp 12.000.000
 * laptop bought on the 10th of last month and turned into 6 × Rp 2.000.000 (statement on the month's last day, so the
 * first instalment is billed this month), and Rp 500.000 of groceries. Owed in full 12.500.000; instalments not billed
 * yet 10.000.000; due now 2.500.000.
 */
test('Wallet and the card’s back show what is due now, the instalments not billed yet named under the bar; Net worth keeps the whole debt', async ({ page }) => {
  const bought = monthsAgo(1, 10);
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '6000000' });
  await openCard(page, { name: 'BCA Visa' });
  await page.goto('/wallet');
  await walletCard(page, 'BCA Visa').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Credit limit').fill('30000000');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Laptop', paidWith: 'BCA Visa', category: 'Groceries', amount: '12000000', date: bought.date, paidOff: false });
  await addTransaction(page, { description: 'Groceries', paidWith: 'BCA Visa', category: 'Groceries', amount: '500000' });

  // The laptop turned into 6 months from its receipt.
  await page.goto(`/transactions?month=${bought.month}`);
  await page.getByTestId('transaction-row').filter({ hasText: 'Laptop' }).click();
  await page.getByTestId('receipt-instalments').click();
  const sheet = page.getByRole('dialog', { name: 'Turn into instalments' });
  await sheet.getByRole('radio', { name: '6', exact: true }).click();
  await sheet.getByTestId('turn-into-save').click();
  await expect(sheet).toHaveCount(0);

  // Wallet's grid: Outstanding on cards is what is due now, and the Balance follows it.
  await page.goto('/wallet');
  await pickView(page, 'Grid');
  const box = page.getByTestId('wallet-balance');
  await expect(box.getByRole('button', { name: /^Outstanding on cards/ })).toContainText(/-Rp\s2\.500\.000/);
  await expect(box.getByRole('button', { name: /^Spending money/ })).toContainText(/Rp\s6\.000\.000/);
  await expect(box).toContainText(/Rp\s3\.500\.000/);
  await expect(box).not.toContainText('Owed on cards');
  await expect(box).not.toContainText('12.500.000');
  // The card's tile: due now too.
  await expect(walletCard(page, 'BCA Visa')).toHaveAccessibleName(/2\.500\.000/);
  if (shots) await page.screenshot({ path: `${shots}/due-now-wallet.png` });

  // The card's back: Outstanding is due now; the line under the bar names the instalments in place of the limit.
  await walletCard(page, 'BCA Visa').click();
  await showCardBack(page);
  await expect(page.getByTestId('tile-figure-label')).toHaveText('Outstanding');
  await expect(page.getByTestId('tile-unpaid-balance')).toHaveText(/^Rp\s2\.500\.000$/);
  await expect(page.getByTestId('card-available')).toHaveText(/^Rp\s17\.500\.000 available · Rp\s10\.000\.000 in instalments$/);
  await expect(page.getByTestId('limit-bar')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/due-now-back.png` });

  // Net worth still counts the whole debt.
  await page.goto('/net-worth');
  await expect(page.getByTestId('sheet-total-liabilities')).toContainText('12.500.000');
  await expect(page.getByTestId('net-worth')).toContainText('6.500.000');
});
