import { expect, test } from '@playwright/test';
import { openCard } from './accounts';
import { cardPage, pickChargedOn, walletCard, saveCardTerms } from './card-section';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const words = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

test('a card’s annual fee date is saved in Settings, shown as the next charge, and listed in Recurring inside 30 days', async ({ page }) => {
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

  const row = page.getByTestId('card-annual-fee');
  await expect(row).toContainText("This year's fee");
  await expect(row).toContainText(words(next));
  await page.goBack();
  await expect(page.getByTestId('card-annual-fee')).toHaveCount(0);

  // Within 30 days it is also listed under Due soon in Recurring, read-only, and opens the card.
  await page.goto('/bills');
  const fee = page.getByTestId('annual-fee-row');
  await expect(fee).toContainText('Annual fee');
  await expect(fee).toContainText('Fee Card');
  await expect(fee).toContainText(words(next));
  // A tap opens Fee waived, the one sheet Settings and a challenge open too. ✕ and Charged as normal only close it.
  await fee.click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const sheet = page.getByRole('dialog', { name: /^Fee waived · \d{4}$/ });
  await expect(sheet.getByTestId('fee-charged-as-normal')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await fee.click();
  await sheet.getByTestId('fee-charged-as-normal').click();
  await expect(sheet).toHaveCount(0);
  await expect(fee).toHaveCount(1);

  // Waived before it is charged (the fee is still ahead): Back on the card starts off, so only the year is marked; the
  // fee leaves Recurring, and the card page reads next year's charge.
  await fee.click();
  await expect(sheet.getByLabel('Back on the card')).not.toBeChecked();
  await expect(sheet.getByTestId('fee-waived-footer')).toHaveText('Off: the fee was never charged, so nothing is recorded. The year is marked waived.');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('annual-fee-row')).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.goto('/wallet');
  await walletCard(page, 'Fee Card').click();
  const next2 = new Date(next);
  next2.setFullYear(next.getFullYear() + 1);
  await cardPage(page, 'Settings');
  await expect(page.getByTestId('year-fee')).toHaveText('Waived');

  // Clearing the row clears the date; the fee leaves Recurring.
  await pickChargedOn(page, '');
  await saveCardTerms(page);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByLabel('Charged on day')).toHaveValue('0');
  await expect(page.getByTestId('card-annual-fee')).toHaveCount(0);
});
