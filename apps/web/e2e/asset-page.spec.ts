import { expect, test } from '@playwright/test';
import { addEstimated, addPriced, openAsset, typePrice } from './asset-page';
import { mockRates } from './pockets';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Offline, unless a test answers for the rate service itself: gold follows the world price, and a fetch must not reach it. */
const offline = (page: import('@playwright/test').Page) => page.route('https://api.frankfurter.dev/**', (route) => void route.abort());

const DAY = /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/;

test('gold reads as grams, what went in, the average and the price, and each purchase shows its own gain', async ({ page }) => {
  await offline(page);
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [
    ['2025-09-19', '10', '20395000'],
    ['2026-07-11', '10', '25995000'],
  ]);
  await openAsset(page, 'Antam gold bars');
  // No price yet, and the world price could not be fetched: valued at what was paid, with ↻ to try again.
  await expect(page.getByTestId('price-line')).toHaveText('No price yet · ↻ to try again');
  await typePrice(page, '2485000');

  const grid = page.getByTestId('asset-grid');
  await expect(grid).toContainText('Total20 g');
  await expect(grid).toContainText('Invested');
  await expect(grid).toContainText('46.390.000');
  await expect(grid).toContainText('Average buy');
  await expect(grid).toContainText('2.319.500/g');
  // A price typed by hand is the owner's own, not the world's.
  await expect(grid).toContainText('Your price');
  await expect(grid).toContainText('2.485.000/g');
  const priceLine = (await page.getByTestId('price-line').innerText()).split(' · ');
  expect(priceLine[0]).toBe('Typed');
  expect(priceLine[1]).toMatch(DAY);

  await expect(page.getByText('Gold bullion · 20 g')).toBeVisible();
  // One card: the figure, its line over the month, and the four figures inside it; no chart of its own.
  const card = page.getByTestId('asset-card');
  await expect(card).toContainText('30 days ago');
  await expect(card.getByTestId('asset-grid')).toBeVisible();
  await expect(page.getByText('Last 12 months')).toHaveCount(0);
  const line = page.getByTestId('balance-line');
  const box = (await line.boundingBox())!;
  await line.click({ position: { x: box.width - 4, y: box.height / 2 } });
  await expect(page.getByTestId('net-worth-reading')).toContainText('49.700.000');
  await expect(page.getByTestId('asset-gain')).toContainText('+Rp');
  await expect(page.getByTestId('asset-gain')).toHaveAttribute('data-tone', 'gain');
  const rows = page.getByTestId('asset-history-row');
  await expect(page.getByRole('heading', { name: 'Purchases' })).toBeVisible();
  // Newest first: the July buy cost more a gram than today's buyback, the older one less.
  await expect(rows.first()).toContainText('Bought 10 g');
  await expect(rows.first()).toContainText('11 Jul 2026 · Rp 2.599.500/g');
  await expect(rows.first()).toContainText('−Rp 1.145.000');
  await expect(rows.nth(1)).toContainText('+Rp 4.455.000');

  // The price box opens on the last price, written with its thousands marks.
  await page.getByRole('button', { name: 'Price', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('2.485.000');
  await page.keyboard.press('Escape');

  // ⋮ on a purchase deletes it; the rest stands.
  await rows.first().getByRole('button', { name: /^More for/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByText('Gold bullion · 10 g')).toBeVisible();
});

test('a house takes a new value from a sheet that opens empty, and its history names each source in words', async ({ page }) => {
  await addEstimated(page, 'Land and/or building for living in', 'Family home', '2019-03-12', '1150000000', '1420000000');
  await openAsset(page, 'Family home');
  await expect(page.getByTestId('asset-grid')).toContainText('Bought on12 Mar 2019');

  await page.getByRole('button', { name: 'Update value' }).click();
  const value = page.getByLabel('Value (IDR)');
  await expect(value).toHaveValue('');
  await value.fill('1480000000');
  await page.getByLabel('From', { exact: true }).selectOption('appraisal');
  await page.getByLabel('Note').fill('Bank appraisal');
  await page.getByRole('button', { name: 'Save value' }).click();

  await expect(page.getByText('Rp 1.480.000.000').first()).toBeVisible();
  await expect(page.getByText(/· appraisal, \d{1,2} \w{3} \d{4} · \+Rp\s330\.000\.000 · \+28,7%/)).toBeVisible();
  // An estimate moves in steps: its line reads the year a month at a time.
  await expect(page.getByTestId('asset-card')).toContainText('12 months ago');
  await expect(page.getByRole('heading', { name: 'Value history' })).toBeVisible();
  const rows = page.getByTestId('asset-history-row');
  await expect(rows.first()).toContainText('Appraisal');
  await expect(rows.first()).toContainText('Bank appraisal');
  await expect(rows.last()).toContainText('Bought');
  await expect(rows.last()).toContainText('12 Mar 2019');

  // Opened again, it is empty again: the last source is no guess about the next.
  await page.getByRole('button', { name: 'Update value' }).click();
  await expect(page.getByLabel('Value (IDR)')).toHaveValue('');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('estimate');
  await expect(page.getByLabel('Note')).toHaveValue('');
});

test('a bond reads its price as a share of its face', async ({ page }) => {
  await addPriced(page, 'Government bonds (ORI, SBSN)', 'ORI026', [['2026-01-15', '10000000', '10000000']]);
  await openAsset(page, 'ORI026');
  await typePrice(page, '102');
  const grid = page.getByTestId('asset-grid');
  await expect(grid).toContainText('Face value');
  await expect(grid).toContainText('Price today102% of face');
  await expect(grid).toContainText('Average buy100% of face');
  await expect(page.getByText('Rp 10.200.000').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Coupon' })).toBeVisible();
});

test('a laptop worth less than it cost wears its loss in red', async ({ page }) => {
  await addEstimated(page, 'Electronics', 'Laptop', '2024-01-05', '22000000', '14000000');
  await openAsset(page, 'Laptop');
  const gain = page.getByTestId('asset-gain');
  await expect(gain).toHaveText('−Rp 8.000.000 · −36,4%');
  await expect(gain).toHaveAttribute('data-tone', 'loss');
  // The ⋯ holds settings, the rename and the archive — greyed while it holds anything.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /Archive/ })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: /Archive/ })).toContainText('Archiving is available once nothing is left');
});

test('Buy opens the Buy & sell form over the page with this holding already chosen', async ({ page }) => {
  await offline(page);
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2025-09-19', '10', '20395000']]);
  await openAsset(page, 'Antam gold bars');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Holding')).toHaveValue(/.+/);
  await expect(sheet.getByLabel('What happened')).toHaveValue('buy');
  await sheet.getByLabel('Units, shares or grams').fill('2');
  await sheet.getByLabel('What it cost, before fees (IDR)').fill('4970000');
  await sheet.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Gold bullion · 12 g')).toBeVisible();
  await expect(page.getByTestId('asset-history-row')).toHaveCount(2);
});

test('gold follows the world price: fetched as the page opens, said by name, and a typed price takes over', async ({ page }) => {
  await mockRates(page, { XAU: 74_639_548 });
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2025-09-19', '20', '46000000']]);
  await openAsset(page, 'Antam gold bars');
  // 74.639.548 an ounce is 2.399.717 a gram, to the whole rupiah; 20 g of it.
  await expect(page.getByTestId('price-line')).toHaveText(/^World price \(XAU\) · \d{1,2} \w{3} \d{4}$/);
  await expect(page.getByText('Rp 47.994.340').first()).toBeVisible();
  const grid = page.getByTestId('asset-grid');
  await expect(grid).toContainText('World price');
  await expect(grid).toContainText('Rp 2.399.717/g');
  await expect(grid).not.toContainText(',19');
  await expect(grid).toContainText('not buyback');
  await grid.getByRole('button', { name: 'About World price' }).click();
  await expect(page.getByText(/buys gold back a few percent below it/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Price source/ })).toContainText('World price');

  // A price typed for today is the day's price, and ↻ does not take it back.
  await typePrice(page, '2485000');
  await expect(page.getByTestId('price-line')).toHaveText(/^Typed · /);
  await expect(grid).toContainText('Your price');
  await expect(page.getByText('Rp 49.700.000').first()).toBeVisible();
  await page.getByRole('button', { name: 'Fetch today’s world price' }).click();
  await expect(page.getByTestId('price-line')).toHaveText(/^Typed · /);
  await expect(page.getByText('Rp 49.700.000').first()).toBeVisible();
});

test('gold set to “I’ll type it” is never fetched, keeps its prices, and fetches again when set back', async ({ page }) => {
  let asked = 0;
  await page.route('https://api.frankfurter.dev/**', (route) => {
    asked += 1;
    return route.fulfill({ json: [{ date: new URL(route.request().url()).searchParams.get('date'), base: 'XAU', quote: 'IDR', rate: 74_639_548 }] });
  });
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2025-09-19', '20', '46000000']]);
  await openAsset(page, 'Antam gold bars');
  await expect(page.getByTestId('price-line')).toHaveText(/^World price \(XAU\)/);

  await page.getByRole('button', { name: /^Price source/ }).click();
  await expect(page.getByRole('button', { name: /World price \(XAU\)/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Updated daily · spot price, not buyback')).toBeVisible();
  await page.getByRole('button', { name: /I'll type it/ }).click();
  await expect(page.getByRole('button', { name: /^Price source/ })).toContainText("I'll type it");
  // No ↻, and the price it has stays.
  await expect(page.getByRole('button', { name: 'Fetch today’s world price' })).toHaveCount(0);
  await expect(page.getByText('Rp 47.994.340').first()).toBeVisible();

  const before = asked;
  await page.reload();
  await expect(page.getByText('Value now')).toBeVisible();
  await expect(page.getByTestId('price-line')).toBeVisible();
  expect(asked).toBe(before);
  await expect(page.getByTestId('asset-grid')).toContainText('World price');

  await page.getByRole('button', { name: /^Price source/ }).click();
  await page.getByRole('button', { name: /World price \(XAU\)/ }).click();
  await expect(page.getByRole('button', { name: 'Fetch today’s world price' })).toBeVisible();
});
