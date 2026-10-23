import { expect, type Route, test } from '@playwright/test';
import { YAHOO, yahooChart } from './listed-prices';
import { addHoldingFlow } from './securities';
import { todayIn } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

/** Yahoo's chart with dividends on these days (09:00 in Jakarta), in rupiah per share. */
const withDividends = (paid: { on: string; perShare: number }[]) => {
  const chart = yahooChart(6_150);
  const dividends = Object.fromEntries(
    paid.map(({ on, perShare }) => {
      const at = Date.parse(`${on}T02:00:00Z`) / 1000;
      return [String(at), { amount: perShare, date: at }];
    }),
  );
  return { chart: { ...chart.chart, result: [{ ...chart.chart.result[0], events: { dividends } }] } };
};

test('Dividends shows a year at today’s holdings, both yields and who pays it, from Yahoo’s history', async ({ page }) => {
  const paidOn = await todayIn(page, 100);
  await page.route(YAHOO, (route: Route) =>
    route.fulfill({ json: route.request().url().includes('events=div') ? withDividends([{ on: paidOn, perShare: 50 }]) : yahooChart(6_150) }),
  );
  // Ten lots, owned well before the dividend: 1.000 shares × Rp 50 = Rp 50.000 a year, on Rp 8.750.000 put in.
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', date: await todayIn(page, 400) });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();

  // The Assets corner opens Income, where the dividends are read.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: 'Income', exact: true }).click();
  const hero = page.getByTestId('dividends-year');
  await expect(hero).toContainText('50.000');
  await expect(hero).toContainText('a month');
  await expect(page.getByText('Yield on cost', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Yield on cost', { exact: true })).toHaveText('0,6%');
  // The two tiles under the hero, and the one bar among the twelve in the hero: paid when the ex-date was this year,
  // still to come (last year's payment, unmatched yet) when it fell before 1 January.
  const thisYear = paidOn.slice(0, 4) === (await todayIn(page)).slice(0, 4);
  await expect(page.getByLabel('Received this year', { exact: true })).toHaveText(thisYear ? /50\.000/ : /^Rp\s?0$/);
  await expect(page.getByLabel('Still to come', { exact: true })).toHaveText(thisYear ? /^Rp\s?0$/ : /50\.000/);
  await expect(hero.getByTestId('income-month-paid')).toHaveCount(thisYear ? 1 : 0);
  await expect(hero.getByTestId('income-month-due')).toHaveCount(thisYear ? 0 : 1);
  // The spending it covers explains itself behind an ⓘ, not a line always under the row.
  await expect(page.getByText(/spent in the last 12 months/)).toHaveCount(0);

  const payer = page.getByTestId('dividend-payer');
  await expect(payer).toHaveCount(1);
  await expect(payer).toContainText('BBCA');
  await expect(payer).toContainText('100%');

  // The bars are the way into Month by month, where the month is named with its payer.
  await hero.getByRole('button', { name: 'Month by month' }).click();
  const sheet = page.getByRole('dialog', { name: 'Month by month' });
  await expect(sheet).toContainText('BBCA');
  await expect(sheet).toContainText('50.000');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  await payer.click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
});

test('a share Yahoo cannot answer for is named, not counted as paying nothing', async ({ page }) => {
  await page.route(YAHOO, (route: Route) => route.abort());
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', date: await todayIn(page, 400) });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
  await page.goto('/net-worth/investments/dividends');
  await expect(page.getByText(/No dividend history could be read for BBCA/)).toBeVisible();
});
