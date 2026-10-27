import { expect, test } from '@playwright/test';
import { openAccount, openSettings, walletCard } from './accounts';
import { mockRates, openWithPockets } from './pockets';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const VALAS = {
  name: 'Valas Plus',
  bank: 'Bank One',
  shown: 'Bank One Valas Plus',
  pockets: [
    { currency: 'USD', balance: '2400.00', rate: '16250' },
    { currency: 'SGD', balance: '1150.00' },
  ],
};

test('a single-currency bank account asks Bank › name, Group and Description', async ({ page }) => {
  await openAccount(page, { subtype: 'savings', name: 'Plain Saver', balance: '1000000', shown: 'Plain Saver' });
  await walletCard(page, 'Plain Saver').click();
  await openSettings(page);
  await expect(page.getByLabel('Bank', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Plain Saver');
  await expect(page.getByLabel('Group', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Description/ })).toBeVisible();
});

test('an account with pockets is asked as a plain one is, and its pockets point back to it', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await walletCard(page, VALAS.shown).click();
  await openSettings(page);

  // The account: Bank › name with an ⓘ for the pockets, then Group and Description. No sentence under the rows.
  await expect(page.getByLabel('Bank', { exact: true })).toHaveValue('Bank One');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Valas Plus');
  await expect(page.getByLabel('Group', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Description/ })).toBeVisible();
  await expect(page.getByText('Renaming it renames its pockets.')).toHaveCount(0);
  await page.getByRole('button', { name: 'About Bank and name' }).click();
  await expect(page.getByText('Renaming it renames its pockets.')).toBeVisible();

  // A pocket: its currency and a way to its account; nothing of the account's.
  await page.goBack();
  await page.getByTestId('pocket-USD').click();
  await openSettings(page);
  await expect(page.getByLabel('Bank', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Group', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Description/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Tax code/ })).toContainText('0102');
  await expect(page.getByLabel('For spending')).toBeVisible();
  await page.getByRole('button', { name: /^Account/ }).click();

  // The account's page opened: renaming there renames how the pocket is shown.
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Valas Plus');
  await page.getByLabel('Name', { exact: true }).fill('Valas Max');
  await page.getByLabel('Bank', { exact: true }).fill('Bank Two');
  // The row saves as focus leaves it (Save does that); a reload must not cut the write short.
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(1000);
  // Back on the pocket's settings, which have no Name of their own.
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
  await page.goto('/wallet');
  await expect(walletCard(page, 'Bank Two Valas Max')).toBeVisible();
  await walletCard(page, 'Bank Two Valas Max').click();
  await page.getByTestId('pocket-USD').click();
  await expect(page.getByRole('main').getByText('Bank Two Valas Max · USD').first()).toBeVisible();
});
