import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { expectBalance, startReport } from './deposit-maturity';
import { addHoldingFlow, setForeignList } from './securities';
import { addMoneyAccount } from './set-aside';
import { todayIn } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('1–4: BBCA at two brokers is one stock, one price values both, and adding what was owned before moves no bank', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750' });
  await expect(page.getByLabel('Total')).toHaveText(/8\.750\.000$/); // 10 lots × 100 × 8.750
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  // Past purchases go against Opening Balances, as Add asset's do: the bank is where it was.
  await expectBalance(page, 'BCA Tahapan', '50.000.000');

  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Mandiri Sekuritas' }, quantity: '5', price: '9.400', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await expectBalance(page, 'BCA Tahapan', '50.000.000');

  // BBCA is held now, so it is picked from You hold, and Stockbit says what it holds.
  await addHoldingFlow(page, { search: 'BBCA', broker: 'Stockbit · held 1.000', quantity: '5', price: '9.000', paidFrom: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await expectBalance(page, 'BCA Tahapan', '50.000.000');

  await page.goto('/net-worth/investments');
  const bbca = page.getByTestId('stock-row').filter({ hasText: 'BBCA' });
  await expect(bbca).toHaveCount(1);
  await expect(bbca).toContainText('2.000 shares');
  await expect(bbca).toContainText('2 brokers');

  await bbca.click();
  await page.getByRole('link', { name: /Price today/ }).click();
  await page.getByLabel('Price (IDR)').pressSequentially('9.775');
  await expect(page.getByText('14.662.500')).toBeVisible(); // Stockbit 1.500 × 9.775
  await expect(page.getByText('4.887.500')).toBeVisible(); // Mandiri 500 × 9.775
  await page.getByRole('button', { name: 'Save price' }).click();
  await expect(page).toHaveURL(/\/security\/[^/]+$/); // saved: back on the stock's page
  await page.goto('/net-worth/investments');
  await expect(page.getByTestId('stock-row').filter({ hasText: 'BBCA' })).toContainText('19.550.000'); // 2.000 × 9.775
});

test('5: a free user names AAPL owned before, and its rupiah cost is filed at the day\u2019s rate it asks for', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  // No rate for the day on this device: the first save asks for it, and the cost is 10 × 182,50 at 15.800.
  await addHoldingFlow(page, {
    search: 'AAPL', nameIt: { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD' },
    broker: { new: 'Interactive Brokers', currency: 'USD' }, quantity: '10', price: '182,50', rate: '15800',
  });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'AAPL' })).toBeVisible();
  await expectBalance(page, 'BCA Tahapan', '50.000.000');
});

test('9: a free user’s search for AAPL finds nothing on IDX and offers Name it myself', async ({ page }) => {
  // Reached from the Investments corner, as the owner would.
  await page.goto('/net-worth/investments');
  await page.getByRole('link', { name: 'Add a holding' }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments\/new$/);
  await page.getByRole('button', { name: /^Ticker/ }).click();
  await page.getByLabel('Ticker or name').pressSequentially('AAPL');
  await expect(page.getByText('Nothing on IDX matches AAPL')).toBeVisible();
  await expect(page.getByRole('button', { name: /Name it myself/ })).toBeVisible();
});

test('9 (the list): the same search finds BBCA, so the empty answer is about the market, not a failure', async ({ page }) => {
  await page.goto('/net-worth/investments/new');
  await page.getByRole('button', { name: /^Ticker/ }).click();
  await page.getByLabel('Ticker or name').pressSequentially('BBCA');
  await expect(page.getByRole('button', { name: /^BBCA\b/ }).first()).toBeVisible();
});

