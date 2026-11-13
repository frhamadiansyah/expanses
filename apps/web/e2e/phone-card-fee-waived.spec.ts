import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { iso, openWalletCard, setFee } from './card-spend-bonus';
import { cardPage, showCardBack } from './card-section';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Fee waived, the one way (option A, 2026-11-12), from Settings' This year's fee on a phone. The owner's case (build
 * 118): the fee was charged and paid before the app was used, so no charge is recorded, and the old Waived wrote the
 * year and refunded nothing without a word. Names and figures are invented.
 */

/** A card with no purchases whose annual fee was charged 38 days ago (entered as last year's date), on its Settings. */
async function cardWithPastFee(page: Page, name: string) {
  await openCard(page, { name, statementDay: '31', dueDay: '15' });
  const charged = new Date();
  charged.setDate(charged.getDate() - 38);
  const entered = new Date(charged);
  entered.setFullYear(charged.getFullYear() - 1);
  await openWalletCard(page, name);
  await setFee(page, '1200000', iso(entered));
  return charged;
}

const feeSheet = (page: Page) => page.getByRole('dialog', { name: /^Fee waived · \d{4}$/ });

test('phone: Settings with no fee charge recorded: the money back goes on the card, which shows the credit, and the row reads Waived', async ({ page }) => {
  const charged = await cardWithPastFee(page, 'Nusa Sample');
  const year = charged.getFullYear();
  await expect(page.getByTestId('year-fee')).toContainText(String(year));

  // A tap opens the sheet straight away: no alert in front of it.
  await page.getByTestId('card-annual-fee').click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const sheet = feeSheet(page);
  await expect(sheet).toHaveAccessibleName(`Fee waived · ${year}`);
  // The charge has happened: Back on the card is on, the amount is the card's fee, and the sheet says before the tap
  // that the charge is not in the app.
  await expect(sheet.getByLabel('Back on the card')).toBeChecked();
  await expect(sheet.getByTestId('fee-charge')).toHaveCount(0);
  await expect(sheet.getByLabel('Amount')).toHaveValue('1.200.000');
  await expect(sheet.getByLabel('Came back on')).toBeVisible();
  const footer = sheet.getByTestId('fee-waived-footer');
  await expect(footer).toHaveText(
    `The ${charged.getDate()} ${MONTHS[charged.getMonth()]} charge is not in the app, so this records only the money coming back. The card goes Rp 1.200.000 into credit.`,
  );
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/fee-waived-no-charge.png' });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);

  // Undo from the toast takes it all back.
  await expect(page.getByRole('status').filter({ hasText: `Fee waived for ${year}` })).toBeVisible();
  await expect(page.getByTestId('year-fee')).toHaveText('Waived');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('year-fee')).not.toHaveText('Waived');

  // Again, kept.
  await page.getByTestId('card-annual-fee').click();
  await feeSheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('year-fee')).toHaveText('Waived');
  await expect(page.getByText(/^Next charge /)).toHaveCount(0);
  await page.waitForTimeout(800);

  // The card owes nothing and holds the fee as credit.
  await openWalletCard(page, 'Nusa Sample');
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toHaveText('Rp 0');
  await expect(page.getByTestId('tile-credit')).toHaveText('Credit Rp 1.200.000');
});

test('phone: switched off, the fee was never charged: only the year is marked; the row opens what was recorded, with Reset', async ({ page }) => {
  const charged = await cardWithPastFee(page, 'Nusa Sample');
  await page.getByTestId('card-annual-fee').click();
  const sheet = feeSheet(page);
  await sheet.getByLabel('Back on the card').click();
  await expect(sheet.getByLabel('Back on the card')).not.toBeChecked();
  await expect(sheet.getByLabel('Amount')).toHaveCount(0);
  await expect(sheet.getByTestId('fee-waived-footer')).toHaveText('Off: the fee was never charged, so nothing is recorded. The year is marked waived.');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('year-fee')).toHaveText('Waived');
  await page.waitForTimeout(800);

  // Nothing was posted: no credit on the card.
  await openWalletCard(page, 'Nusa Sample');
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toHaveText('Rp 0');
  await expect(page.getByTestId('tile-credit')).toHaveCount(0);

  // Tapped again, the row shows what was recorded and offers Reset; once confirmed, the sheet asks again.
  await cardPage(page, 'Settings');
  await page.getByTestId('card-annual-fee').click();
  const recorded = feeSheet(page);
  await expect(recorded).toContainText('Year marked waived');
  await recorded.getByTestId('fee-waived-undo').click();
  // Reset asks first: Cancel keeps the year waived, Reset takes it back.
  const confirm = page.getByRole('alertdialog', { name: /^Reset the \d{4} fee\?$/ });
  await expect(confirm).toContainText('The fee reads as charged again.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(recorded).toContainText('Year marked waived');
  await recorded.getByTestId('fee-waived-undo').click();
  await page.getByTestId('fee-reset-confirm').click();
  await expect(recorded.getByLabel('Back on the card')).toBeVisible();
  await recorded.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('year-fee')).toContainText(String(charged.getFullYear()));
  await expect(page.getByTestId('year-fee')).not.toHaveText('Waived');
});
