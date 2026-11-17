import { expect, test } from '@playwright/test';
import { personRow } from './people';
import { expectWalletFigure, openAccount, openSettings, walletCard, showBalance } from './accounts';
import { openNewAsset } from './add-asset';
import { openDrawers } from './drawers';
import { ageRates, forgetRates, mockRates, openWithPockets, pickPocket } from './pockets';
import { choosePayment, chooseTo } from './add-transaction';
import { currencyRow, pickInSheet, setCurrency } from './currency-field';
import { pickView } from './wallet';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const VALAS = {
  name: 'Valas Plus',
  bank: 'Bank One',
  // Shown everywhere with its bank in front; stored, and typed in Settings, as "Valas Plus".
  shown: 'Bank One Valas Plus',
  pockets: [
    { currency: 'USD', balance: '2400.00', rate: '16250' },
    { currency: 'SGD', balance: '1150.00' }, // blank: resolved from the (mocked) daily rate
    { currency: 'IDR', balance: '5400000' },
  ],
};

test('an account with pockets is one row that adds them up, and opens to each pocket', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);

  // P1: one card, the converted total, no pocket cards of their own; the line beside it counts the pockets.
  const card = walletCard(page, 'Bank One Valas Plus');
  await expect(card).toHaveAccessibleName(/58\.982\.000/);
  await expect(page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /Bank One Valas Plus · USD/ })).toHaveCount(0);

  await card.click();
  await expect(page.getByTestId('pocket-USD')).toContainText('2.400,00');
  await expect(page.getByTestId('pocket-USD')).toContainText('39.000.000');
  await expect(page.getByTestId('pocket-SGD')).toContainText('14.582.000');
  // Nothing converted beneath the base-currency pocket.
  await expect(page.getByTestId('pocket-IDR')).not.toContainText('≈');

  // A pocket is an ordinary account page: its code, the rate it opened at, and back to its account.
  await page.getByTestId('pocket-USD').click();
  await expect(page.getByRole('main').getByText('16.250 IDR per 1 USD', { exact: true })).toBeVisible();
  // Its kode harta lives in its settings.
  await openSettings(page);
  await expect(page.getByRole('button', { name: /^Tax code/ })).toContainText('0102');
  // Back to the pocket's page, and from there to its account.
  await page.getByRole('button', { name: 'Bank One Valas Plus · USD', exact: true }).click();
  await page.getByRole('button', { name: 'Bank One Valas Plus', exact: true }).click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});

test('a single-currency account is exactly what it was', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Dollar Saver');
  const balance = page.getByLabel('Current balance', { exact: true });
  // No currency to change until there is a figure: the symbol before it is the control.
  await expect(page.getByRole('button', { name: /^Currency: / })).toHaveCount(0);
  await balance.pressSequentially('1800');
  await expect(balance).toHaveValue('1.800');
  // Exact: "Multi-currency" is on this form too.
  await page.getByRole('button', { name: 'Currency: IDR', exact: true }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: /^USD / }).first().click();
  await expect(page.getByRole('button', { name: 'Currency: USD', exact: true })).toBeVisible();
  // The figure typed stands, now read in dollars, and takes its cents after a comma.
  await expect(balance).toHaveValue('1.800');
  await balance.fill('1800,00');
  await expect(balance).toHaveValue('1.800,00');
  await page.getByLabel(/^Rate: IDR per 1 USD$/).pressSequentially('15720');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expectWalletFigure(page, 'Dollar Saver', '1.800,00');
});

test('a pocket can be added, in a currency with no decimals, at a typed rate', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await walletCard(page, 'Bank One Valas Plus').click();
  await page.getByRole('button', { name: /^Add (a )?currency$/ }).first().click();
  // Currencies it already has are not offered.
  await currencyRow(page).click();
  await expect(page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: /^USD / })).toHaveCount(0);
  await pickInSheet(page, 'JPY');
  await page.getByLabel('Opening JPY').pressSequentially('30000');
  await page.getByLabel('Rate: IDR per 1 JPY', { exact: true }).pressSequentially('108,3');
  await page.getByRole('dialog', { name: 'Add a currency' }).getByRole('button', { name: 'Add', exact: true }).click();
  // ¥30.000, not ¥300: JPY has no decimals.
  await expect(page.getByTestId('pocket-JPY')).toContainText('30.000');
  await expect(page.getByTestId('pocket-JPY')).toContainText('3.249.000');
});

