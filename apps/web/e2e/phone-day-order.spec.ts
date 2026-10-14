import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/*
 * Rows put in order by hand within their day, on a phone: press and hold a row, drag it, and it stays where it was
 * dropped — after a reload too — while a transaction recorded afterwards still lands on top of its day.
 */

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

/** The order the named rows are drawn in, top to bottom. */
async function order(page: Page): Promise<string[]> {
  const texts = await page.getByTestId('transaction-row').allInnerTexts();
  return texts.flatMap((text) => NAMES.filter((name) => text.includes(name)));
}

/** Where the row sits once the page has stopped moving: banners and the chart above it land after the rows do. */
async function settledBox(page: Page, target: Locator) {
  let box = (await target.boundingBox())!;
  await expect(async () => {
    await page.waitForTimeout(150);
    const again = (await target.boundingBox())!;
    const still = again.x === box.x && again.y === box.y && again.height === box.height;
    box = again;
    expect(still).toBe(true);
  }).toPass({ timeout: 5_000 });
  return box;
}

/** Pointer down on `from`, held (or not), dragged up to above `to`, released. */
async function drag(page: Page, from: Locator, to: Locator, hold: boolean) {
  // The day sits under the chart, below the fold: the pointer can only press what is on screen.
  await from.scrollIntoViewIfNeeded();
  const start = await settledBox(page, from);
  const end = await settledBox(page, to);
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  const targetY = end.y + 4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (hold) await page.waitForTimeout(650);
  for (let step = 1; step <= 12; step += 1) await page.mouse.move(x, y + ((targetY - y) * step) / 12);
  await page.mouse.up();
}

test('a held row is dragged to the top of its day, stays there after a reload, and a new one still lands on top', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  for (const [i, name] of ['Alpha', 'Bravo', 'Charlie'].entries()) {
    await addTransaction(page, { description: name, paidWith: 'BCA Tahapan', category: 'Groceries', amount: String(10000 * (i + 1)) });
  }
  await expect.poll(() => order(page)).toEqual(['Charlie', 'Bravo', 'Alpha']);

  // A quick move without the hold is not a drag: nothing moves, and nothing opens.
  await drag(page, row(page, 'Alpha'), row(page, 'Charlie'), false);
  await page.waitForTimeout(400);
  expect(await order(page)).toEqual(['Charlie', 'Bravo', 'Alpha']);

  // Held, then dragged: the bottom one goes to the top, and the release does not open its receipt.
  await drag(page, row(page, 'Alpha'), row(page, 'Charlie'), true);
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\/transactions(\?|$)/);

  await page.reload();
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);

  await addTransaction(page, { description: 'Delta', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '40000' });
  await expect.poll(() => order(page)).toEqual(['Delta', 'Alpha', 'Charlie', 'Bravo']);

  // The tap still opens the receipt.
  await row(page, 'Bravo').getByRole('button', { name: /^Groceries/ }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
});
