import { expect, test } from '@playwright/test';
import { expectBalance, startReport } from './deposit-maturity';
import { addHoldingFlow, BBCA_BY_HAND, setForeignList } from './securities';
import { addMoneyAccount, goalCard, jeniusWithTwoGoals } from './set-aside';
import { todayIn } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('1–4: BBCA at two brokers is one stock, one price values both, and the bank moved by exactly what was paid', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', fee: '13.125', paidFrom: 'BCA Tahapan (IDR)' });
  await expect(page.getByLabel('Total')).toHaveValue(/8\.750\.000$/); // 10 lots × 100 × 8.750
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await expectBalance(page, 'BCA Tahapan', '41.236.875'); // 50.000.000 − 8.750.000 − 13.125

  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Mandiri Sekuritas' }, quantity: '5', price: '9.400', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await expectBalance(page, 'BCA Tahapan', '41.236.875');

  // BBCA is held now, so it is picked from You hold, and Stockbit says what it holds.
  await addHoldingFlow(page, { search: 'BBCA', broker: 'Stockbit · you hold 1.000', quantity: '5', price: '9.000', paidFrom: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await expectBalance(page, 'BCA Tahapan', '36.736.875'); // − 500 × 9.000

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

test('5: a free user names AAPL, pays in rupiah, and the rupiah cost is exactly what left', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addHoldingFlow(page, {
    search: 'AAPL', nameIt: { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD' },
    broker: { new: 'Interactive Brokers', currency: 'USD' }, quantity: '10', price: '182,50', paidFrom: 'BCA Tahapan (IDR)', charged: '28.835.000',
  });
  await expect(page.getByLabel('Rate that day')).toHaveValue('15.800 IDR per 1 USD');
  await expect(page.getByLabel('Cost in IDR')).toHaveValue(/28\.835\.000$/);
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'AAPL' })).toBeVisible();
  await expectBalance(page, 'BCA Tahapan', '21.165.000');
});

test('9: a free user’s search for AAPL finds nothing on IDX and offers Name it myself', async ({ page }) => {
  // Reached from the Investments corner, as the owner would.
  await page.goto('/net-worth/investments');
  await page.getByRole('link', { name: 'Add a holding' }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments\/new$/);
  await page.getByLabel('Ticker or name').pressSequentially('AAPL');
  await expect(page.getByText('Nothing on IDX matches AAPL')).toBeVisible();
  await expect(page.getByRole('button', { name: /Name it myself/ })).toBeVisible();
});

test('9 (the list): the same search finds BBCA, so the empty answer is about the market, not a failure', async ({ page }) => {
  await page.goto('/net-worth/investments/new');
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
  await page.getByLabel('Ticker or name').pressSequentially('AAP');
  await expect(page.getByText('You hold', { exact: true })).toBeVisible();
  await page.getByLabel('Ticker or name').fill('');
  await page.getByLabel('Ticker or name').pressSequentially('MSFT');
  await expect(page.getByText('Nothing on IDX matches MSFT')).toBeVisible(); // the US list is no longer searched
});

