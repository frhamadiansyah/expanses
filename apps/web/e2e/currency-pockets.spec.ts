import { expect, test } from '@playwright/test';
import { ageRates, forgetRates, mockRates, openWithPockets } from './pockets';

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

test('a spread shown at last-known rates says so, and the move shows the spread it recorded at the day’s rates (I1)', async ({ page }, testInfo) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  // The first move of the day: the device holds only yesterday's rates, and the day's differ from them.
  await ageRates(page, testInfo.outputPath('aged.sqlite3'));
  await page.unroute('https://api.frankfurter.dev/**');
  await mockRates(page, { USD: 16_400, SGD: 12_800 });

  await page.goto('/accounts');
  await page.getByRole('link', { name: 'Valas Plus', exact: true }).click();
  await page.getByRole('link', { name: /Move between pockets/ }).click();
  await page.getByLabel('From').selectOption('USD');
  await page.getByLabel('To').selectOption('SGD');
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  // 500 × 16.250 − 638 × 12.680: the held rates, and marked as such.
  await expect(page.getByTestId('spread')).toContainText('35.160');
  await expect(page.getByTestId('spread')).toContainText('last known');
  await page.getByRole('button', { name: 'Move it' }).click();

  // 500 × 16.400 − 638 × 12.800: what the ledger records, at the rates the save fetched.
  await expect(page.getByTestId('recorded-spread')).toContainText('33.600');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
});

test('Lend & borrow adds each side in rupiah at the held rate, and names a rate it lacks (I2)', async ({ page }, testInfo) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // Money already owed, opened through Add asset: the Lend & borrow form records a loan in the base currency only.
  const owed = async (who: string, currency: string, amount: string, rate?: string) => {
    await page.goto('/net-worth/assets');
    await page.getByRole('button', { name: 'Add asset' }).click();
    await page.getByLabel('What is it?').selectOption('other_receivable');
    await page.getByLabel('Name', { exact: true }).pressSequentially(`Owed by ${who}`);
    await page.getByLabel('Currency').selectOption(currency);
    if (rate) await page.getByLabel('Opening rate').pressSequentially(rate);
    await page.getByLabel('Who').pressSequentially(who);
    await page.getByLabel(/^Owed now/).pressSequentially(amount);
    await page.getByRole('button', { name: 'Add asset' }).last().click();
    // Saved once the person is listed under Owed to you: leaving earlier loses the write.
    await expect(page.getByRole('main').getByText(who, { exact: true })).toBeVisible();
  };
  await owed('Andi', 'USD', '100', '16250');
  await owed('Budi', 'IDR', '500000');

  // US$100 at 16.250 and Rp 500.000: Rp 2.125.000, never 10.000 + 500.000 minor units read as Rp 510.000.
  await page.goto('/net-worth/debts');
  const total = page.getByTestId('debts-total-Owed to you');
  await expect(total).toContainText('2.125.000');
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();

  await forgetRates(page, testInfo.outputPath('no-rates.sqlite3'));
  await page.goto('/net-worth/debts');
  await expect(total).toContainText('No USD rate yet');
  await expect(total).not.toContainText('500.000');
});

