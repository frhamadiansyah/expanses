import { expect, type Page, test } from '@playwright/test';
import { typePrice } from './asset-page';
import { addHoldingFlow } from './securities';

const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
const HOLDING = /\/net-worth\/assets\/[^/]+$/;
const ACROSS = /\/net-worth\/investments\/security\/[^/]+$/;

test.beforeEach(({ page }) => {
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('a stock at one broker opens its holding; at two, one page across them with a row per broker', async ({ page }) => {
  // One broker: the stock is that holding, so By stock opens the holding's own page, with its Buy.
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '12', price: '8.850' });
  await page.getByRole('button', { name: 'Add holding' }).tap();
  await expect(page).toHaveURL(HOLDING);
  await page.goto('/net-worth/investments');
  const bbca = page.getByTestId('stock-row').filter({ hasText: 'BBCA' });
  await expect(bbca).toContainText('one broker');
  await bbca.tap();
  await expect(page).toHaveURL(HOLDING);
  await expect(page.getByRole('button', { name: 'Buy', exact: true })).toBeVisible();

  // A second broker holding the same stock: Add holding lands on the stock across both.
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Ajaib' }, quantity: '3', price: '9.500' });
  await page.getByRole('button', { name: 'Add holding' }).tap();
  await expect(page).toHaveURL(ACROSS);
  await expect(page.getByRole('heading', { name: 'BBCA', exact: true })).toBeVisible();
  // A buy or a sell is at one broker, so this page has no round buttons and no Settings.
  await expect(page.getByRole('button', { name: 'Buy', exact: true })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);

  // A price typed on one holding values both; each row then reads its own gain, one up and one down.
  await page.getByTestId('held-at-row').filter({ hasText: 'Ajaib' }).tap();
  await expect(page).toHaveURL(HOLDING);
  await typePrice(page, '9.120');
  await page.goto('/net-worth/investments');
  await expect(bbca).toContainText('2 brokers');
  await bbca.tap();
  await expect(page).toHaveURL(ACROSS);

  const card = page.getByTestId('security-card');
  await expect(card).toContainText('Value now · all brokers');
  await expect(card).toContainText('13.680.000'); // 1.500 shares × 9.120
  await expect(card.getByTestId('asset-grid')).toContainText('15 lots · 1.500');
  await expect(card.getByTestId('asset-grid')).toContainText('Dividends this year');
  await expect(page.getByText('Institutions', { exact: true })).toBeVisible();
  const rows = page.getByTestId('held-at-row');
  await expect(rows).toHaveCount(2);
  const stockbit = rows.filter({ hasText: 'Stockbit' });
  const ajaib = rows.filter({ hasText: 'Ajaib' });
  await expect(stockbit).toContainText('12 lots · avg');
  await expect(stockbit).toContainText('10.944.000'); // 1.200 × 9.120
  await expect(stockbit.getByTestId('held-at-gain')).toHaveAttribute('data-tone', 'gain');
  await expect(ajaib).toContainText('3 lots · avg');
  await expect(ajaib.getByTestId('held-at-gain')).toHaveAttribute('data-tone', 'loss');
  await expect(page.getByText('Recent', { exact: true })).toBeVisible();
  await noSideScroll(page);
  if (process.env.STOCK_OVERALL_SHOT) await page.screenshot({ path: process.env.STOCK_OVERALL_SHOT, fullPage: true });

  // Each row opens its own holding.
  await stockbit.tap();
  await expect(page).toHaveURL(HOLDING);
  await expect(page.getByRole('heading', { name: /Stockbit/ })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(ACROSS);
  await ajaib.tap();
  await expect(page).toHaveURL(HOLDING);
  await expect(page.getByRole('heading', { name: /Ajaib/ })).toBeVisible();
});