test('11: a holding recorded before is given its ticker and broker; its lot setting goes to the security', async ({ page }) => {
  await addMoneyAccount(page, 'Stockbit', 'fund', '0');
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('stock');
  await page.getByLabel('Name', { exact: true }).fill('BBCA old');
  await page.getByLabel('Bought on').fill(await todayIn(page, 200));
  await page.getByLabel('How much').pressSequentially('100');
  await page.getByLabel('Total cost (IDR)').pressSequentially('875.000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await page.getByRole('link', { name: /BBCA old/ }).click();
  await expect(page.getByLabel('Shares in a lot')).toHaveCount(1); // shown while it has no security
  await page.getByRole('link', { name: /Ticker/ }).click();
  await page.getByLabel('Ticker or name').pressSequentially('BBCA');
  await page.getByRole('button', { name: /^BBCA\b/ }).first().click();
  await page.getByLabel('Kept at').selectOption({ label: 'Stockbit' });
  await expect(page.getByText(/The price is BBCA’s/)).toBeVisible();
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
    broker: { new: 'Interactive Brokers', currency: 'USD' }, quantity: '10', price: '182,50', paidFrom: 'BCA Tahapan (IDR)', charged: '28.835.000',
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

test('the Add a holding form is a set-aside door: a buy that takes promised money asks which goal paid', async ({ page }) => {
  await jeniusWithTwoGoals(page); // Jenius Rp 42.500.000, Rp 37.500.000 promised: Rp 5.000.000 free
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '6.800', paidFrom: 'Jenius (IDR)' });
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const add = page.getByRole('button', { name: 'Add holding' });
  await expect(add).toBeDisabled();
  await page.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await page.getByRole('button', { name: 'No — borrowing from it' }).click();
  await add.click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await page.goto('/goals');
  await expect(goalCard(page, 'Emergency fund').getByText(/short by Rp.1\.800\.000/i).first()).toBeVisible();
});

test('a buy with no broker names the holding it adds to — and, with two, which one and how to reach the other', async ({ page }) => {
  await addHoldingFlow(page, { search: 'BBCA', broker: 'No broker', quantity: '1', price: '8.750', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await addHoldingFlow(page, { search: 'BBCA', broker: 'No broker', quantity: '1', price: '9.000', paidFrom: 'Owned before this app' });
  await expect(page.getByText('This adds to BBCA, your BBCA with no broker named.')).toBeVisible();
  await expect(page.getByLabel('Total')).toHaveValue(/900\.000$/);
  // m6: the note is about a buy with no broker. Kept at a broker, the buy lands there, and the note is gone.
  await page.getByLabel('Where is it kept').selectOption({ label: 'Another broker…' });
  await expect(page.getByText(/This adds to/)).toHaveCount(0);

  // m7: the same stock named by hand is the stock already held, so the form says which holding it joins.
  await addHoldingFlow(page, { search: 'BBCA', nameIt: BBCA_BY_HAND, broker: 'No broker', quantity: '1', price: '9.000', paidFrom: 'Owned before this app' });
  await expect(page.getByText('This adds to BBCA, your BBCA with no broker named.')).toBeVisible();

  // A holding from before, linked to BBCA with no broker: now there are two, and the form never picks silently.
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('stock');
  await page.getByLabel('Name', { exact: true }).fill('BBCA old');
  await page.getByLabel('Bought on').fill(await todayIn(page, 200));
  await page.getByLabel('How much').pressSequentially('100');
  await page.getByLabel('Total cost (IDR)').pressSequentially('875.000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await page.getByRole('link', { name: /BBCA old/ }).click();
  await page.getByRole('link', { name: /Ticker/ }).click();
  await page.getByLabel('Ticker or name').pressSequentially('BBCA');
  await page.getByRole('button', { name: /^BBCA\b/ }).first().click();
  await expect(page.getByText(/The price is BBCA’s/)).toBeVisible();

  await addHoldingFlow(page, { search: 'BBCA', broker: 'No broker', quantity: '1', price: '9.000', paidFrom: 'Owned before this app' });
  await expect(
    page.getByText('You hold BBCA twice with no broker named. This adds to BBCA, the first recorded; to add to BBCA old instead, record the buy on Buy & sell.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  // It went on the one it named: BBCA now holds 200 shares (100 × 8.750 + 100 × 9.000), BBCA old still its 100.
  await page.goto('/net-worth/investments/broker/none');
  await expect(page.getByRole('row').filter({ hasText: '1.775.000' })).toContainText('200');
  await expect(page.getByRole('row').filter({ hasText: 'Rp 875.000' })).toContainText('100');
});

test('every way in reaches Investments and Add a holding: Buy & sell, the Assets group, the picker and the inline form', async ({ page }) => {
  await addHoldingFlow(page, { search: 'BBCA', broker: 'No broker', quantity: '1', price: '8.750', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();

  // §7.1: a row at the top of Buy & sell, and the last row of the Assets page's Investments group.
  await page.goto('/net-worth/trades');
  await page.getByRole('link', { name: /^Investments/ }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments$/);
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: 'By stock and broker' }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments$/);

  // §7.5: Listed shares in the Add asset picker starts from a ticker.
  await page.goto('/net-worth/assets/new');
  await page.getByPlaceholder('Search everything you can own').pressSequentially('Listed shares');
  await page.getByRole('button', { name: 'Listed shares' }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments\/new$/);
  await expect(page.getByLabel('Ticker or name')).toBeVisible();

  // …and the inline Add asset form keeps its fields, with Find it by ticker above them.
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('stock');
  await expect(page.getByLabel('How much')).toBeVisible();
  await page.getByRole('link', { name: 'Find it by ticker' }).click();
  await expect(page).toHaveURL(/\/net-worth\/investments\/new$/);
});

test.describe('with the list unreadable', () => {
  test.use({ serviceWorkers: 'block' });

  test('search says the list could not be read, and Name it myself still works (§6.3)', async ({ page }) => {
    await page.route(/\/assets\/idx-[^/]+\.js$/, (route) => void route.abort());
    await page.goto('/net-worth/investments/new');
    await page.getByLabel('Ticker or name').pressSequentially('BBCA');
    await expect(page.getByText('The ticker list could not be read. Name it yourself instead.')).toBeVisible();
    await page.getByRole('button', { name: /Name it myself/ }).click();
    await expect(page.getByLabel('Ticker', { exact: true })).toBeVisible();
  });
});
