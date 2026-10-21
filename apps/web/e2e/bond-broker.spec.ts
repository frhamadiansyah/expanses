import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset } from './add-asset';
import { openDrawers } from './drawers';
import { addHoldingFlow } from './securities';

test('a government bond is held at a bank as readily as at a broker, or at a place typed by name', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '1000000' });
  await openNewAsset(page, 'Government bonds');
  await page.getByLabel('Name', { exact: true }).fill('Retail bond');
  await fillDay(page, 'Bought', '2026-02-10');
  await page.getByLabel('Par value', { exact: true }).fill('1000000');
  await page.getByLabel('Purchase value', { exact: true }).fill('1000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await openDrawers(page);
  await page.getByRole('link', { name: /Retail bond/ }).click();

  // Held at, not Broker: banks sell bonds too.
  await expect(page.getByLabel('Broker', { exact: true })).toHaveCount(0);
  const held = page.getByLabel('Held at', { exact: true });
  await held.selectOption({ label: 'BCA Tahapan' });
  await expect(held.locator('option:checked')).toHaveText('BCA Tahapan');
  // Held at a bank, that bank is the tax report's Nama institusi unless another name is typed.
  await page.getByRole('main').getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Nama institusi' })).toHaveAttribute('placeholder', 'BCA Tahapan');
  await page.goBack();

  await held.selectOption({ label: 'Somewhere not in the app' });
  await page.getByLabel('Place name', { exact: true }).fill('Bank Mandiri');
  await page.getByLabel('Place name', { exact: true }).blur();
  await page.reload();
  await expect(page.getByLabel('Place name', { exact: true })).toHaveValue('Bank Mandiri');
});

test('a share’s Broker row opens a broker not yet in the app, by name, and keeps the share there', async ({ page }) => {
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '1', price: '8.750' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await page.getByRole('link', { name: 'Stockbit', exact: true }).click();

  const broker = page.getByLabel('Broker', { exact: true });
  await broker.selectOption({ label: 'Another broker…' });
  const sheet = page.getByRole('dialog', { name: 'New broker' });
  await sheet.getByLabel('Broker name').fill('Ajaib');
  await sheet.getByRole('button', { name: 'Add broker' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(broker.locator('option:checked')).toHaveText('Ajaib');
});
