import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addBank(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('50000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

async function addGold(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('gold');
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

  // The net-worth tabs are the kit's segmented control now: a radio group, not a row of links.
  await page.getByRole('radio', { name: 'Buy & sell' }).click();
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

test('sends trade edits to Buy & sell instead of the transaction form', async ({ page }) => {
  await addBank(page);
  await addGold(page);

  // A buy dated today, so it lands in the month the Transactions page opens on.
  await page.getByRole('radio', { name: 'Buy & sell' }).click();
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
