import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { openNewAsset } from './add-asset';
import { addTransfer } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addBank(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
}

async function addGold(page: Page) {
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await page.getByLabel('Bought on').fill('2024-02-03');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (IDR)').fill('13100000');
  await page.getByRole('button', { name: 'Add another purchase' }).click();
  await page.getByLabel('Bought on').nth(1).fill('2026-03-09');
  await page.getByLabel('How much').nth(1).fill('5');
  await page.getByLabel('Total cost (IDR)').nth(1).fill('9300000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
}

test('records past purchases without touching the bank balance', async ({ page }) => {
  await addBank(page);
  await addGold(page);

  // Cost of both purchases, no price yet.
  await expect(page.getByText(/22\.400\.000/).first()).toBeVisible();
  await expect(page.getByText(/50\.000\.000/).first()).toBeVisible();
});

test('buys, sells, and works out the gain at average cost', async ({ page }) => {
  await addBank(page);
  await addGold(page);

  // The sections are behind the corner's `…` on Net worth now, each a screen of its own.
  await page.goto('/net-worth');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Buy & sell' }).click();
  await expect(page.getByRole('heading', { name: 'Buy & sell' })).toBeVisible();

  await page.getByLabel('What happened').selectOption('buy');
  await page.getByLabel('Units, shares or grams').fill('2');
  await page.getByLabel('What it cost, before fees (IDR)').fill('3980000');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/Recorded\./)).toBeVisible();

  // 17 g cost Rp 26.380.000, so average cost is Rp 1.551.764 a gram.
  await expect(page.getByText(/26\.380\.000/).first()).toBeVisible();

  await page.getByLabel('What happened').selectOption('sell');
  await page.getByLabel('Units, shares or grams').fill('5');
  await page.getByLabel('Proceeds, before fees (IDR)').fill('9000000');
  await expect(page.getByText(/Gives up/)).toBeVisible();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/Recorded\./)).toBeVisible();

  // 12 g left of the 17 g held.
  await expect(page.getByText('12 g').first()).toBeVisible();
});

test('updates a price from the assets list and shows the new value', async ({ page }) => {
  await addBank(page);
  await addGold(page);

  await page.getByRole('button', { name: 'Update prices' }).click();
  await page.getByLabel(/Antam gold bars/).fill('1842000');
  await page.getByRole('button', { name: 'Save prices' }).click();

  // 15 g at Rp 1.842.000 a gram.
  await expect(page.getByText(/27\.630\.000/).first()).toBeVisible();
});

async function openSettings(page: Page, name: string) {
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).first().click();
  await page.getByRole('main').getByRole('link', { name: 'Settings' }).click();
}

test('renames an account from its settings page, and every list reads the new name', async ({ page }) => {
  await addBank(page);
  await openSettings(page, 'BCA Tahapan');

  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan Utama');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/net-worth/assets');
  await expect(page.getByRole('link', { name: /BCA Tahapan Utama/ })).toBeVisible();
});

test('an account opened by mistake deletes, armed on the first tap; one with entries refuses and says why', async ({ page }) => {
  await addBank(page);
  await openAccount(page, { subtype: 'savings', name: 'Jenius', balance: '0' });
  // A third account, opened and never touched again: this one can go.
  await openAccount(page, { subtype: 'savings', name: 'Hana', balance: '1000000' });
  // One transfer in, and Jenius is no longer an account that was only opened.
  await page.goto('/transactions');
  await addTransfer(page, { from: 'BCA Tahapan', to: 'Jenius (IDR)', amount: '5000000' });

  await openSettings(page, 'Jenius');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page.getByRole('alert')).toContainText('has entries of its own');

  // The one that was only opened goes, opening entry and all.
  await openSettings(page, 'Hana');
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await expect(page.getByRole('link', { name: /Hana/ })).toHaveCount(0);
});

test('sends trade edits to Buy & sell instead of the transaction form', async ({ page }) => {
  await addBank(page);
  await addGold(page);

  // A buy dated today, so it lands in the month the Transactions page opens on.
  await page.goto('/net-worth');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Buy & sell' }).click();
  await page.getByLabel('Units, shares or grams').fill('2');
  await page.getByLabel('What it cost, before fees (IDR)').fill('3980000');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/Recorded\./)).toBeVisible();

  await page.goto('/transactions');
  await expect(page.getByText('Bought 2 Antam gold bars')).toBeVisible();
  const row = page.locator('li', { hasText: 'Bought 2 Antam gold bars' }).last();
  await expect(row.getByRole('link', { name: 'Buy & sell' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});
