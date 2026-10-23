import { expect, type Page, test } from '@playwright/test';
import { openAssets } from './drawers';
import { addHoldingFlow, tokenColour } from './securities';
import { addMoneyAccount } from './set-aside';

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test.beforeEach(({ page }) => {
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('every securities screen fits a 390 px phone and is reached by thumb', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', paidFrom: 'BCA Tahapan (IDR)' });
  await expect(page.getByLabel('Total')).toHaveText(/8\.750\.000$/);
  await noSideScroll(page);
  await page.getByRole('button', { name: 'Add holding' }).tap();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await noSideScroll(page);
  // Held at one broker, the stock is that holding's page: its price is typed from there.
  await page.getByRole('button', { name: 'Price', exact: true }).tap();
  await expect(page.getByRole('dialog').getByRole('textbox')).toBeVisible();
  await noSideScroll(page);
  // One broker: Assets lists the holding itself.
  await openAssets(page);
  await expect(page.getByRole('link', { name: /^BBCA/ })).toContainText('8.750.000');
  await noSideScroll(page);
  // The broker's own account lists what it keeps.
  await page.getByRole('link', { name: /^Stockbit/ }).first().tap();
  await expect(page.getByTestId('broker-holding').filter({ hasText: 'BBCA' })).toContainText('8.750.000');
  await noSideScroll(page);
});

test('a dollar stock named by hand and owned before asks the day\u2019s rate on the phone', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addHoldingFlow(page, {
    search: 'AAPL', nameIt: { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD' },
    broker: { new: 'Interactive Brokers', currency: 'USD' }, quantity: '10', price: '182,50', rate: '15800',
  });
  await noSideScroll(page);
  await page.getByRole('button', { name: 'Add holding' }).tap();
  await expect(page.getByRole('heading', { name: 'AAPL' })).toBeVisible();
  await noSideScroll(page);
  await openAssets(page);
  await expect(page.getByRole('link', { name: /^AAPL/ })).toContainText('1.825,00');
  await noSideScroll(page);
});

test('the investments screens follow dark mode through the kit’s tokens', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  for (const path of ['/net-worth/assets', '/net-worth/investments/new', '/settings/developer']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    // The same comparison phone-dark-shell.spec.ts makes: the page ground is the dark token's colour, resolved.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(await tokenColour(page, '--ph-ground'));
    expect(await tokenColour(page, '--ph-ground')).toBe('rgb(0, 0, 0)');
  }
});