test('6 & 10: the switched-on list fills AAPL in; a missing day rate is asked for and read back; after the switch goes off AAPL still counts', async ({ page }) => {
  await setForeignList(page, true);
  await addMoneyAccount(page, 'Interactive Brokers', 'fund', '0', 'USD');
  await addHoldingFlow(page, { search: 'AAPL', pick: 'AAPL', broker: 'Interactive Brokers', quantity: '10', price: '182,50', paidFrom: 'Interactive Brokers (USD)' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  // No USD rate is stored for this purchase's day and the rate server is unreachable: the form asks, keeping what was typed.
  await expect(page.getByRole('alert')).toContainText('Rate that day');
  await page.getByLabel('Rate that day').pressSequentially('16250');
  await expect(page.getByText('Reads as 1 USD = 16.250 IDR')).toBeVisible();
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'AAPL' })).toBeVisible();
  // No price yet, so the value is the cost: $1.825,00 at the 16.250 just stored for today.
  await expect(page.getByText(/29\.656\.250/).first()).toBeVisible();

  await setForeignList(page, false); // a lapse
  await page.goto('/net-worth/investments');
  await expect(page.getByTestId('stock-row').filter({ hasText: 'AAPL' })).toContainText('10 shares');
  await page.goto('/net-worth/investments/new');
  await page.getByRole('button', { name: /^Ticker/ }).click();
  await page.getByLabel('Ticker or name').pressSequentially('AAP');
  await expect(page.getByText('Held', { exact: true })).toBeVisible();
  await page.getByLabel('Ticker or name').fill('');
  await page.getByLabel('Ticker or name').pressSequentially('MSFT');
  await expect(page.getByText('Nothing on IDX matches MSFT')).toBeVisible(); // the US list is no longer searched
});

test('11: a holding recorded before is given its ticker and broker; its lot setting goes to the security', async ({ page }) => {
  await addMoneyAccount(page, 'Stockbit', 'fund', '0');
  // Recorded before its ticker was known: named by hand through the ticker finder's own door, then linked.
  await addHoldingFlow(page, {
    search: 'BBCA old',
    nameIt: { ticker: '', name: 'BBCA old', market: '', currency: 'IDR' },
    broker: { new: 'Ajaib' },
    quantity: '100',
    price: '8.750',
    paidFrom: 'Owned before this app',
    date: await todayIn(page, 200),
  });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await page.getByRole('link', { name: 'Ajaib', exact: true }).click();
  await page.getByRole('link', { name: /Ticker/ }).click();
  await page.getByLabel('Ticker or name').pressSequentially('BBCA');
  // The list leads with what is held — which is this asset's own unlisted name — so the ticker to link to is the
  // listed BBCA, the only result with a market behind it.
  await page.getByRole('button', { name: /^BBCA\b.*IDX/ }).click();
  await page.getByLabel('Broker', { exact: true }).selectOption({ label: 'Stockbit' });
  await expect(page.getByRole('link', { name: 'Ticker BBCA', exact: true })).toBeVisible();
  await expect(page.getByLabel('Shares in a lot')).toHaveCount(0); // set by BBCA now
  await page.goto('/net-worth/investments');
  await expect(page.getByTestId('broker-row').filter({ hasText: 'Stockbit' })).toContainText('875.000');
});

test('12: the tax report names the broker and files AAPL at the rupiah it cost', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await addHoldingFlow(page, {
    search: 'AAPL', nameIt: { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD' },
    broker: { new: 'Interactive Brokers', currency: 'USD' }, quantity: '10', price: '182,50', rate: '15800',
  });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'AAPL' })).toBeVisible();
  // Both were bought today, so they are this year's report — the browser's own year, not Node's.
  await startReport(page, Number((await todayIn(page)).slice(0, 4)));
  await expect(page.getByText('Saham BBCA — Stockbit').first()).toBeVisible();
  const aapl = page.getByRole('row').filter({ hasText: 'Saham AAPL — Interactive Brokers' });
  await expect(aapl).toContainText('28.835.000');
  await expect(aapl).not.toContainText('182.500');
});

