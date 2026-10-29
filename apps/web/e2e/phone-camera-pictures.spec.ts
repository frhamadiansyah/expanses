import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment } from './add-transaction';
import { screenshotFiles, setStatementImages, walletListLines } from './statement';

/* Invented names and figures throughout. */
const LIST = [
  ['Noodle Stall', 'TRX20260919A1B2C3', '19 Sep 2026 12:31', '−Rp41.000', 'Wallet balance'],
  ['Tea Shop', 'TRX20260915N4P5Q6', '15 Sep 2026 08:10', '−Rp9.000', 'Wallet balance'],
] as const;

test('several pictures from the Amount camera ask what they are, and Read as a list opens the picker with the form’s account first', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2026-09-20T12:00:00'));
  await openAccount(page, { subtype: 'bank', name: 'Bank Dua', balance: '500000' });
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet Satu', balance: '500000' });
  await page.goto('/transactions/new');
  const form = addForm(page);
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'Dompet Satu');

  await setStatementImages(page, [walletListLines(LIST), [], []]);
  await page.getByTestId('amount-photo-input').setInputFiles(screenshotFiles(3));
  const sheet = page.getByRole('dialog', { name: '3 pictures' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('pictures-thumbs').locator('img')).toHaveCount(3);
  await expect(sheet.getByRole('button', { name: 'Attach to this purchase' })).toBeVisible();
  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/camera-sheet.png` });

  await sheet.getByRole('button', { name: 'Read as a list of transactions' }).click();
  await expect(page.getByRole('heading', { name: 'Which account?' })).toBeVisible();
  const first = page.getByTestId('statement-account').first();
  await expect(first).toContainText('Dompet Satu');
  await expect(first).toContainText('on the form');
  await expect(page.getByTestId('statement-account')).toHaveCount(2);
  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/camera-picker.png` });

  await first.click();
  await expect(page.getByRole('heading', { name: 'Dompet Satu statement' })).toBeVisible();
  await expect(page.getByTestId('list-headline')).toContainText('2 rows read');
});

test('Attach to this purchase keeps the pictures as the purchase’s photos, and one picture never asks', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Dua', balance: '500000' });
  await page.goto('/transactions/new');
  await page.getByTestId('amount-photo-input').setInputFiles(screenshotFiles(2));
  const sheet = page.getByRole('dialog', { name: '2 pictures' });
  await sheet.getByRole('button', { name: 'Attach to this purchase' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/transactions\/new/);

  await page.goto('/transactions/new');
  await page.getByTestId('amount-photo-input').setInputFiles(screenshotFiles(1));
  await expect(page.getByRole('dialog', { name: /pictures$/ })).toHaveCount(0);
});
