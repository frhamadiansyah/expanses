import { expect, test } from '@playwright/test';
import { openCard } from './accounts';
import { cardPage, pickChargedOn, walletCard, saveCardTerms } from './card-section';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const words = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

test('a card’s annual fee date is saved in Settings, listed in Recurring inside 30 days, and its fee year is recorded on the Fee waiver page', async ({ page }) => {
  // Ten days ahead, entered as the date it was charged two years ago: the next charge is the one ahead.
  const next = new Date();
  next.setDate(next.getDate() + 10);
  const entered = new Date(next);
  entered.setFullYear(next.getFullYear() - 2);

  await openCard(page, { name: 'Fee Card', statementDay: '25', dueDay: '12' });
  // The fee row is Settings' now, not the card page's.
  await expect(page.getByTestId('card-annual-fee')).toHaveCount(0);

  await cardPage(page, 'Settings');
  await expect(page.getByTestId('card-annual-fee')).toHaveCount(0);
  await page.getByLabel('Annual fee').fill('500000');
  await pickChargedOn(page, iso(entered));
  await saveCardTerms(page);
  // The save is written out to storage a moment after it is made; a reload straight away would beat it.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByLabel('Charged on day')).toHaveValue(String(entered.getDate()));
  await expect(page.getByLabel('Charged on month')).toHaveValue(String(entered.getMonth() + 1));

  // Settings keeps three rows: Annual fee, Charged on, Fee waiver. No program and nothing settled: None.
  await expect(page.getByTestId('card-annual-fee')).toHaveCount(0);
  await expect(page.getByTestId('fee-waiver-row')).toContainText('None');
  await page.goBack();

  // Within 30 days it is also listed under Due soon in Recurring, read-only; a tap opens the card's Fee waiver page.
  await page.goto('/bills');
  const fee = page.getByTestId('annual-fee-row');
  await expect(fee).toContainText('Annual fee');
  await expect(fee).toContainText('Fee Card');
  await expect(fee).toContainText(words(next));
  await fee.click();
  await expect(page).toHaveURL(/\/settings\/fee-waiver$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The coming charge, within 30 days: Pending, its date with no year (the fee year's own), and the fee.
  const pending = page.getByTestId('fee-line-pending');
  await expect(pending.getByTestId('fee-line-pending-value')).toHaveText(`${next.getDate()} ${MONTHS[next.getMonth()]} · Rp 500.000`);

  // Waived before it is charged: ⋮ → Waived, not charged. No money moves; the fee leaves Recurring.
  await pending.click();
  await expect(page.getByTestId('fee-menu').getByRole('button')).toHaveText(['Add the charge', 'Waived, not charged', 'Cancel']);
  await page.getByTestId('fee-menu-waived').click();
  await expect(page.getByTestId('fee-line-waived-value')).toHaveText('not charged · Rp 500.000');
  await page.goto('/bills');
  await expect(page.getByTestId('annual-fee-row')).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.goto('/wallet');
  await walletCard(page, 'Fee Card').click();
  await cardPage(page, 'Settings');
  await expect(page.getByTestId('fee-waiver-row')).toContainText(`${next.getFullYear()} waived`);

  // ⋮ on Waived → Reset asks first; Cancel keeps it, Reset makes it pending again.
  await page.getByTestId('fee-waiver-row').click();
  await page.getByTestId('fee-line-waived').click();
  await expect(page.getByTestId('fee-menu').getByRole('button')).toHaveText(['Reset', 'Cancel']);
  await page.getByTestId('fee-menu-reset').click();
  const confirm = page.getByRole('alertdialog', { name: 'Reset?' });
  await expect(confirm).toContainText('The fee reads as pending again.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('fee-line-waived')).toBeVisible();
  await page.getByTestId('fee-line-waived').click();
  await page.getByTestId('fee-menu-reset').click();
  await page.getByTestId('fee-reset-confirm').click();
  await expect(page.getByTestId('fee-line-pending')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('fee-waiver-row')).toContainText('None');

  // Clearing the row clears the date; the fee leaves Recurring.
  await pickChargedOn(page, '');
  await saveCardTerms(page);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByLabel('Charged on day')).toHaveValue('0');
  await expect(page.getByTestId('annual-fee-row')).toHaveCount(0);
});
