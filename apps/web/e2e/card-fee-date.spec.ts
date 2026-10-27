import { expect, test } from '@playwright/test';
import { openCard } from './accounts';
import { cardPage, walletCard, saveCardTerms } from './card-section';

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
  await expect(page.getByTestId('card-annual-fee')).toHaveCount(0);

  await cardPage(page, 'Settings');
  await page.getByLabel('Annual fee (IDR)').fill('500000');
  await page.getByLabel('Charged on').fill(iso(entered));
  await saveCardTerms(page);
  // The save is written out to storage a moment after it is made; a reload straight away would beat it.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByLabel('Charged on')).toHaveValue(iso(entered));
  await page.goBack();

  const row = page.getByTestId('card-annual-fee');
  await expect(row).toContainText('Annual fee');
  await expect(row).toContainText(words(next));

  // Within 30 days it is also listed under Due soon in Recurring, read-only, and opens the card.
  await page.goto('/bills');
  const fee = page.getByTestId('annual-fee-row');
  await expect(fee).toContainText('Annual fee');
  await expect(fee).toContainText('Fee Card');
  await expect(fee).toContainText(words(next));
  // A tap asks whether it was waived. Not now and Charged as normal only close the question.
  await fee.click();
  const alert = page.getByRole('alertdialog');
  await expect(alert).toContainText('Annual fee');
  await expect(alert.getByRole('button', { name: 'Waived' })).toBeVisible();
  await alert.getByRole('button', { name: 'Not now' }).click();
  await expect(alert).toHaveCount(0);
  await fee.click();
  await alert.getByRole('button', { name: 'Charged as normal' }).click();
  await expect(alert).toHaveCount(0);
  await expect(fee).toHaveCount(1);

  // Waived (the fee was never recorded in the app, so only the mark is set): it leaves Recurring, and the card page
  // reads next year's charge.
  await fee.click();
  await alert.getByRole('button', { name: 'Waived' }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByTestId('annual-fee-row')).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.goto('/wallet');
  await walletCard(page, 'Fee Card').click();
  const next2 = new Date(next);
  next2.setFullYear(next.getFullYear() + 1);
  await expect(page.getByTestId('card-annual-fee')).toContainText(`Waived this year · next charge ${words(next2)}`);

  // Clearing the row clears the date; the fee leaves Recurring.
  await cardPage(page, 'Settings');
  await page.getByLabel('Charged on').fill('');
  await saveCardTerms(page);
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByLabel('Charged on')).toHaveValue('');
  await page.goBack();
  await expect(page.getByTestId('card-annual-fee')).not.toContainText('next charge');
});
