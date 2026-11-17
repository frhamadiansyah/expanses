import { expect, test } from '@playwright/test';
import { walletCard } from './accounts';
import { openAssets } from './drawers';
import { mockRates, openWithPockets } from './pockets';
import { currencyRow, setCurrency } from './currency-field';

test('by thumb: open the account, a pocket, and move between pockets one key at a time', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, {
    name: 'Valas Plus',
    pockets: [
      { currency: 'USD', balance: '2400.00', rate: '16250' },
      { currency: 'SGD', balance: '1150.00' },
    ],
  });
  await walletCard(page, 'Valas Plus').tap();
  await expect(page.getByTestId('pocket-USD')).toContainText('39.000.000');
  await page.getByRole('link', { name: 'Move', exact: true }).tap();
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await expect(page.getByText(/Exchange (loss|gain)/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Move', exact: true }).tap();
  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
  // No page scrolls sideways at 390px except the Accounts table's own scroller.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('by thumb: Move is one box — From/To above the currencies, each balance above its figure, a light 0 before typing, the receipt’s Rate with no ⓘ (layout E)', async ({ page }) => {
  // Invented: £1.500 at 21.000, Rp 5.000.000; £1.000 out, Rp 20.700.000 in.
  await mockRates(page, { GBP: 21_000 });
  await openWithPockets(page, {
    name: 'Valas Plus',
    pockets: [
      { currency: 'GBP', balance: '1500.00', rate: '21000' },
      { currency: 'IDR', balance: '5000000' },
    ],
  });
  await walletCard(page, 'Valas Plus').tap();
  await page.getByRole('link', { name: 'Move', exact: true }).tap();
  await expect(page.getByRole('heading', { name: /^(From|To)$/ })).toHaveCount(0);
  const fromButton = page.getByRole('button', { name: 'From, British Pound' });
  const toButton = page.getByRole('button', { name: 'To, Indonesian Rupiah' });
  await expect(fromButton).toHaveText('FromBritish Pound');
  await expect(toButton).toHaveText('ToIndonesian Rupiah');
  // Each balance on its own above the figure, no word; no "available" caption anywhere.
  const fromBalance = page.getByText('£1.500,00', { exact: true });
  const toBalance = page.getByText('Rp 5.000.000', { exact: true });
  await expect(fromBalance).toBeVisible();
  await expect(toBalance).toBeVisible();
  await expect(page.getByText(/available/)).toHaveCount(0);
  const leaves = page.getByLabel('Leaves GBP');
  const arrives = page.getByLabel('Arrives IDR');
  // Before typing: a light zero in each currency's own cents.
  await expect(leaves).toHaveAttribute('placeholder', '0,00');
  await expect(arrives).toHaveAttribute('placeholder', '0');
  await expect(page.getByRole('button', { name: 'About Rate' })).toHaveCount(0);
  // The balance sits above its figure, "From" above the currency.
  const top = async (l: typeof leaves) => (await l.boundingBox())!;
  expect((await top(fromBalance)).y + (await top(fromBalance)).height).toBeLessThanOrEqual((await top(leaves)).y + 1);
  expect((await top(toBalance)).y + (await top(toBalance)).height).toBeLessThanOrEqual((await top(arrives)).y + 1);
  // The ⇅ on the hairline clears all four lines next to it.
  const swapBox = (await page.getByRole('button', { name: 'Swap' }).boundingBox())!;
  for (const line of [fromButton.getByText('British Pound'), leaves, toButton.getByText('To', { exact: true }), toBalance]) {
    const b = await top(line);
    const apart = b.y + b.height <= swapBox.y + 0.5 || b.y >= swapBox.y + swapBox.height - 0.5;
    expect(apart).toBe(true);
  }
  await leaves.pressSequentially('1000');
  await expect(leaves).toHaveValue('1.000');
  await arrives.pressSequentially('20700000');
  await expect(arrives).toHaveValue('20.700.000');
  await arrives.blur();
  await expect(leaves).toHaveValue('1.000,00');
  await expect(page.getByText('Rp 20.700 per GBP', { exact: true })).toBeVisible();
  // The ⇅ sits inside the one box, between the two pockets.
  const box = await page.getByRole('button', { name: 'From, British Pound' }).locator('xpath=ancestor::section[1]').boundingBox();
  const swap = await page.getByRole('button', { name: 'Swap' }).boundingBox();
  expect(swap!.y).toBeGreaterThan(box!.y);
  expect(swap!.y + swap!.height).toBeLessThan(box!.y + box!.height);
  await page.getByRole('button', { name: 'Move', exact: true }).tap();
  await expect(page.getByTestId('pocket-GBP')).toContainText('500,00');
  await expect(page.getByTestId('pocket-IDR')).toContainText('25.700.000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the account page reads in the dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Night Valas', pockets: [{ currency: 'USD', balance: '10.00', rate: '16250' }, { currency: 'SGD', balance: '10.00' }] });
  await walletCard(page, 'Night Valas').tap();
  const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(ground).not.toBe('rgb(255, 255, 255)');
});

