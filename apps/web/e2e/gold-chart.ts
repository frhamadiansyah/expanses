import { expect, type Page } from '@playwright/test';
import { addPriced, openAsset } from './asset-page';

export const GOLD = 'Chart gold bars';

/** A day `days` before today, as the app writes one. */
export const daysAgo = (days: number) => {
  const day = new Date(Date.now() - days * 86_400_000);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};

/** An ounce in rupiah that comes to Rp 2.100.000 a gram (31,1034768 g an ounce). */
const OUNCE = 65_317_301.28;

/**
 * The rate service, faked: a day's world price for the page's own fetch, and every day of a range for the chart, the
 * price rising a rupiah a day so the line has somewhere to go.
 */
export async function fakeWorldGold(page: Page) {
  await page.route('https://api.frankfurter.dev/**', (route) => {
    const asked = new URL(route.request().url()).searchParams;
    const date = asked.get('date');
    if (date) return route.fulfill({ json: [{ date, base: 'XAU', quote: 'IDR', rate: OUNCE }] });
    const rows: { date: string; base: string; quote: string; rate: number }[] = [];
    const end = new Date(`${asked.get('to')}T00:00:00Z`);
    for (let day = new Date(`${asked.get('from')}T00:00:00Z`), index = 0; day <= end; day = new Date(day.getTime() + 86_400_000), index += 1) {
      rows.push({ date: day.toISOString().slice(0, 10), base: 'XAU', quote: 'IDR', rate: OUNCE + index * 31.1 });
    }
    return route.fulfill({ json: rows });
  });
}

/** 10 g of gold bought 90 days ago for Rp 20.000.000 — Rp 2.000.000 a gram — and its page open. */
export async function goldBoughtLately(page: Page) {
  await addPriced(page, 'Gold bullion', GOLD, [[daysAgo(90), '10', '20000000']]);
  await openAsset(page, GOLD);
}

/** The round buttons in their order, and the Chart sheet opened from the third. */
export async function openChart(page: Page) {
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText(['Buy', 'Sell', 'Chart', 'Price']);
  await page.getByRole('button', { name: 'Chart', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Price per gram' })).toBeVisible();
  return sheet;
}
