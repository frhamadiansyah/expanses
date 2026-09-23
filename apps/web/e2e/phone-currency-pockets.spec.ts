import { expect, test } from '@playwright/test';
import { mockRates, openWithPockets } from './pockets';

test('by thumb: open the account, a pocket, and move between pockets one key at a time', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, {
    name: 'Valas Plus',
    pockets: [
      { currency: 'USD', balance: '2400.00', rate: '16250' },
      { currency: 'SGD', balance: '1150.00' },
    ],
  });
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).tap();
  await expect(page.getByTestId('pocket-USD')).toContainText('39.000.000');
  await page.getByRole('link', { name: /Move between pockets/ }).tap();
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await expect(page.getByTestId('spread')).toContainText('35.160');
  await page.getByRole('button', { name: 'Move it' }).tap();
  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
  // No page scrolls sideways at 390px except the Accounts table's own scroller.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the account page reads in the dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Night Valas', pockets: [{ currency: 'USD', balance: '10.00', rate: '16250' }, { currency: 'SGD', balance: '10.00' }] });
  await page.getByRole('link', { name: 'Night Valas', exact: true }).tap();
  const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(ground).not.toBe('rgb(255, 255, 255)');
});

test('by thumb: add a pocket, then see the account once on Assets at its ≈ total', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Thumb Valas', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  await expect(page.getByText(/across 1 account · 2 currencies/)).toBeVisible();
  await page.getByRole('link', { name: 'Thumb Valas', exact: true }).tap();
  await page.getByRole('link', { name: /Add a pocket/ }).tap();
  await page.getByLabel('Currency', { exact: true }).selectOption('IDR');
  await page.getByLabel('Opening IDR').pressSequentially('5400000');
  await page.getByRole('button', { name: 'Add pocket' }).tap();
  await expect(page.getByTestId('pocket-IDR')).toContainText('5.400.000');
  await page.goto('/net-worth/assets');
  const row = page.getByRole('link', { name: /^Thumb Valas/ });
  await expect(row).toContainText('3 pockets');
  await expect(row).toContainText('58.982.000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