test('by thumb: add a pocket, then see the account once on Assets at its ≈ total', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Thumb Valas', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  // Two rows and nothing under them, on a phone too.
  await expect(page.getByText(/across 1 account/)).toHaveCount(0);
  await walletCard(page, 'Thumb Valas').tap();
  await page.getByRole('button', { name: /^Add (a )?currency$/ }).first().tap();
  await setCurrency(currencyRow(page), 'IDR');
  await page.getByLabel('Opening IDR').pressSequentially('5400000');
  await page.getByRole('dialog', { name: 'Add a currency' }).getByRole('button', { name: 'Add', exact: true }).tap();
  await expect(page.getByTestId('pocket-IDR')).toContainText('5.400.000');
  await openAssets(page);
  const row = page.getByRole('link', { name: /^Thumb Valas/ });
  // One line: the name and the ≈ total, no pocket count (a pocketed account opens to its pockets).
  await expect(row).not.toContainText('pocket');
  await expect(row).toContainText('58.982.000');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a saving account names its bank and itself on one row, and typing the bank offers Indonesian banks', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  const bank = page.getByLabel('Bank', { exact: true });
  await bank.fill('jen');
  await page.getByRole('listbox', { name: 'Banks' }).getByRole('option', { name: 'Bank SMBC Indonesia' }).click();
  await expect(bank).toHaveValue('Bank SMBC Indonesia');
  await expect(page.getByRole('listbox', { name: 'Banks' })).toHaveCount(0);
  // A bank not on the list is kept as typed.
  await bank.fill('Bank Kecil');
  await page.getByLabel('Name', { exact: true }).fill('Emergency');
  await expect(bank).toHaveValue('Bank Kecil');
});

test('by thumb: the Move page swaps the pockets and picks one from the sheet', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, {
    name: 'Valas Plus',
    pockets: [
      { currency: 'USD', balance: '2400.00', rate: '16250' },
      { currency: 'SGD', balance: '1150.00' },
      { currency: 'IDR', balance: '5400000' },
    ],
  });
  await walletCard(page, 'Valas Plus').tap();
  await page.getByRole('link', { name: 'Move', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'From, US Dollar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'To, Singapore Dollar' })).toBeVisible();
  await page.getByRole('button', { name: 'Swap' }).tap();
  await expect(page.getByRole('button', { name: 'From, Singapore Dollar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'To, US Dollar' })).toBeVisible();
  await page.getByRole('button', { name: /^To, / }).tap();
  await page.getByRole('dialog').getByRole('button', { name: /^Indonesian Rupiah, / }).tap();
  await expect(page.getByRole('button', { name: 'To, Indonesian Rupiah' })).toBeVisible();
  await page.getByLabel('Leaves SGD').pressSequentially('100');
  await page.getByLabel('Arrives IDR').pressSequentially('1268000');
  await page.getByRole('button', { name: 'Move', exact: true }).tap();
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.050,00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
