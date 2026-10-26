import { expect, test } from '@playwright/test';
import { fakeWorldGold, goldBoughtLately, openChart } from './gold-chart';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('Chart: the world price a gram over a year, the buy on it, today’s price and the average bought at', async ({ page }) => {
  await fakeWorldGold(page);
  await goldBoughtLately(page);
  const sheet = await openChart(page);

  const range = sheet.getByRole('radiogroup', { name: 'Range' });
  await expect(range.getByRole('radio')).toHaveText(['1M', '6M', '1Y', '5Y']);
  await expect(range.getByRole('radio', { name: '1Y' })).toHaveAttribute('aria-checked', 'true');

  await expect(sheet.getByTestId('gold-line')).toBeVisible();
  const dots = sheet.getByTestId('gold-dot');
  await expect(dots).toHaveCount(1);
  await expect(dots.first()).toHaveAttribute('data-kind', 'buy');
  await expect(dots.first()).toHaveAttribute('fill', 'var(--ph-up)');
  await expect(sheet.getByTestId('gold-chart-legend')).toHaveText('● bought · ● sold');
  await expect(sheet).toContainText('World gold price');

  // Today's price is the world price the page fetched; the average is what the 10 g cost.
  await expect(sheet.getByLabel(/^Now · \d{1,2} \w{3} \d{4}$/)).toHaveText(/Rp\s2\.100\.000\/g/);
  await expect(sheet.getByLabel('Average bought at')).toHaveText(/Rp\s2\.000\.000\/g/);

  // A month back reaches no further than the buy, 90 days ago: the line stays, the dot goes.
  await range.getByRole('radio', { name: '1M' }).click();
  await expect(range.getByRole('radio', { name: '1M' })).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('gold-line')).toBeVisible();
  await expect(dots).toHaveCount(0);
  await expect(sheet.getByText('1 month ago')).toBeVisible();

  await range.getByRole('radio', { name: '5Y' }).click();
  await expect(dots).toHaveCount(1);
});

test('Chart offline says the history needs a connection and still shows the rows', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await goldBoughtLately(page);
  const sheet = await openChart(page);
  await expect(sheet.getByTestId('gold-chart-note')).toHaveText('The price history needs a connection.');
  await expect(sheet.getByTestId('gold-line')).toHaveCount(0);
  await expect(sheet.getByLabel('Average bought at')).toHaveText(/Rp\s2\.000\.000\/g/);
});
