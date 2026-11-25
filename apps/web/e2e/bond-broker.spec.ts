import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset, pastPurchase } from './add-asset';
import { openDrawers } from './drawers';
import { institutionRow, setInstitution } from './fund-trade';
import { addHoldingFlow } from './securities';

test('a government bond held at a bank names the bank under Other place, its tax Nama institusi', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '1000000' });
  await openNewAsset(page, 'Government bonds');
  await page.getByLabel('Name', { exact: true }).fill('Retail bond');
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2026-02-10');
  await page.getByLabel('Par value', { exact: true }).fill('1000000');
  await page.getByLabel('Purchase value', { exact: true }).fill('1000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await openDrawers(page);
  await page.getByRole('link', { name: /Retail bond/ }).click();

  // Held at, not Broker: banks sell bonds too.
  await expect(page.getByLabel('Broker', { exact: true })).toHaveCount(0);
  // A bank has no account a bond links to: its name is typed under Other place.
  await setInstitution(page, { other: 'Bank BCA' });
  // Held at a bank, that bank is the tax report's Nama institusi: one name, kept once.
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Institution', exact: true })).toHaveValue('Bank BCA');
  await page.goBack();

  await setInstitution(page, { other: 'Bank Mandiri' });
  await page.reload();
  await expect(institutionRow(page)).toContainText('Bank Mandiri');
});

test('a share’s Broker row opens a broker not yet in the app, by name, and keeps the share there', async ({ page }) => {
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '1', price: '8.750' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  // Held at one broker, the stock opens that holding's own page straight away.
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/]+$/);
  // A share's broker is in its Settings, not in the Details of its page.
  await expect(page.getByLabel('Broker', { exact: true })).toHaveCount(0);
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();

  const broker = page.getByLabel('Broker', { exact: true });
  await broker.selectOption({ label: 'Another broker…' });
  const sheet = page.getByRole('dialog', { name: 'New broker' });
  await sheet.getByLabel('Broker name').fill('Ajaib');
  await sheet.getByRole('button', { name: 'Add broker' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(broker.locator('option:checked')).toHaveText('Ajaib');
  // The name follows the broker.
  await expect(page.getByRole('main')).toContainText('BBCA · Ajaib');
});