test('every way in reaches Investments and Add a holding: the Assets group, the picker and the inline form', async ({ page }) => {
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '1', price: '8.750', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();

  // §7.1: the last row of the Assets page's Investments group. Buy & sell gave up its Investments row when it became
  // four buttons and a history.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: 'By stock and broker' }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments$/);

  // §7.5: the corner on the Assets page opens the picker itself — no form unrolled over the list — and Listed
  // shares starts from a ticker.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: 'Add asset' }).click();
  await page.getByPlaceholder('Search everything that can be owned').pressSequentially('Listed shares');
  await page.getByRole('button', { name: 'Listed shares' }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments\/new$/);
  // The form opens first, as every other asset does: its first row is the ticker.
  await expect(page.getByRole('button', { name: /^Ticker/ })).toBeVisible();
  // Back returns to the list it was chosen from, still searched — not to Investments.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/new/);
  await expect(page.getByPlaceholder('Search everything that can be owned')).toHaveValue('Listed shares');

  // Through the Investments family, Back reopens that family.
  await page.getByPlaceholder('Search everything that can be owned').fill('');
  await page.getByRole('button', { name: /^Investments/ }).click();
  await page.getByRole('button', { name: 'Listed shares' }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments\/new$/);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Listed shares' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mutual fund' })).toBeVisible();

  // From Investments, Back returns to Investments.
  await page.goto('/net-worth/investments');
  await page.getByRole('link', { name: 'Add a holding' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments$/);
});

test.describe('with the list unreadable', () => {
  test.use({ serviceWorkers: 'block' });

  test('search says the list could not be read, and Name it myself still works (§6.3)', async ({ page }) => {
    await page.route(/\/assets\/idx-[^/]+\.js$/, (route) => void route.abort());
    await page.goto('/net-worth/investments/new');
    await page.getByRole('button', { name: /^Ticker/ }).click();
    await page.getByLabel('Ticker or name').pressSequentially('BBCA');
    await expect(page.getByText('The ticker list could not be read. Name it directly instead.')).toBeVisible();
    await page.getByRole('button', { name: /Name it myself/ }).click();
    await expect(page.getByLabel('Ticker', { exact: true })).toBeVisible();
  });
});

test('Add a holding shows every row from the start, and what was typed stays when the ticker is chosen after', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA', balance: '50000000' });
  await page.goto('/net-worth/investments/new');
  // One page, as Add asset: the ticker is its first row, and the rest are there before one is chosen.
  await expect(page.getByRole('button', { name: /^Ticker/ })).toContainText('Choose');
  await expect(page.getByLabel('Broker', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bought/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add holding' })).toBeDisabled();
  await page.getByLabel('Price per share', { exact: true }).pressSequentially('8750');

  await page.getByRole('button', { name: /^Ticker/ }).click();
  // A sheet over the form, not a page of its own: the address stays.
  await expect(page.getByRole('dialog', { name: 'Choose a ticker' })).toBeVisible();
  await expect(page).toHaveURL(/\/net-worth\/investments\/new$/);
  await page.getByLabel('Ticker or name').pressSequentially('BBCA');
  await page.getByRole('button', { name: /^BBCA\b/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Choose a ticker' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: /^Ticker/ })).toContainText('BBCA');
  await expect(page.getByLabel('Price per share', { exact: true })).toHaveValue(/^8\.?750$/);
  await expect(page.getByLabel('Lots', { exact: true })).toBeVisible();
});

test('a share owned before the app reads as a past purchase in the transaction list, not as an opening balance', async ({ page }) => {
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '1', price: '8.750', date: await todayIn(page) });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  // Out of the list unless asked for, as every opening is; asked for here.
  await page.evaluate(() => localStorage.setItem('transactions-show-opening', '1'));
  await page.goto('/transactions');
  await expect(page.getByText('Past purchase').first()).toBeVisible();
  await expect(page.getByText('Opening balance', { exact: true })).toHaveCount(0);
});
