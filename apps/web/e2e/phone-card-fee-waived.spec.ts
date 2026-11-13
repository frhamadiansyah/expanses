import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { iso, openWalletCard, setFee } from './card-spend-bonus';
import { cardPage, showCardBack } from './card-section';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The fee year on the Fee waiver page, on a phone (owner, 13 Nov 2026). Its lines come from the card's own
 * transactions; ⋮ on a line opens a few plain choices. The owner's case (build 118): the fee was charged before the
 * app, so its line says so once the reversal is in, and the reversal is left out of reports. Names and figures are
 * invented.
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

/** "15 Oct" in the fee year the line is about, "2 Feb 2027" in another. */
const lineDate = (d: Date, feeYear: number) => `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === feeYear ? '' : ` ${d.getFullYear()}`}`;

test('phone: the charge before the app, then the reversal: Charged reads before the app, the card owes less, and Settings reads waived', async ({ page }) => {
  const charged = await cardWithPastFee(page, 'Nusa Sample', '3000000');
  const year = charged.getFullYear();
  await expect(page.getByTestId('fee-waiver-row')).toContainText('None');
  await page.getByTestId('fee-waiver-row').click();

  // Nothing recorded: Pending. The charge is in the starting balance, so it is never added again, only reversed.
  const pending = page.getByTestId('fee-line-pending');
  await expect(pending.getByTestId('fee-line-pending-value')).toHaveText(`${lineDate(charged, year)} · Rp 1.200.000`);
  await pending.click();
  await expect(page.getByTestId('fee-menu').getByRole('button')).toHaveText(['Waived, not charged', 'Add reversal', 'Cancel']);
  await page.getByTestId('fee-menu-add-reversal').click();
  const sheet = page.getByRole('dialog', { name: 'Add reversal' });
  await expect(sheet.getByLabel('Amount')).toHaveValue('1.200.000');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);

  await expect(page.getByTestId('fee-line-charged-before-app-value')).toHaveText(`${lineDate(charged, year)} · before the app`);
  await expect(page.getByTestId('fee-line-reversal-value')).toHaveText(`${lineDate(new Date(), year)} · Rp 1.200.000`);
  await page.screenshot({ path: test.info().outputPath('before-the-app.png') });
  await page.goBack();
  await expect(page.getByTestId('fee-waiver-row')).toContainText(`${year} waived`);
  await page.waitForTimeout(800);

  // The card's balance rose by the reversal.
  await openWalletCard(page, 'Nusa Sample');
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toContainText('1.800.000');
});

test('phone: the charge not on the card yet: ⋮ → Add the charge posts it on its day, and Settings reads charged', async ({ page }) => {
  const charged = await cardWithPastFee(page, 'Nusa Sample');
  const year = charged.getFullYear();
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('fee-line-pending').click();
  // No program: the fee is likely charged, so Add the charge comes first.
  await expect(page.getByTestId('fee-menu').getByRole('button')).toHaveText(['Add the charge', 'Waived, not charged', 'Cancel']);
  await page.getByTestId('fee-menu-add-charge').click();
  const sheet = page.getByRole('dialog', { name: 'Add the charge' });
  await expect(sheet.getByLabel('Amount')).toHaveValue('1.200.000');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  const line = page.getByTestId('fee-line-charged');
  await expect(line.getByTestId('fee-line-charged-value')).toHaveText(`${lineDate(charged, year)} · Rp 1.200.000`);
  // ⋮ on Charged: Add reversal and Open the charge, which opens its receipt.
  await line.click();
  await expect(page.getByTestId('fee-menu').getByRole('button')).toHaveText(['Add reversal', 'Open the charge', 'Cancel']);
  await page.getByTestId('fee-menu-open-charge').click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await page.goBack();
  await page.goBack();
  await expect(page.getByTestId('fee-waiver-row')).toContainText(`${year} charged`);
  await page.waitForTimeout(800);

  await openWalletCard(page, 'Nusa Sample');
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toContainText('1.200.000');
});

test('phone: Waived, not charged moves no money; Reset asks, then the fee reads as pending again', async ({ page }) => {
  await cardWithPastFee(page, 'Nusa Sample');
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('fee-line-pending').click();
  await page.getByTestId('fee-menu-waived').click();
  await expect(page.getByTestId('fee-line-waived-value')).toHaveText('not charged · Rp 1.200.000');
  await page.waitForTimeout(800);

  await openWalletCard(page, 'Nusa Sample');
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toHaveText('Rp 0');
  await expect(page.getByTestId('tile-credit')).toHaveCount(0);

  await cardPage(page, 'Settings');
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('fee-line-waived').click();
  await page.getByTestId('fee-menu-reset').click();
  const confirm = page.getByRole('alertdialog', { name: 'Reset?' });
  await expect(confirm).toContainText('The fee reads as pending again.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('fee-line-waived')).toBeVisible();
  await page.getByTestId('fee-line-waived').click();
  await page.getByTestId('fee-menu-reset').click();
  await page.getByTestId('fee-reset-confirm').click();
  await expect(page.getByTestId('fee-line-pending')).toBeVisible();
});
