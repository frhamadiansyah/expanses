import { expect, type Locator, type Page, test } from '@playwright/test';
import { addEvent, addWallet, buyItNow, fillItem } from './event-plan';
import { mockRates } from './pockets';

/*
 * The plan page's ring card and the paid rows, by thumb.
 *
 * The trip is planned in lira, the workspace stays in rupiah: the flight is priced in rupiah, the museum pass in euros,
 * the dinner in lira, the guide in dollars (which has no rate). Flight paid under its estimate and the museum pass paid
 * over it give the card its saved and over status lines and the rows both of their arrows. The count sits inside the ring
 * under the percentage; the first line of the text is always a status, so the ring and the text stay one height.
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

/** The ring and the text block beside it (the status line's parent), measured. */
async function measure(page: Page) {
  const ring = (await page.getByTestId('plan-ring').boundingBox())!;
  const text = (await page.getByTestId('plan-status').locator('..').boundingBox())!;
  return { ring, text };
}

/** The ring is as tall as the text, square, and level with it. */
async function expectRingMatchesText(page: Page) {
  const { ring, text } = await measure(page);
  expect(Math.abs(ring.height - text.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(ring.width - ring.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(ring.y - text.y)).toBeLessThanOrEqual(1);
}

/** Nothing runs out of the card, and the Estimate and Actual figures each stay on one line. */
async function expectNothingWraps(page: Page) {
  const card = page.getByTestId('plan-totals');
  const fits = await card.evaluate((el) => {
    const right = el.getBoundingClientRect().right;
    const inside = [...el.querySelectorAll<HTMLElement>('[data-testid^="plan-"]')].every((part) => part.getBoundingClientRect().right <= right + 0.5);
    return { scroll: el.scrollWidth <= el.clientWidth, inside };
  });
  expect(fits).toEqual({ scroll: true, inside: true });
  for (const id of ['plan-planned', 'plan-actual', 'plan-to-go', 'plan-status']) {
    const lines = await page.getByTestId(id).evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top / 4))).size;
    });
    // The Estimate and Actual blocks are a label over a figure, so two lines; the rest are one.
    expect(lines).toBeLessThanOrEqual(id === 'plan-planned' || id === 'plan-actual' ? 2 : 1);
  }
  for (const id of ['plan-planned', 'plan-actual']) {
    const figure = (await page.getByTestId(id).locator('span').last().boundingBox())!;
    expect(figure.height).toBeLessThanOrEqual(17);
  }
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

  // The words: Estimate and Actual, never Planned or Bought; the missing rate is said on the cost, not on the card.
  await expect(page.getByTestId('plan-planned')).toContainText('Estimate');
  await expect(page.getByTestId('plan-actual')).toContainText('Actual');
  await expect(card).not.toContainText('Planned');
  await expect(card).not.toContainText('Bought');
  await expect(card).not.toContainText(/rate yet/i);
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Guide' })).toContainText('no rate yet');
  // The count is inside the ring, under the percentage; there is no foot line and no count in the text.
  await expect(page.getByTestId('plan-ring').getByTestId('plan-count')).toHaveText('0 of 4 paid');
  await expect(page.getByTestId('plan-difference')).toHaveCount(0);
  await expect(page.getByTestId('plan-status')).toHaveText('Nothing paid yet');
  await expect(page.getByTestId('plan-status')).toHaveCSS('color', await token(page, '--ph-ink-3'));
  await expect(page.getByTestId('plan-status')).toHaveCSS('font-weight', '500');
  await expect(page.getByTestId('plan-planned').locator('span').last()).toHaveCSS('font-size', '12px');
  await expect(page.getByTestId('plan-to-go')).toHaveCSS('font-size', '16px');
  expect((await page.getByTestId('plan-count').boundingBox())!.height).toBeGreaterThanOrEqual(8);

  // The base equivalent under each of the three figures, because the trip is not in rupiah.
  for (const id of ['plan-to-go-base', 'plan-planned-base', 'plan-actual-base']) await expect(page.getByTestId(id)).toContainText(/^≈ Rp/);

  // The ring is as tall as the text beside it, and starts where it starts; nothing wraps or runs out of the card.
  await expectRingMatchesText(page);
  await expectNothingWraps(page);

  // Museum pass paid over its estimate: Rp 2.000.000 is ₺ 5.000 against ₺ 4.275.
  await payCost(page, 'Museum pass', '2000000');
  await expect(page.getByTestId('plan-status')).toHaveText(/^▲ .*725.* over$/);
  await expect(page.getByTestId('plan-status')).toHaveAttribute('aria-label', /^Over the estimate by .*725/);
  await expect(page.getByTestId('plan-status')).toHaveCSS('color', await token(page, '--ph-alarm'));
  await expectRingMatchesText(page);
  await expectNothingWraps(page);
  // Flight paid under: Rp 9.000.000 is ₺ 22.500 against ₺ 24.500.
  await payCost(page, 'Flight', '9000000');
  await expect(page.getByTestId('plan-status')).toHaveText(/^▼ .*1\.275.* saved$/);
  await expect(page.getByTestId('plan-status')).toHaveAttribute('aria-label', /^Saved .*1\.275.* against the estimate$/);
  await expect(page.getByTestId('plan-status')).toHaveCSS('color', await token(page, '--ph-up'));
  await expect(page.getByTestId('plan-status')).toHaveCSS('font-weight', '600');
  await expect(page.getByTestId('plan-ring').getByTestId('plan-count')).toHaveText('2 of 4 paid');
  // The actual is plain ink, never green.
  await expect(page.getByTestId('plan-actual').locator('span').last()).toHaveCSS('color', await token(page, '--ph-ink'));
  await expectRingMatchesText(page);
  await expectNothingWraps(page);

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
  await expect(page.getByTestId('plan-status')).toHaveText('▼ Rp 30.000 saved');
  await expectRingMatchesText(page);
  // Paid exactly on the estimate: the line says so, quietly.
  await page.getByTestId('plan-item').filter({ hasText: 'Tickets' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Price each').fill('50000');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: 'Back to the plan' }).click();
  await expect(page.getByTestId('plan-status')).toHaveText('On the estimate');
  await expect(page.getByTestId('plan-status')).toHaveCSS('color', await token(page, '--ph-ink-3'));
  await expect(page.getByTestId('plan-status')).toHaveCSS('font-weight', '500');
  await expectRingMatchesText(page);
});

