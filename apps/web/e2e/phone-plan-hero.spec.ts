import { expect, type Locator, type Page, test } from '@playwright/test';
import { addEvent, addWallet, buyItNow, fillItem } from './event-plan';
import { mockRates } from './pockets';

/*
 * The plan page's ring card and the paid rows, by thumb.
 *
 * The trip is planned in lira, the workspace stays in rupiah: the flight is priced in rupiah, the museum pass in euros,
 * the dinner in lira, the guide in dollars (which has no rate). Flight paid under its estimate and the museum pass paid
 * over it give the card both of its difference lines and the rows both of their arrows.
 */

async function pickCurrency(page: Page, from: string, to: string) {
  await page.getByRole('button', { name: `Currency: ${from}` }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: new RegExp(`^${to} `) }).first().click();
}

/** A cost with a currency of its own, picked before the form is filled and saved. */
async function addCost(page: Page, fields: { name: string; price: string; currency?: string }) {
  await page.getByRole('link', { name: 'Add a cost' }).first().click();
  await page.getByLabel('What', { exact: true }).fill(fields.name);
  if (fields.currency) await pickCurrency(page, 'TRY', fields.currency);
  await fillItem(page, { ...fields, category: 'Food and beverage' });
}

/** What a colour token comes to on this page, as the browser computes it, so a style can be compared with it. */
async function token(page: Page, name: string) {
  return page.evaluate((variable) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${variable})`;
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, name);
}

const colourOf = (spot: Locator) => spot.evaluate((el) => getComputedStyle(el).color);

async function payCost(page: Page, name: string, paid: string) {
  await page.getByTestId('plan-item').filter({ hasText: name }).getByRole('link').click();
  await buyItNow(page, { paid });
}

test('the ring card and the paid rows', async ({ page }) => {
  // One euro is Rp 18.000 and one lira Rp 400; there is no dollar rate.
  await mockRates(page, { EUR: 18_000, TRY: 400 });
  await addWallet(page);

  await page.goto('/events');
  await page.getByRole('button', { name: /^(Add an event|New event)$/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Turkey trip');
  await page.getByRole('button', { name: 'Currency: IDR' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: /^TRY / }).first().click();
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Turkey trip', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Plan what to pay' }).click();

  await page.getByRole('link', { name: 'Add the first cost' }).click();
  await page.getByLabel('What', { exact: true }).fill('Flight');
  await pickCurrency(page, 'TRY', 'IDR');
  await fillItem(page, { name: 'Flight', price: '9800000', category: 'Food and beverage' });
  await addCost(page, { name: 'Museum pass', price: '95', currency: 'EUR' });
  await addCost(page, { name: 'Dinner', price: '1800' });
  await addCost(page, { name: 'Guide', price: '50', currency: 'USD' });

  const card = page.getByTestId('plan-totals');
  const hero = async (id: string) => ((await page.getByTestId(id).innerText()) ?? '').replace(/\s+/g, ' ').trim();

  // The words: Estimate and Actual, never Planned or Bought; the missing rate is said on the cost, not on the card.
  await expect(page.getByTestId('plan-planned')).toContainText('Estimate');
  await expect(page.getByTestId('plan-actual')).toContainText('Actual');
  await expect(card).not.toContainText('Planned');
  await expect(card).not.toContainText('Bought');
  await expect(card).not.toContainText(/rate yet/i);
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Guide' })).toContainText('no rate yet');
  await expect(page.getByTestId('plan-difference')).toHaveCount(0);

  // The base equivalent under each of the three figures, because the trip is not in rupiah.
  for (const id of ['plan-to-go-base', 'plan-planned-base', 'plan-actual-base']) await expect(page.getByTestId(id)).toContainText(/^≈ Rp/);

  // The ring is as tall as the text beside it, and starts where it starts.
  const measure = async () => {
    const ring = (await page.getByTestId('plan-ring').boundingBox())!;
    const text = (await page.getByTestId('plan-count').locator('..').boundingBox())!;
    return { ring, text };
  };
  const before = await measure();
  expect(Math.abs(before.ring.height - before.text.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.ring.width - before.ring.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(before.ring.y - before.text.y)).toBeLessThanOrEqual(1);

  // Nothing wraps or runs out of the card.
  const fits = () =>
    card.evaluate((el) => {
      const right = el.getBoundingClientRect().right;
      const inside = [...el.querySelectorAll<HTMLElement>('[data-testid^="plan-"]')].every((part) => part.getBoundingClientRect().right <= right + 0.5);
      return { scroll: el.scrollWidth <= el.clientWidth, inside };
    });
  expect(await fits()).toEqual({ scroll: true, inside: true });

  // Museum pass paid over its estimate: Rp 2.000.000 is ₺ 5.000 against ₺ 4.275.
  await payCost(page, 'Museum pass', '2000000');
  await expect(page.getByTestId('plan-difference')).toHaveText(/725.* over the estimate/);
  await expect(page.getByTestId('plan-difference')).toHaveCSS('color', await token(page, '--ph-alarm'));
  // Flight paid under: Rp 9.000.000 is ₺ 22.500 against ₺ 24.500.
  await payCost(page, 'Flight', '9000000');
  await expect(page.getByTestId('plan-difference')).toHaveText(/1\.275.* under the estimate/);
  await expect(page.getByTestId('plan-difference')).toHaveCSS('color', await token(page, '--ph-up'));
  expect(await hero('plan-count')).toBe('2 of 4 paid');
  // The actual is plain ink, never green.
  await expect(page.getByTestId('plan-actual').locator('span').last()).toHaveCSS('color', await token(page, '--ph-ink'));
  const after = await measure();
  expect(Math.abs(after.ring.height - after.text.height)).toBeLessThanOrEqual(1);
  expect(await fits()).toEqual({ scroll: true, inside: true });

  // The rows: paid costs in ink, an arrow on the amount's line, the estimate under it in the quiet grey.
  const ink = await token(page, '--ph-ink');
  const quiet = await token(page, '--ph-ink-3');
  const flight = page.getByTestId('plan-item').filter({ hasText: 'Flight' });
  const museum = page.getByTestId('plan-item').filter({ hasText: 'Museum pass' });
  const dinner = page.getByTestId('plan-item').filter({ hasText: 'Dinner' });
  for (const row of [flight, museum]) {
    await expect(row.getByText(/^(Flight|Museum pass)$/)).toHaveCSS('color', ink);
    expect(await colourOf(row.getByText(/^of /))).toBe(quiet);
    expect(await colourOf(row.getByText(/^of /))).not.toBe(ink);
  }
  const down = flight.getByLabel('Under the estimate');
  const up = museum.getByLabel('Over the estimate');
  await expect(down).toHaveCSS('color', await token(page, '--ph-up'));
  await expect(up).toHaveCSS('color', await token(page, '--ph-alarm'));
  await expect(down).toHaveCSS('margin-right', '5px');
  await expect(down).toHaveCSS('font-size', '10px');
  await expect(flight.getByText(/^of /)).toHaveText(/^of ≈ .*24\.500/);
  await expect(museum.getByText(/^of /)).toHaveText(/^of ≈ .*4\.275/);
  await expect(flight.getByLabel('Over the estimate')).toHaveCount(0);
  await expect(museum.getByLabel('Under the estimate')).toHaveCount(0);
  // The arrow is on the first line of the figure and the estimate is under it.
  for (const [arrow, row] of [[down, flight], [up, museum]] as const) {
    const a = (await arrow.boundingBox())!;
    const of = (await row.getByText(/^of /).boundingBox())!;
    expect(a.y + a.height).toBeLessThanOrEqual(of.y + 1);
    expect(a.x + a.width).toBeLessThan(of.x + of.width);
  }
  // The left line no longer carries the difference, and a cost still to pay has the one line.
  await expect(flight).not.toContainText(/[+−]\s?Rp/);
  await expect(museum).not.toContainText(/[+−]\s?(Rp|€|₺)/);
  await expect(dinner.getByLabel(/the estimate$/)).toHaveCount(0);
  await expect(dinner.getByText(/^of /)).toHaveCount(0);
  expect(await colourOf(dinner.getByText('Dinner', { exact: true }))).toBe(ink);
});

test('an event in the workspace currency has no base equivalents on the card', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Coast week');
  await page.getByRole('link', { name: 'Plan what to pay' }).click();
  await page.getByRole('link', { name: 'Add the first cost' }).click();
  await fillItem(page, { name: 'Tickets', quantity: '6', price: '55000', category: 'Food and beverage' });
  await expect(page.getByTestId('plan-totals')).toContainText('Estimate');
  for (const id of ['plan-to-go-base', 'plan-planned-base', 'plan-actual-base']) await expect(page.getByTestId(id)).toHaveCount(0);
  // The plan's arithmetic stays on the left of a cost.
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Tickets' })).toContainText('6 × Rp 55.000');
  await page.getByTestId('plan-item').filter({ hasText: 'Tickets' }).getByRole('link').click();
  await buyItNow(page, { paid: '300000' });
  const row = page.getByTestId('plan-item').filter({ hasText: 'Tickets' });
  await expect(row).toContainText('6 × Rp 55.000');
  await expect(row.getByLabel('Under the estimate')).toBeVisible();
  await expect(row).toContainText('of Rp 330.000');
  await expect(page.getByTestId('plan-difference')).toHaveText('Rp 30.000 under the estimate');
});
