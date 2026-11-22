import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { iso, openWalletCard, setFee } from './card-spend-bonus';
import { cardPage, showCardBack } from './card-section';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/*
 * A reversed fee is left out (owner, 22 Nov 2026, option 1 of docs/mockups/2026-11-22-fee-same-everywhere.html): on
 * every card the fee and its reversal read Rp 0 with ⊘ in Cashflow, as if the fee was never charged. Sample One was in
 * the app when its fee came, so its fee has a row; Sample Two was added after, so its fee is in its starting balance,
 * and the app adds the fee as a row of its own beside the reversal, paid off before the app.
 * Names and figures are invented.
 */

/** A card whose annual fee was charged 38 days ago (entered as last year's date), on its Settings; `owed` opens it today. */
async function cardWithPastFee(page: Page, name: string, owed?: string) {
  await openCard(page, { name, statementDay: '31', dueDay: '15', ...(owed ? { owed } : {}) });
  const charged = new Date();
  charged.setDate(charged.getDate() - 38);
  const entered = new Date(charged);
  entered.setFullYear(charged.getFullYear() - 1);
  await openWalletCard(page, name);
  await setFee(page, '1200000', iso(entered));
  return charged;
}

const lineDate = (d: Date, feeYear: number) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === feeYear ? '' : ` ${d.getFullYear()}`}`;
const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Saves the Add reversal or Add the charge sheet as it opens: the card's fee, on its own day. */
async function saveSheet(page: Page, name: 'Add reversal' | 'Add the charge') {
  const sheet = page.getByRole('dialog', { name });
  await expect(sheet.getByLabel('Amount')).toHaveValue('1.200.000');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
}

const shots = process.env.FEE_SHOTS_DIR;

test('phone: a reversed fee is left out on every card — the fee and both reversals read Rp 0 ⊘, and the fee page reads the fee', async ({ page }) => {
  // Sample One: the charge on the card, then its reversal.
  const charged = await cardWithPastFee(page, 'Sample One');
  const year = charged.getFullYear();
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('fee-line-pending').click();
  await page.getByTestId('fee-menu-add-charge').click();
  await saveSheet(page, 'Add the charge');
  await page.getByTestId('fee-line-charged').click();
  await page.getByTestId('fee-menu-add-reversal').click();
  await saveSheet(page, 'Add reversal');
  await expect(page.getByTestId('fee-line-charged-value')).toHaveText(`${lineDate(charged, year)} · Rp 1.200.000`);
  await page.waitForTimeout(800);

  // Sample Two: added after its fee, so only the reversal is added; the app adds the fee beside it on its own day, and
  // its fee lines read the same as Sample One's.
  await cardWithPastFee(page, 'Sample Two', '3000000');
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('fee-line-pending').click();
  await page.getByTestId('fee-menu-add-reversal').click();
  await saveSheet(page, 'Add reversal');
  await expect(page.getByTestId('fee-line-charged-value')).toHaveText(`${lineDate(charged, year)} · Rp 1.200.000`);
  await expect(page.getByTestId('fee-line-reversal-value')).toHaveText(`${lineDate(new Date(), year)} · Rp 1.200.000`);
  if (shots) await page.screenshot({ path: `${shots}/fee-page-before-app.png` });
  // Open the charge opens the fee row the app added.
  await page.getByTestId('fee-line-charged').click();
  await page.getByTestId('fee-menu-open-charge').click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await expect(page.getByTestId('excluded-note')).toContainText('Annual fee reversed');
  await page.waitForTimeout(800);

  // What Sample Two owes is its starting balance less the reversal: the fee row added changes nothing.
  await openWalletCard(page, 'Sample Two');
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toContainText('1.800.000');
  // Its statement shows the reversal settled on its own.
  await cardPage(page, 'Statement');
  await expect(page.getByTestId('statement-fee-settled').first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/statement-before-app.png` });

  // This month: both reversals grey, Rp 0 with the fee under it; nothing counted.
  await page.goto('/transactions');
  const reversals = page.getByTestId('transaction-row').filter({ hasText: 'Annual fee reversal' });
  await expect(reversals).toHaveCount(2);
  for (const row of await reversals.all()) {
    await expect(row.getByLabel(/^Excluded from report, Rp.1\.200\.000$/)).toBeVisible();
    await expect(row).toContainText(/Rp.0(?![\d.])/);
  }
  await expect(page.getByTestId('spending-report').getByTestId('period-total')).toHaveText('Rp 0');
  if (shots) await page.screenshot({ path: `${shots}/cashflow-reversals.png` });

  // The fee's month: both cards' fees grey too, and the month's spending without them.
  await page.goto(`/transactions?month=${monthOf(charged)}`);
  const fees = page.getByTestId('transaction-row').filter({ hasText: 'Annual fee' });
  await expect(fees).toHaveCount(2);
  for (const row of await fees.all()) await expect(row.getByLabel(/^Excluded from report, Rp.1\.200\.000$/)).toBeVisible();
  await expect(page.getByTestId('spending-report').getByTestId('period-total')).toHaveText('Rp 0');
  if (shots) await page.screenshot({ path: `${shots}/cashflow-fee.png` });

  // A receipt says why.
  await fees.first().getByRole('button', { name: /^Membership fee/ }).click();
  await expect(page.getByTestId('excluded-note')).toContainText('Annual fee reversed');
  if (shots) await page.screenshot({ path: `${shots}/receipt-fee.png` });
});

test('phone: delete the reversal and the fee counts again', async ({ page }) => {
  const charged = await cardWithPastFee(page, 'Sample One');
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('fee-line-pending').click();
  await page.getByTestId('fee-menu-add-charge').click();
  await saveSheet(page, 'Add the charge');
  await page.getByTestId('fee-line-charged').click();
  await page.getByTestId('fee-menu-add-reversal').click();
  await saveSheet(page, 'Add reversal');
  await page.waitForTimeout(800);

  await page.goto(`/transactions?month=${monthOf(charged)}`);
  await expect(page.getByTestId('spending-report').getByTestId('period-total')).toHaveText('Rp 0');

  // The reversal, opened from the fee page, deleted from its receipt.
  await openWalletCard(page, 'Sample One');
  await cardPage(page, 'Settings');
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('fee-line-reversal').click();
  await page.getByTestId('fee-menu-open-reversal').click();
  await page.getByRole('button', { name: 'Delete this transaction', exact: true }).click();
  await page.getByRole('button', { name: 'Click again to delete', exact: true }).click();
  await page.waitForTimeout(800);

  await page.goto(`/transactions?month=${monthOf(charged)}`);
  await expect(page.getByTestId('spending-report').getByTestId('period-total')).toHaveText('Rp 1.200.000');
  const fee = page.getByTestId('transaction-row').filter({ hasText: 'Annual fee' });
  await expect(fee).toHaveCount(1);
  await expect(fee.getByLabel(/^Excluded from report/)).toHaveCount(0);
});