test('big lira figures with two decimals and their rupiah lines stay inside the card', async ({ page }) => {
  await mockRates(page, { TRY: 400 });
  await addWallet(page);
  await page.goto('/events');
  await page.getByRole('button', { name: /^(Add an event|New event)$/ }).click();
  await page.getByLabel('Name', { exact: true }).fill('Istanbul');
  await page.getByRole('button', { name: 'Currency: IDR' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: /^TRY / }).first().click();
  await page.getByRole('button', { name: 'Save event' }).click();
  await page.getByRole('link', { name: 'Plan what to pay' }).click();
  await page.getByRole('link', { name: 'Add the first cost' }).click();
  await fillItem(page, { name: 'Villa', price: '30575', category: 'Food and beverage' });
  await expect(page.getByTestId('plan-planned')).toContainText(/30\.575,00/);
  await expectRingMatchesText(page);
  await expectNothingWraps(page);
  // Paid under: Rp 11.000.000 is ₺ 27.500.
  await payCost(page, 'Villa', '11000000');
  await expect(page.getByTestId('plan-actual')).toContainText(/27\.500,00/);
  await expect(page.getByTestId('plan-status')).toHaveText(/^▼ .*3\.075,00.* saved$/);
  await expectRingMatchesText(page);
  await expectNothingWraps(page);
});
