import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset, pastPurchase } from './add-asset';
import { chooseInvestment } from './add-transaction';
import { openDrawers } from './drawers';
import { bbcaAt, openBroker } from './listed-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function seed(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
}

test('phone: Trade keeps Net worth on the bar, has Buy and Sell tabs, and the + leaves it for the Add form', async ({ page }) => {
  await seed(page);
  await page.goto('/net-worth');
  await page.getByRole('link', { name: 'Trade', exact: true }).first().click();

  const bar = page.getByRole('navigation', { name: 'Main' });
  const form = page.getByRole('form', { name: 'Trade' });
  await expect(form).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Net worth' })).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('link', { name: 'Transactions' })).not.toHaveAttribute('aria-current', 'page');

  // Buy shows Paid with, Sell Received into, as Expense and Income do; the tabs are the Add form's control, with no Expense / Income / Transfer.
  await expect(page.getByText('Trade', { exact: true }).first()).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Expense' })).toHaveCount(0);
  // Opens on Buy, as Add opens on Expense; the holding is not chosen, and every row is there.
  await expect(form.getByRole('radio', { name: 'Buy' })).toBeChecked();
  await expect(form.getByRole('radio', { name: 'Sell' })).not.toBeChecked();
  await expect(form.getByLabel('Investment')).toBeVisible();
  await expect(form.getByText('Units are recorded')).toHaveCount(0);
  // The holding is chosen by hand: the row names none yet while every other row is already there.
  await expect(form.getByRole('button', { name: 'Investment' })).not.toContainText('Bought');
  await expect(form.getByLabel('Payment method')).toBeVisible();
  await chooseInvestment(form, { index: 0 });
  await expect(form.getByLabel('Payment method')).toBeVisible();
  await expect(form.getByText('A credit card works')).toHaveCount(0);
  await expect(form.getByText('Units are recorded')).toHaveCount(0);
  await expect(form.getByLabel('Received into')).toHaveCount(0);
  await form.getByRole('radio', { name: 'Sell' }).click();
  await expect(form.getByRole('radio', { name: 'Sell' })).toBeChecked();
  await expect(form.getByLabel('Received into')).toBeVisible();
  await expect(form.getByLabel(/^Proceeds, before fees/)).toBeVisible();
  await expect(form.getByLabel('Payment method')).toHaveCount(0);
  await form.getByRole('radio', { name: 'Buy' }).click();
  await expect(form.getByLabel('Payment method')).toBeVisible();

  // The + opens the normal Add form on Expense, with the three tabs and no trade rows.
  await bar.getByRole('button', { name: 'Add a transaction' }).click();
  const add = page.getByRole('form', { name: 'Add a transaction' });
  await expect(add).toBeVisible();
  await expect(page).not.toHaveURL(/mode=trade/);
  await expect(add.getByRole('radio', { name: 'Expense' })).toBeChecked();
  await expect(add.getByRole('radio', { name: 'Income' })).toBeVisible();
  await expect(add.getByRole('radio', { name: 'Transfer' })).toBeVisible();
  await expect(add.getByRole('radio', { name: 'Buy' })).toHaveCount(0);
  await expect(add.getByLabel('Investment')).toHaveCount(0);
  await expect(bar.getByRole('link', { name: 'Transactions' })).toHaveAttribute('aria-current', 'page');
});

test('phone: a share kept at a broker pays from, and is paid into, that broker on the Trade page', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '8000000');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await seed(page);
  await page.goto('/net-worth');
  await page.getByRole('link', { name: 'Trade', exact: true }).first().click();
  const form = page.getByRole('form', { name: 'Trade' });
  await form.getByRole('radio', { name: 'Buy' }).click();
  await chooseInvestment(form, 'BBCA · Stockbit Sekuritas');
  // The broker's cash is already chosen: nothing to pick.
  await expect(form.getByLabel('Payment method')).toContainText('Stockbit Sekuritas');
  // A holding with no broker lets it go: the Stockbit cash does not stay stuck on Paid with.
  await chooseInvestment(form, 'Antam gold bars');
  await expect(form.getByLabel('Payment method')).not.toContainText('Stockbit Sekuritas');
  await chooseInvestment(form, 'BBCA · Stockbit Sekuritas');
  await expect(form.getByLabel('Payment method')).toContainText('Stockbit Sekuritas');
  await form.getByRole('radio', { name: 'Sell' }).click();
  await expect(form.getByLabel('Received into')).toContainText('Stockbit Sekuritas');
});
