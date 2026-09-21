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

test('moving between pockets moves what the screen shows and says what the bank’s rate cost', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Move between pockets/ }).click();

  // Options are valued by currency code (one open pocket per currency); `selectOption({ label })` takes no RegExp.
  await page.getByLabel('From').selectOption('USD');
  await page.getByLabel('To').selectOption('SGD');
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await expect(page.getByText('1 USD = 1,2760 SGD')).toBeVisible();
  await expect(page.getByText('The bank’s rate cost you')).toBeVisible();
  await expect(page.getByTestId('spread')).toContainText('35.160');
  await page.getByRole('button', { name: 'Move it' }).click();

  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
});

test('the Money tile adds every account and pocket at today’s rates', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await expect(page.getByText(/across 1 account · 3 currencies/)).toBeVisible();
  // Twice: the tile and the account's own row. Without the tile it is once.
  await expect(page.getByText(/58\.982\.000/)).toHaveCount(2);
});

test('net worth’s Assets list shows the account once, at the ≈ total, and opens to its pockets', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.goto('/net-worth/assets');
  await expect(page.getByRole('link', { name: /Valas Plus · USD/ })).toHaveCount(0);
  const row = page.getByRole('link', { name: /^Valas Plus/ });
  await expect(row).toContainText('3 pockets');
  await expect(row).toContainText('58.982.000');
  await row.click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});

test('a blank rate that cannot be resolved stops the save, names the currency, and leaves nothing behind', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Nowhere Valas');
  await page.getByLabel('Holds more than one currency').check();
  await page.getByLabel('Pocket 2', { exact: true }).selectOption('SGD');
  await page.getByLabel('Opening SGD').pressSequentially('10.00');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('alert')).toContainText('No SGD→IDR rate available. Enter it manually.');
  await page.goto('/accounts');
  await expect(page.getByRole('link', { name: 'Nowhere Valas' })).toHaveCount(0);
});

// The form cannot list one currency twice: choosing a currency another pocket holds swaps the two rows
// (`choosePocketCurrency`, P2), so the repository's "IDR is listed twice" refusal is pinned in db/test/pockets.test.ts.
test('one currency twice cannot be chosen: the two pockets swap, each keeping its own balance', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Current account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Twice');
  await page.getByLabel('Holds more than one currency').check();
  await expect(page.getByLabel('Pocket 1', { exact: true })).toHaveValue('IDR');
  await page.getByLabel('Opening IDR').pressSequentially('5400000');
  await page.getByLabel('Pocket 2', { exact: true }).selectOption('IDR');
  await expect(page.getByLabel('Pocket 1', { exact: true })).toHaveValue('USD');
  await expect(page.getByLabel('Opening IDR')).toHaveCount(1);
  await expect(page.getByLabel('Opening IDR')).toHaveValue('5400000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('link', { name: 'Twice', exact: true }).click();
  await expect(page.getByTestId('pocket-IDR')).toContainText('5.400.000');
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});

test('the parent is offered nowhere money is chosen; its pockets are, and a pocket pays like any account', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  const payer = page.getByRole('dialog', { name: 'Paid with' });
  await expect(payer.getByRole('button', { name: 'Valas Plus · IDR', exact: true })).toBeVisible();
  await expect(payer.getByRole('button', { name: 'Valas Plus', exact: true })).toHaveCount(0);
  await payer.getByRole('button', { name: 'Valas Plus · IDR', exact: true }).click();
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await expect(form.getByLabel('To', { exact: true }).locator('option', { hasText: /^Valas Plus \(/ })).toHaveCount(0);
});

test('USD → IDR between pockets reads each side at its own exponent, keystroke by keystroke', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Move between pockets/ }).click();
  await page.getByLabel('To').selectOption('IDR');
  await page.getByLabel('Leaves USD').pressSequentially('100.50');
  await page.getByLabel('Arrives IDR').pressSequentially('1.630.000');
  await expect(page.getByTestId('spread')).toContainText('3.125');
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('2.299,50');
  await expect(page.getByTestId('pocket-IDR')).toContainText('7.030.000');
});

test('changing a pocket clears both figures, and choosing the same pocket swaps', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Move between pockets/ }).click();
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await page.getByLabel('To').selectOption('IDR');
  await expect(page.getByLabel('Leaves USD')).toHaveValue('');
  await expect(page.getByLabel('Arrives IDR')).toHaveValue('');
  await page.getByLabel('From').selectOption('IDR');
  await expect(page.getByLabel('Leaves IDR')).toBeVisible();
  await expect(page.getByLabel('Arrives USD')).toBeVisible();
});

test('the Transfer tab between two pockets posts what the Move screen posts', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.goto('/transactions');
  // Driven here rather than through `addTransfer`, which `fill()`s the Received row — the row Task 4 rewired.
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'Valas Plus · USD', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).pressSequentially('500');
  await form.getByLabel('To', { exact: true }).selectOption({ label: 'Valas Plus · SGD (SGD)' });
  await form.getByLabel('Received amount (SGD)').pressSequentially('638');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await page.goto('/accounts');
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
});

test('the parent archives only after its pockets, and renaming it renames them', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  const alerts: string[] = [];
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'alert') alerts.push(dialog.message());
    if (dialog.type() === 'prompt') return void dialog.accept('Multi Plus');
    return void dialog.accept();
  });
  await page.getByRole('button', { name: 'Archive Valas Plus' }).click();
  await expect.poll(() => alerts.join()).toContain('Valas Plus still has pockets: USD, SGD, IDR');
  await page.getByRole('button', { name: 'Rename Valas Plus' }).click();
  await page.getByRole('link', { name: 'Multi Plus', exact: true }).click();
  await page.getByTestId('pocket-USD').click();
  await expect(page.getByRole('heading', { name: 'Multi Plus · USD' })).toBeVisible();
});

test('the Money tile names the rate it lacks instead of adding up the rest', async ({ page }) => {
  // Offline, and USD opened with nothing in it, so no USD rate is ever typed or fetched.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openWithPockets(page, { name: 'Unpriced Valas', pockets: [{ currency: 'IDR', balance: '5400000' }, { currency: 'USD', balance: '' }] });
  await expect(page.getByText(/No USD rate yet, so 1 account in 2 currencies cannot be added up/)).toBeVisible();
  await expect(page.getByText(/Money ≈/)).toHaveCount(0);
  // The account's own row names it too, in place of a total.
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Unpriced Valas', exact: true }) });
  await expect(row).toContainText('No USD rate yet');
});

test('Add asset reads a typed rate of 16.500 as 16,5, key by key (P2-I1)', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('cash');
  await page.getByLabel('Name', { exact: true }).pressSequentially('Broker Cash');
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByLabel('Opening rate').pressSequentially('16.500');
  await expect(page.getByText('Reads as 1 USD = 16,5 IDR')).toBeVisible();
  await page.getByLabel(/Balance today/).pressSequentially('10000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Broker Cash/ })).toBeVisible();
  // $10.000 at 16,5 is Rp 165.000. The old reader took "16.500" as 16500: Rp 165.000.000.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('165.000');
  await expect(page.getByTestId('net-worth')).not.toContainText('165.000.000');
});

test('Add asset with a blank foreign rate takes the day’s rate', async ({ page }) => {
  await mockRates(page, { USD: 16_250 });
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('cash');
  await page.getByLabel('Name', { exact: true }).pressSequentially('Broker Cash');
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByLabel(/Balance today/).pressSequentially('10000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Broker Cash/ })).toBeVisible();
  // $10.000 at the mocked 16.250.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('162.500.000');
});
