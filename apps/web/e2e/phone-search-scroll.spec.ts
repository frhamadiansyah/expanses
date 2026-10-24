import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/** Drags a thumb up the middle of the screen by `by` px, as touch events, so what blocks a touch scroll blocks this. */
async function thumbScroll(page: Page, by: number) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 10;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 700 }] });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 700 - (by * i) / steps }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/*
 * Searching on a phone puts the field in the title row and, once the page moves, holds it at the top on glass. The
 * page under it still scrolls: a list searched from far down is searched there, and what was typed stays in the
 * field as it moves. The field used to pull the page back to the top whenever it changed places.
 */
test('the list still scrolls while the search is open, and what was typed stays', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  // Enough rows under the chart for the page to be taller than the screen.
  for (const [description, amount] of [['Superindo', '500000'], ['Kopi Kenangan', '38000'], ['Grab ride', '24000'], ['Alfamart', '61000'], ['Warung Padang', '45000'], ['Pertamina', '150000']] as const) {
    await addTransaction(page, { description, paidWith: 'BCA Tahapan', category: 'Groceries', amount });
  }
  await expect(page.getByTestId('transaction-row')).toHaveCount(6);
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 200);
  expect(tall).toBe(true);

  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const field = page.getByLabel('Search transactions');
  await expect(field).toBeVisible();
  await field.fill('kopi');
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);
  await field.fill('');
  await expect(page.getByTestId('transaction-row')).toHaveCount(6);

  // A scroll by finger — touch events, as a thumb sends them, not a wheel — moves the page, and the page stays moved;
  // the field is still there, still holding its text.
  await thumbScroll(page, 500);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await expect(page.getByLabel('Search transactions')).toBeVisible();
  // Opened at the top, the field rides along at the top of the screen as the page scrolls under it.
  await expect(page.getByLabel('Search transactions')).toBeInViewport();
  expect((await page.getByLabel('Search transactions').boundingBox())!.y).toBeLessThan(80);
  await page.getByLabel('Search transactions').fill('grab');
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);
  await page.mouse.wheel(0, -1000);
  await page.waitForTimeout(400);
  await expect(page.getByLabel('Search transactions')).toHaveValue('grab');
});
