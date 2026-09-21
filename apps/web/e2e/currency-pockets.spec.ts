import { expect, test } from '@playwright/test';
import { mockRates, openWithPockets } from './pockets';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const VALAS = {
  name: 'Valas Plus',
  bank: 'Bank One',
  pockets: [
    { currency: 'USD', balance: '2400.00', rate: '16250' },
    { currency: 'SGD', balance: '1150.00' }, // blank: resolved from the (mocked) daily rate
    { currency: 'IDR', balance: '5400000' },
  ],
};

test('an account with pockets is one row that adds them up, and opens to each pocket', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);

  // P1: one row, the converted total, no pocket rows of their own.
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Valas Plus', exact: true }) });
  await expect(row).toContainText('3 pockets');
  await expect(row).toContainText('58.982.000');
  await expect(page.getByRole('link', { name: 'Valas Plus · USD' })).toHaveCount(0);

  await row.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('2.400,00');
  await expect(page.getByTestId('pocket-USD')).toContainText('39.000.000');
  await expect(page.getByTestId('pocket-SGD')).toContainText('14.582.000');
  // Nothing converted beneath the base-currency pocket.
  await expect(page.getByTestId('pocket-IDR')).not.toContainText('≈');

  // A pocket is an ordinary account page: its code, the rate it opened at, and back to its account.
  await page.getByTestId('pocket-USD').click();
  await expect(page.getByText('Opened at 16.250 IDR per 1 USD')).toBeVisible();
  // Its kode harta: the code lives in the settings' Tax report code box, whose value getByText cannot see.
  await expect(page.getByLabel('Tax report code')).toHaveValue('0102');
  await page.getByRole('link', { name: 'Valas Plus' }).first().click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});

test('a single-currency account is exactly what it was', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Dollar Saver');
  await page.getByLabel('Balance now').pressSequentially('1800.00');
  // Exact: "Holds more than one currency" is on this form too.
  await page.getByLabel('Currency', { exact: true }).selectOption('USD');
  await page.getByLabel(/^Rate: IDR per 1 USD$/).pressSequentially('15720');
  await page.getByRole('button', { name: 'Add account' }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Dollar Saver', exact: true }) });
  await expect(row).toContainText('1.800,00');
  await expect(row).not.toContainText('pockets');
});

test('a pocket can be added, in a currency with no decimals, at a typed rate', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Add a pocket/ }).click();
  // Currencies it already has are not offered.
  await expect(page.getByLabel('Currency').locator('option[value="USD"]')).toHaveCount(0);
  await page.getByLabel('Currency').selectOption('JPY');
  await page.getByLabel('Opening JPY').pressSequentially('30000');
  await page.getByLabel('Rate: IDR per 1 JPY').pressSequentially('108,3');
  await page.getByRole('button', { name: 'Add pocket' }).click();
  // ¥30.000, not ¥300: JPY has no decimals.
  await expect(page.getByTestId('pocket-JPY')).toContainText('30.000');
  await expect(page.getByTestId('pocket-JPY')).toContainText('3.249.000');
});
