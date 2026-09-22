import { expect, type Page, test } from '@playwright/test';
import { addHoldingFlow, tokenColour } from './securities';
import { addMoneyAccount } from './set-aside';

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test.beforeEach(({ page }) => {
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('every securities screen fits a 390 px phone and is reached by thumb', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', paidFrom: 'BCA Tahapan (IDR)' });
  await expect(page.getByLabel('Total')).toHaveValue(/8\.750\.000$/);
  await noSideScroll(page);
  await page.getByRole('button', { name: 'Add holding' }).tap();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await noSideScroll(page);
  await page.getByRole('link', { name: /Price today/ }).tap();
  await expect(page.getByLabel('Price (IDR)')).toBeVisible();
  await noSideScroll(page);
  await page.goto('/net-worth/investments');
  await expect(page.getByTestId('stock-row').filter({ hasText: 'BBCA' })).toContainText('8.750.000');
  await noSideScroll(page);
  // Add a holding is the corner glyph here too.
  await expect(page.getByRole('link', { name: 'Add a holding' })).toBeVisible();
  await page.getByTestId('broker-row').filter({ hasText: 'Stockbit' }).tap();
  await expect(page.getByText('8.750.000').first()).toBeVisible();
  await noSideScroll(page);
});

test('a dollar stock named by hand and paid in rupiah reads its rate and rupiah cost on the phone', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addHoldingFlow(page, {
    search: 'AAPL', nameIt: { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD' },
    broker: { new: 'Interactive Brokers', currency: 'USD' }, quantity: '10', price: '182,50', paidFrom: 'BCA Tahapan (IDR)', charged: '28.835.000',
  });
  await expect(page.getByLabel('Rate that day')).toHaveValue('15.800 IDR per 1 USD');
  await expect(page.getByLabel('Cost in IDR')).toHaveValue(/28\.835\.000$/);
  await noSideScroll(page);
  await page.getByRole('button', { name: 'Add holding' }).tap();
  await expect(page.getByRole('heading', { name: 'AAPL' })).toBeVisible();
  await noSideScroll(page);
  await page.goto('/net-worth/investments');
  await expect(page.getByTestId('stock-row').filter({ hasText: 'AAPL' })).toContainText('1.825,00');
  await noSideScroll(page);
});

test('the investments screens follow dark mode through the kit’s tokens', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['/net-worth/investments', '/net-worth/investments/new', '/settings/developer']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    // The same comparison phone-dark-shell.spec.ts makes: the page ground is the dark token's colour, resolved.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(await tokenColour(page, '--ph-ground'));
    expect(await tokenColour(page, '--ph-ground')).toBe('rgb(0, 0, 0)');
  }
});