test('a rate missing only for an earlier month leaves today’s net worth standing (M1)', async ({ page }, testInfo) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  const earlier = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Old Valas');
  await page.getByLabel('Holds more than one currency').check();
  await page.getByLabel('Balance as of').fill(earlier);
  await page.getByLabel('Pocket 1', { exact: true }).selectOption('IDR');
  await page.getByLabel('Opening IDR', { exact: true }).pressSequentially('5400000');
  await page.getByLabel('Pocket 2', { exact: true }).selectOption('USD');
  await page.getByLabel('Opening USD', { exact: true }).pressSequentially('100');
  await page.getByLabel('Rate: IDR per 1 USD').pressSequentially('16250');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Old Valas', exact: true })).toBeVisible();

  // Every dollar moved to rupiah today, at the last-known rate: today the account holds no USD at all.
  await page.getByRole('link', { name: 'Old Valas', exact: true }).click();
  await page.getByRole('link', { name: /Move between pockets/ }).click();
  await page.getByLabel('From').selectOption('USD');
  await page.getByLabel('To').selectOption('IDR');
  await page.getByLabel('Leaves USD').pressSequentially('100');
  await page.getByLabel('Arrives IDR').pressSequentially('1625000');
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByTestId('pocket-IDR')).toContainText('7.025.000');

  await forgetRates(page, testInfo.outputPath('no-rates.sqlite3'));
  await page.goto('/net-worth');
  // Earlier months held dollars and cannot be priced; today holds none, so today's figure stands.
  await expect(page.getByTestId('net-worth')).toContainText('7.025.000');
  await expect(page.getByTestId('chart-missing')).toContainText('No USD rate');
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

test('an empty foreign pocket needs no rate: the Money tile still adds up', async ({ page }) => {
  // Offline, and USD opened with nothing in it, so no USD rate is ever typed or fetched — and none is needed for 0.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openWithPockets(page, { name: 'Unpriced Valas', pockets: [{ currency: 'IDR', balance: '5400000' }, { currency: 'USD', balance: '' }] });
  await expect(page.getByText(/across 1 account · 2 currencies/)).toBeVisible();
  // Twice: the tile and the account's own row.
  await expect(page.getByText(/5\.400\.000/)).toHaveCount(2);
  await expect(page.getByText(/No USD rate yet/)).toHaveCount(0);
});

test('the Money tile names the rate it lacks instead of adding up the rest', async ({ page }, testInfo) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openWithPockets(page, { name: 'Unpriced Valas', pockets: [{ currency: 'IDR', balance: '5400000' }, { currency: 'USD', balance: '2400', rate: '16250' }] });
  // $2.400 held, and then no USD rate anywhere on the device.
  await forgetRates(page, testInfo.outputPath('no-rates.sqlite3'));
  await page.goto('/accounts');
  await expect(page.getByText(/No USD rate yet, so 1 account in 2 currencies cannot be added up/)).toBeVisible();
  await expect(page.getByText(/Money ≈/)).toHaveCount(0);
  // The account's own row names it too, in place of a total.
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Unpriced Valas', exact: true }) });
  await expect(row).toContainText('No USD rate yet');
});

test('a USD pocket added to an account reads its opening balance in dollars, not rupiah (P2-I2)', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Two Pocket', pockets: [{ currency: 'IDR', balance: '5400000' }, { currency: 'SGD', balance: '1150' }] });
  await page.getByRole('link', { name: 'Two Pocket', exact: true }).click();
  await page.getByRole('link', { name: /Add a pocket/ }).click();
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByLabel('Opening USD').pressSequentially('2400');
  await page.getByLabel('Rate: IDR per 1 USD').pressSequentially('16250');
  await page.getByRole('button', { name: 'Add pocket' }).click();
  // $2.400,00 — read at USD's two decimals. Read at the base's none, it would be $24,00 and ≈ Rp 390.000.
  await expect(page.getByTestId('pocket-USD')).toContainText('2.400,00');
  await expect(page.getByTestId('pocket-USD')).toContainText('39.000.000');
});

test('Add a pocket says so when the account already holds every currency (P2-M5)', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Every Currency');
  await page.getByLabel('Holds more than one currency').check();
  // Each added row takes the next currency not yet held; empty balances need no rate.
  const all = await page.getByLabel('Pocket 1', { exact: true }).locator('option').count();
  for (let i = 2; i < all; i += 1) await page.getByRole('button', { name: 'Add another currency' }).click();
  await expect(page.getByLabel(`Pocket ${all}`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.getByRole('link', { name: 'Every Currency', exact: true }).click();
  await page.getByRole('link', { name: /Add a pocket/ }).click();
  await expect(page.getByText('This account already holds every currency.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add pocket' })).toHaveCount(0);
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
