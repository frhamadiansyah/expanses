import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { openNewAsset, pastPurchase, pickNewAsset } from './add-asset';
import { choosePayment } from './add-transaction';
import { expectBalance } from './deposit-maturity';
import { openDrawers } from './drawers';
import { todayIn } from './today';

/*
 * Add asset's New purchase (owner, 13 Nov 2026): a holding added as bought now records its buy with it, paid from an
 * account or charged to a card — the same as adding it empty and buying it from Trade. Invented figures throughout.
 */
test('phone: a bond bought now on a card is added with its purchase, and the card owes it', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'Mitra Giro', balance: '20000000' });
  await openAccount(page, { subtype: 'credit_card', name: 'Mitra Visa', balance: '0' });

  await openNewAsset(page, 'Government bonds');
  await page.getByLabel('Name', { exact: true }).fill('ORI031');
  // A holding opens on New purchase, dated today.
  await expect(page.getByRole('radio', { name: 'New purchase' })).toBeChecked();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(await todayIn(page));
  await page.getByLabel('Par value', { exact: true }).fill('5000000');
  await page.getByLabel('Purchase value', { exact: true }).fill('5000000');
  await page.getByLabel('Fee', { exact: true }).fill('15000');
  // Paid with is the account sheet Trade's Buy opens, cards and all.
  await page.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'Mitra Visa', 'Payment method');
  await expect(page.getByText('Paid with a card: the card owes it now')).toBeVisible();
  await page.getByLabel('Category for points').selectOption({ index: 1 });
  await page.getByLabel('MCC', { exact: true }).fill('6211');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  // Held, not folded away under Sold.
  await expect(page.getByRole('button', { name: /sold holdings/ })).toHaveCount(0);
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /^ORI031/ })).toBeVisible();
  // The card owes the purchase and its fee; the bank never moved.
  await expectBalance(page, 'Mitra Visa', '5.015.000');
  await expectBalance(page, 'Mitra Giro', '20.000.000');
});

test('phone: a holding added with no past purchase is held at nothing, not Sold', async ({ page }) => {
  await openNewAsset(page, 'Government bonds');
  await page.getByLabel('Name', { exact: true }).fill('SBR015');
  await pastPurchase(page);
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await expect(page.getByRole('button', { name: /sold holdings/ })).toHaveCount(0);
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /^SBR015/ })).toBeVisible();
});

test('phone: Trade’s Investment sheet lists holdings by kind and ends with New investment, which adds and buys one', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'Mitra Giro', balance: '20000000' });
  await openNewAsset(page, 'Government bonds');
  await page.getByLabel('Name', { exact: true }).fill('SBR015');
  await pastPurchase(page);
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);

  await page.goto('/net-worth');
  await page.getByRole('link', { name: 'Trade', exact: true }).first().click();
  const form = page.getByRole('form', { name: 'Trade' });
  await form.getByRole('button', { name: /^Investment/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Investment' });
  await expect(sheet.getByRole('region', { name: 'Bonds' }).getByRole('button', { name: 'SBR015', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'New investment' }).click();

  // Add asset, on New purchase: saving records the buy, then opens the new holding's page — no second trade.
  await expect(page).toHaveURL(/\/net-worth\/assets\/new\?from=trade$/);
  await pickNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await expect(page.getByRole('radio', { name: 'New purchase' })).toBeChecked();
  await page.getByLabel('How much', { exact: true }).fill('2');
  await page.getByLabel('Cost', { exact: true }).fill('3000000');
  await page.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'Mitra Giro', 'Payment method');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/?]+$/);
  await expect(page.getByText('Value now')).toBeVisible();
  await expectBalance(page, 'Mitra Giro', '17.000.000');
});