test('moving between pockets moves what the screen shows, with nothing under the figures', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await walletCard(page, 'Bank One Valas Plus').click();
  await page.getByRole('link', { name: 'Move', exact: true }).click();

  // The pocket picker lists one pocket per currency; the helper chooses by the currency's name.
  await pickPocket(page, 'From', 'USD');
  await pickPocket(page, 'To', 'SGD');
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await expect(page.getByText('1 USD = 1,276 SGD', { exact: true })).toBeVisible();
  // An exchange's gain or loss counts nowhere (owner, 17 Nov 2026): no Cost and no Exchange loss under the figures.
  await expect(page.getByText(/Exchange (loss|gain)|recorded as/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'About Cost' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Move', exact: true }).click();

  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
});

test('a move at last-known rates goes straight back to the account: no spread is shown or recorded', async ({ page }, testInfo) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  // The first move of the day: the device holds only yesterday's rates, and the day's differ from them.
  await ageRates(page, testInfo.outputPath('aged.sqlite3'));
  await page.unroute('https://api.frankfurter.dev/**');
  await mockRates(page, { USD: 16_400, SGD: 12_800 });

  await page.goto('/wallet');
  await walletCard(page, 'Bank One Valas Plus').click();
  await page.getByRole('link', { name: 'Move', exact: true }).click();
  await pickPocket(page, 'From', 'USD');
  await pickPocket(page, 'To', 'SGD');
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await expect(page.getByText(/Exchange (loss|gain)|last known/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Move', exact: true }).click();

  // The ledger still writes its gain at the day's rates, but it counts nowhere, so nothing stops to say so.
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
});

test('Lend & borrow adds each side in rupiah at the held rate, and names a rate it lacks (I2)', async ({ page }, testInfo) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // Money already owed, opened through Add asset: the Lend & borrow form records a loan in the base currency only.
  const owed = async (who: string, currency: string, amount: string, rate?: string) => {
    await openNewAsset(page, 'Other receivables');
    await page.getByLabel('Name', { exact: true }).pressSequentially(`Owed by ${who}`);
    await page.getByLabel('Who').pressSequentially(who);
    await page.getByLabel('Owed now', { exact: true }).pressSequentially(amount);
    // The currency is the symbol before the amount, there once a figure is: tapped, it opens the currency list.
    if (currency !== 'IDR') {
      await page.getByRole('button', { name: /^Owed now currency/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${currency} `) }).first().click();
    }
    if (rate) await page.getByLabel('Opening rate').pressSequentially(rate);
    await page.getByRole('button', { name: 'Add asset' }).last().click();
    // Saved once the person is listed under Receivables — inside its drawer, which the list opens shut: leaving
    // earlier loses the write.
    await openDrawers(page);
    await expect(page.getByRole('main').getByText(who, { exact: true })).toBeVisible();
  };
  await owed('Andi', 'USD', '100', '16250');
  await owed('Budi', 'IDR', '500000');

  // US$100 at 16.250 and Rp 500.000: Rp 2.125.000, never 10.000 + 500.000 minor units read as Rp 510.000.
  await page.goto('/net-worth/lend-borrow');
  const total = page.getByTestId('debts-total-Receivables');
  await expect(total).toContainText('2.125.000');
  await expect(personRow(page, 'Andi')).toBeVisible();

  await forgetRates(page, testInfo.outputPath('no-rates.sqlite3'));
  await page.goto('/net-worth/lend-borrow');
  await expect(total).toContainText('No USD rate yet');
  await expect(total).not.toContainText('500.000');
});

test('a rate missing only for an earlier month leaves today’s net worth standing (M1)', async ({ page }, testInfo) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // The form asks no day — its balance is today's — so the account is opened with the clock sixty days back.
  const now = new Date();
  await page.clock.setSystemTime(new Date(now.getTime() - 60 * 86_400_000));
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Old Valas');
  await page.getByLabel('Multi-currency', { exact: true }).check();
  await setCurrency(currencyRow(page, 'Pocket 1'), 'IDR');
  await page.getByLabel('Opening IDR', { exact: true }).pressSequentially('5400000');
  await setCurrency(currencyRow(page, 'Pocket 2'), 'USD');
  await page.getByLabel('Opening USD', { exact: true }).pressSequentially('100');
  await page.getByLabel('Rate: IDR per 1 USD', { exact: true }).pressSequentially('16250');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(walletCard(page, 'Old Valas')).toBeVisible();
  await page.clock.setSystemTime(new Date());

  // Every dollar moved to rupiah today, at the last-known rate: today the account holds no USD at all.
  await page.goto('/wallet');
  await walletCard(page, 'Old Valas').click();
  await page.getByRole('link', { name: 'Move', exact: true }).click();
  await pickPocket(page, 'From', 'USD');
  await pickPocket(page, 'To', 'IDR');
  await page.getByLabel('Leaves USD').pressSequentially('100');
  await page.getByLabel('Arrives IDR').pressSequentially('1625000');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByTestId('pocket-IDR')).toContainText('7.025.000');

  await forgetRates(page, testInfo.outputPath('no-rates.sqlite3'));
  await page.goto('/net-worth');
  // Earlier months held dollars and cannot be priced; today holds none, so today's figure stands.
  await expect(page.getByTestId('net-worth')).toContainText('7.025.000');
  await expect(page.getByTestId('chart-missing')).toContainText('No USD rate');
});

test('an account without pockets opened at the pockets routes says it has none (M3, M7)', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Two Pockets', pockets: [{ currency: 'IDR', balance: '5400000' }, { currency: 'SGD', balance: '100' }] });
  await walletCard(page, 'Two Pockets').click();
  await showBalance(page);
  await expect(page.getByText('2 currencies')).toBeVisible();
  // A pocket is an account with no pockets of its own: its id on the accounts route is its own page — the figure
  // it holds and the rows behind it — rather than a Rp 0 parent with nothing under it.
  await page.getByTestId('pocket-SGD').click();
  const id = /\/accounts\/([^/?#]+)/.exec(page.url())![1];
  await page.goto(`/accounts/${id}`);
  await expect(page.getByText('Balance', { exact: true })).toBeVisible();
  // No group of its own: exact, because this fixture's account is *called* Two Pockets.
  await expect(page.getByRole('heading', { name: 'Pockets', exact: true })).toHaveCount(0);
  // And the route that *adds* a pocket refuses it: a pocket cannot hold a pocket.
  await page.goto(`/accounts/${id}/pocket`);
  await expect(page.getByText('it has no pockets')).toBeVisible();
  await expect(currencyRow(page)).toHaveCount(0);
});

test('a pocket’s ≈ line marks a rate held for an earlier day as last known (M5)', async ({ page }, testInfo) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await ageRates(page, testInfo.outputPath('aged.sqlite3'));
  await page.goto('/wallet');
  await walletCard(page, 'Bank One Valas Plus').click();
  await page.getByTestId('pocket-USD').click();
  // The account page marks it too; this is the pocket's own page.
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByText('Opened at')).toBeVisible();
  await expect(page.getByText(/16\.250 IDR per 1 USD \(last known\)/)).toBeVisible();
});

test('the Money tile adds every account and pocket at today’s rates', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  // The Balance tile is the grid's (the pile shows none).
  await page.goto('/wallet');
  await pickView(page, 'Grid');
  // The legend is two rows and nothing under them: what the money is spread across is not part of the figure.
  await expect(page.getByText(/across 1 account/)).toHaveCount(0);
  // Three times, and each is a different sentence: the tile's own figure, the share it is made of, and the account's
  // own caption. No section carries it a fourth time.
  await expect(page.getByText(/58\.982\.000/)).toHaveCount(3);
});

test('net worth’s Assets list shows the account once, at the ≈ total, and opens to its pockets', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /Bank One Valas Plus · USD/ })).toHaveCount(0);
  const row = page.getByRole('link', { name: /^Bank One Valas Plus/ });
  // One line: the ≈ on the figure is what says it holds more than one currency.
  await expect(row).not.toContainText('pockets');
  await expect(row).toContainText('≈ Rp 58.982.000');
  await row.click();
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
});

test('a blank rate that cannot be resolved stops the save, names the currency, and leaves nothing behind', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Nowhere Valas');
  await page.getByLabel('Multi-currency', { exact: true }).check();
  await setCurrency(currencyRow(page, 'Pocket 2'), 'SGD');
  await page.getByLabel('Opening SGD').pressSequentially('10.00');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('alert')).toContainText('No SGD→IDR rate available. Enter it manually.');
  await page.goto('/wallet');
  await expect(page.getByRole('link', { name: 'Nowhere Valas' })).toHaveCount(0);
});

// The form cannot list one currency twice: choosing a currency another pocket holds swaps the two rows
// (`choosePocketCurrency`, P2), so the repository's "IDR is listed twice" refusal is pinned in db/test/pockets.test.ts.
test('one currency twice cannot be chosen: the two pockets swap, each keeping its own balance', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Current account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Twice');
  await page.getByLabel('Multi-currency', { exact: true }).check();
  await expect(currencyRow(page, 'Pocket 1')).toHaveAccessibleName('Pocket 1: IDR');
  await page.getByLabel('Opening IDR').pressSequentially('5400000');
  await setCurrency(currencyRow(page, 'Pocket 2'), 'IDR');
  await expect(currencyRow(page, 'Pocket 1')).toHaveAccessibleName('Pocket 1: USD');
  await expect(page.getByLabel('Opening IDR')).toHaveCount(1);
  await expect(page.getByLabel('Opening IDR')).toHaveValue('5400000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await walletCard(page, 'Twice').click();
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
  // The account is one row that opens its pockets under it (account tree, 12 Nov) — never a choice of its own.
  const parent = payer.getByRole('button', { name: 'Bank One Valas Plus', exact: true });
  await expect(parent).toHaveAttribute('aria-expanded', 'false');
  await expect(payer.getByRole('button', { name: 'Bank One Valas Plus · IDR', exact: true })).toHaveCount(0);
  await parent.click();
  await expect(parent).toHaveAttribute('aria-expanded', 'true');
  await payer.getByRole('button', { name: 'Bank One Valas Plus · IDR', exact: true }).click();
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: /^To/ }).click();
  const toList = page.getByRole('dialog', { name: 'To', exact: true });
  await expect(toList).toBeVisible();
  // In To the account is again a row that only opens its pockets; the From pocket is not among them.
  const toParent = toList.getByRole('button', { name: 'Bank One Valas Plus', exact: true });
  await expect(toParent).toHaveAttribute('aria-expanded', 'false');
  await toParent.click();
  await expect(toList.getByRole('button', { name: 'Bank One Valas Plus · USD', exact: true })).toBeVisible();
  await expect(toList.getByRole('button', { name: 'Bank One Valas Plus · IDR', exact: true })).toHaveCount(0);
  await toList.getByRole('button', { name: 'Close' }).click();
});

test('USD → IDR between pockets reads each side at its own exponent, keystroke by keystroke', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await walletCard(page, 'Bank One Valas Plus').click();
  await page.getByRole('link', { name: 'Move', exact: true }).click();
  await pickPocket(page, 'To', 'IDR');
  await page.getByLabel('Leaves USD').pressSequentially('100.50');
  await page.getByLabel('Arrives IDR').pressSequentially('1.630.000');
  await expect(page.getByLabel('Arrives IDR')).toHaveValue('1.630.000');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('2.299,50');
  await expect(page.getByTestId('pocket-IDR')).toContainText('7.030.000');
});

test('changing a pocket clears both figures, and choosing the same pocket swaps', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await walletCard(page, 'Bank One Valas Plus').click();
  await page.getByRole('link', { name: 'Move', exact: true }).click();
  await page.getByLabel('Leaves USD').pressSequentially('500');
  await page.getByLabel('Arrives SGD').pressSequentially('638');
  await pickPocket(page, 'To', 'IDR');
  await expect(page.getByLabel('Leaves USD')).toHaveValue('');
  await expect(page.getByLabel('Arrives IDR')).toHaveValue('');
  await pickPocket(page, 'From', 'IDR');
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
  await choosePayment(page, 'Bank One Valas Plus · USD', 'From');
  await form.getByLabel('Amount', { exact: true }).pressSequentially('500');
  await chooseTo(form, 'Bank One Valas Plus · SGD (SGD)');
  await form.getByLabel('Received amount (SGD)').pressSequentially('638');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await page.goto('/wallet');
  await walletCard(page, 'Bank One Valas Plus').click();
  await expect(page.getByTestId('pocket-USD')).toContainText('1.900,00');
  await expect(page.getByTestId('pocket-SGD')).toContainText('1.788,00');
});

test('a transfer into the base currency shows nothing under the form, and its receipt one Rate row (owner, 17 Nov 2026)', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await choosePayment(page, 'Bank One Valas Plus · USD', 'From');
  await form.getByLabel('Amount', { exact: true }).pressSequentially('100');
  await chooseTo(form, 'Bank One Valas Plus · IDR (IDR)');
  await form.getByLabel('Received amount (IDR)').pressSequentially('1630000');
  // No Rate, no Cost, no Exchange loss or gain while typing.
  await expect(form.getByText(/per USD|Exchange (loss|gain)|recorded as/)).toHaveCount(0);
  await expect(form.getByText(/^Cost /)).toHaveCount(0);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  // Off Cashflow, as any transfer with no fee.
  await expect(page.getByText(/USD → IDR/)).toHaveCount(0);

  await page.goto('/wallet');
  await walletCard(page, 'Bank One Valas Plus').click();
  await page.getByTestId('account-recent-row').first().click();
  await expect(page.getByText('Rp 16.300 per USD', { exact: true })).toBeVisible();
  await expect(page.getByText(/at the withdrawal rate|withdrawal$|Exchange (loss|gain)|recorded as/)).toHaveCount(0);
});

test('the parent archives only after its pockets, and renaming it renames them', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  // Both are in the account's Settings, behind the ⚙ in its corner: its Name, and Archive at the foot.
  await walletCard(page, 'Bank One Valas Plus').click();
  await openSettings(page);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText(/Valas Plus still has pockets: USD, SGD, IDR/)).toBeVisible();
  const name = page.getByLabel('Name', { exact: true });
  await name.fill('Multi Plus');
  await name.blur();
  await expect(name).toHaveValue('Multi Plus');
  await page.goto('/wallet');
  await walletCard(page, 'Bank One Multi Plus').click();
  await page.getByTestId('pocket-USD').click();
  await expect(page.getByRole('heading', { name: 'Bank One Multi Plus · USD' })).toBeVisible();
});

test('an empty foreign pocket needs no rate: the Money tile still adds up', async ({ page }) => {
  // Offline, and USD opened with nothing in it, so no USD rate is ever typed or fetched — and none is needed for 0.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openWithPockets(page, { name: 'Unpriced Valas', pockets: [{ currency: 'IDR', balance: '5400000' }, { currency: 'USD', balance: '' }] });
  await page.goto('/wallet');
  await pickView(page, 'Grid');
  await expect(page.getByText(/across 1 account/)).toHaveCount(0);
  // Three times, as in the pockets test above: the tile's figure, the share it is made of, the account's own row.
  await expect(page.getByText(/5\.400\.000/)).toHaveCount(3);
  await expect(page.getByText(/No USD rate yet/)).toHaveCount(0);
});

test('the tile names the rate it lacks instead of adding up the rest', async ({ page }, testInfo) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openWithPockets(page, { name: 'Unpriced Valas', pockets: [{ currency: 'IDR', balance: '5400000' }, { currency: 'USD', balance: '2400', rate: '16250' }] });
  // $2.400 held, and then no USD rate anywhere on the device.
  await forgetRates(page, testInfo.outputPath('no-rates.sqlite3'));
  await page.goto('/wallet');
  await pickView(page, 'Grid');
  await expect(page.getByText(/No USD rate yet, so what is left to spend cannot be worked out/)).toBeVisible();
  // No figure and no working either: a spendable total that leaves the dollars out would be a lie with a number on it.
  await expect(page.getByText('Spending money')).toHaveCount(0);
  await expect(page.getByText('Outstanding on cards')).toHaveCount(0);
  // The account's own card names it too, in place of a total.
  await expect(walletCard(page, 'Unpriced Valas')).toHaveAccessibleName(/No USD rate yet/);
});

test('a USD pocket added to an account reads its opening balance in dollars, not rupiah (P2-I2)', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Two Pocket', pockets: [{ currency: 'IDR', balance: '5400000' }, { currency: 'SGD', balance: '1150' }] });
  await walletCard(page, 'Two Pocket').click();
  await page.getByRole('button', { name: /^Add (a )?currency$/ }).first().click();
  await setCurrency(currencyRow(page), 'USD');
  await page.getByLabel('Opening USD').pressSequentially('2400');
  await page.getByLabel('Rate: IDR per 1 USD', { exact: true }).pressSequentially('16250');
  await page.getByRole('dialog', { name: 'Add a currency' }).getByRole('button', { name: 'Add', exact: true }).click();
  // $2.400,00 — read at USD's two decimals. Read at the base's none, it would be $24,00 and ≈ Rp 390.000.
  await expect(page.getByTestId('pocket-USD')).toContainText('2.400,00');
  await expect(page.getByTestId('pocket-USD')).toContainText('39.000.000');
});

test('Add a pocket says so when the account already holds every currency (P2-M5)', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Every Currency');
  await page.getByLabel('Multi-currency', { exact: true }).check();
  // Each added row takes the next currency not yet held; empty balances need no rate.
  // How many currencies there are: the distinct codes in the sheet Pocket 1 opens.
  await currencyRow(page, 'Pocket 1').click();
  const labels = await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: /^[A-Z]{3} / }).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')!.slice(0, 3)));
  const all = new Set(labels).size;
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'Close' }).click();
  for (let i = 2; i < all; i += 1) await page.getByRole('button', { name: 'Add another currency' }).click();
  await expect(currencyRow(page, `Pocket ${all}`)).toBeVisible();
  await page.getByRole('button', { name: 'Add account' }).click();
  await walletCard(page, 'Every Currency').click();
  await page.getByRole('button', { name: /^Add (a )?currency$/ }).first().click();
  await expect(page.getByText('This account already holds every currency.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Add a currency' }).getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
});

test('Add asset reads a typed rate of 16.500 as 16,5, key by key (P2-I1)', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // Money is an account, not an asset: a fund account in USD, opened at a rate typed as a person types it.
  await openAccount(page, {
    subtype: 'fund',
    name: 'Broker Cash',
    currency: 'USD',
    balance: '10000',
    rate: '16.500',
    // The preview is the old reader's failure, checked where the rate is typed.
    extra: async (page) => {
      await expect(page.getByText('Reads as 1 USD = 16,5 IDR')).toBeVisible();
    },
  });
  // $10.000 at 16,5 is Rp 165.000. The old reader took "16.500" as 16500: Rp 165.000.000.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('165.000');
  await expect(page.getByTestId('net-worth')).not.toContainText('165.000.000');
});

test('Add asset with a blank foreign rate takes the day’s rate', async ({ page }) => {
  await mockRates(page, { USD: 16_250 });
  // Money is an account, not an asset: a fund account in USD, its rate resolved for the day.
  await openAccount(page, { subtype: 'fund', name: 'Broker Cash', currency: 'USD', balance: '10000' });
  // $10.000 at the mocked 16.250.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('162.500.000');
});

test('the Move page: type what leaves and what arrives, nothing under them, the swap and the picker change the pockets', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, VALAS);
  await walletCard(page, 'Bank One Valas Plus').click();
  await page.getByRole('link', { name: 'Move', exact: true }).click();

  // From USD to IDR through the pickers: each row names its side and its pocket.
  await pickPocket(page, 'From', 'USD');
  await pickPocket(page, 'To', 'IDR');
  await expect(page.getByRole('button', { name: 'From, US Dollar' })).toContainText('From');
  await expect(page.getByRole('button', { name: 'To, Indonesian Rupiah' })).toContainText('To');
  await page.getByLabel('Leaves USD').pressSequentially('100');
  await page.getByLabel('Arrives IDR').pressSequentially('1625000');
  // No Cost and no gain or loss under the figures (owner, 17 Nov 2026).
  await expect(page.getByRole('button', { name: 'About Cost' })).toHaveCount(0);
  await expect(page.getByText(/Exchange (loss|gain)/)).toHaveCount(0);

  // Swap trades the pockets and keeps the figure typed on the From side.
  await page.getByRole('button', { name: 'Swap' }).click();
  await expect(page.getByRole('button', { name: 'From, Indonesian Rupiah' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'To, US Dollar' })).toBeVisible();
  await expect(page.getByLabel('Leaves IDR')).toHaveValue(/^100/);
  await expect(page.getByLabel('Arrives USD')).toHaveValue('');
  await page.getByRole('button', { name: 'Swap' }).click();
  await expect(page.getByRole('button', { name: 'From, US Dollar' })).toBeVisible();

  // The picker for To changes the To pocket (and clears the figures, as choosing always did).
  await pickPocket(page, 'To', 'SGD');
  await expect(page.getByRole('button', { name: 'To, Singapore Dollar' })).toBeVisible();
  await expect(page.getByLabel('Arrives SGD')).toHaveValue('');

  await pickPocket(page, 'To', 'IDR');
  await page.getByLabel('Leaves USD').pressSequentially('100');
  await page.getByLabel('Arrives IDR').pressSequentially('1625000');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByTestId('pocket-USD')).toContainText('2.300,00');
  await expect(page.getByTestId('pocket-IDR')).toContainText('7.025.000');
});
