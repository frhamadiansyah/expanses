import { expect, test } from '@playwright/test';
import { expectWalletFigure, openAccount } from './accounts';

test('the list glyph is on the new expense and the page works at desktop width', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '1000000' });
  await page.goto('/transactions/new');
  await page.getByRole('button', { name: 'Paste a list', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/paste/);
  await page.getByLabel('Purchases').fill('kopi susu 12k\nbakso 20.000');
  await page.getByRole('button', { name: 'Review 2' }).click();
  await expect(page.getByTestId('review-total')).toContainText('32.000');
  await page.getByRole('button', { name: 'Save list' }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByTestId('toast')).toHaveText('Added 2 purchases');
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '968.000');
});

test('the glyph is not on an income or an edit', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '1000000' });
  await page.goto('/transactions/new');
  await expect(page.getByRole('button', { name: 'Paste a list', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Income' }).click();
  await expect(page.getByRole('button', { name: 'Paste a list', exact: true })).toHaveCount(0);
});
