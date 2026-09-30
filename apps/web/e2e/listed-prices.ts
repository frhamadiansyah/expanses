import { expect, type Page, type Route } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { addHoldingFlow } from './securities';

/** Every request to Yahoo Finance's chart endpoint; a spec answers them itself, so nothing reaches Yahoo. */
export const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/**';

/** IDX's Ringkasan Saham for 29 Sep 2026, five rows (ASII, BBCA 6.150, BBRI, BMRI, TLKM), shared with core's parser tests. */
export const IDX_FILE = fileURLToPath(new URL('../../../packages/core/test/fixtures/ringkasan-saham-20260929.xlsx', import.meta.url));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Yesterday on IDX's calendar (Asia/Jakarta), as an ISO date and as the app writes it ("29 Sep 2026"). */
export function yesterdayOnIdx(): { iso: string; label: string; seconds: number } {
  const jakarta = new Date(Date.now() + 7 * 3_600_000);
  const day = new Date(Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate() - 1));
  return {
    iso: day.toISOString().slice(0, 10),
    label: `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`,
    // 09:00 WIB that day, where Yahoo stamps an IDX daily bar.
    seconds: day.getTime() / 1000 + 2 * 3600,
  };
}

/** Yahoo's chart for BBCA.JK: yesterday's close, the session long over. */
export function yahooChart(close: number, currency = 'IDR') {
  const { seconds } = yesterdayOnIdx();
  return {
    chart: {
      result: [
        {
          meta: { currency, symbol: 'BBCA.JK', exchangeTimezoneName: 'Asia/Jakarta', gmtoffset: 25200, regularMarketPrice: close, currentTradingPeriod: { regular: { start: seconds, end: seconds + 26_100 } } },
          timestamp: [seconds - 86_400, seconds],
          indicators: { quote: [{ close: [close + 75, close] }] },
        },
      ],
      error: null,
    },
  };
}

/** Answers Yahoo with a close (and counts the asks), or refuses it as a browser offline would. */
export async function routeYahoo(page: Page, answer: { close: number } | 'offline'): Promise<{ asked: () => number }> {
  let asked = 0;
  await page.unroute(YAHOO);
  await page.route(YAHOO, (route: Route) => {
    asked += 1;
    return answer === 'offline' ? route.abort() : route.fulfill({ json: yahooChart(answer.close) });
  });
  return { asked: () => asked };
}

/** Forgets the day's Yahoo asks, so the next open asks again. */
export async function forgetYahooAsks(page: Page) {
  await page.evaluate(() => localStorage.removeItem('yahoo-close-asked'));
}

/** Ten lots of BBCA at Stockbit, owned before the app: the holding every listed-price spec prices. */
export async function holdBbca(page: Page) {
  await addHoldingFlow(page, { search: 'BBCA', broker: { new: 'Stockbit' }, quantity: '10', price: '8.750', paidFrom: 'Owned before this app' });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'BBCA' })).toBeVisible();
}
