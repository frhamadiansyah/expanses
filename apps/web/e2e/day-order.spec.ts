import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

/* Rows put in order by hand within their day, on a wide screen: Move up and Move down, and the ≡ handle. */

const NAMES = ['Alpha', 'Bravo', 'Charlie'];
const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

async function order(page: Page): Promise<string[]> {
  const texts = await page.getByTestId('transaction-row').allInnerTexts();
  return texts.flatMap((text) => NAMES.filter((name) => text.includes(name)));
}

test('a row moves up and down its day without dragging, or by its handle, and keeps its place', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  for (const [i, name] of NAMES.entries()) {
    await addTransaction(page, { description: name, paidWith: 'BCA Tahapan', category: 'Groceries', amount: String(10000 * (i + 1)) });
  }
  await expect.poll(() => order(page)).toEqual(['Charlie', 'Bravo', 'Alpha']);

  // Move up twice: Alpha to the top. The buttons are the row's, never a click that opens its editor.
  await row(page, 'Alpha').hover();
  await page.getByRole('button', { name: 'Move Alpha up' }).click();
  await expect.poll(() => order(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  await page.getByRole('button', { name: 'Move Alpha up' }).click();
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  await expect(page.getByLabel('Row amount (IDR)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Move Charlie down' }).click();
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);

  await page.reload();
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);

  // The handle drags: Charlie, at the bottom, to the top.
  await row(page, 'Charlie').hover();
  const handle = (await page.getByRole('button', { name: 'Reorder Charlie' }).boundingBox())!;
  const top = (await row(page, 'Alpha').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(handle.x + handle.width / 2, handle.y + ((top.y + 4 - handle.y) * step) / 10);
  await page.mouse.up();
  await expect.poll(() => order(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  await expect(page.getByLabel('Row amount (IDR)')).toHaveCount(0);

  // And from the keyboard, on the handle: ↓ moves it back down one.
  await page.getByRole('button', { name: 'Reorder Charlie' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);

  await page.reload();
  await expect.poll(() => order(page)).toEqual(['Alpha', 'Charlie', 'Bravo']);
});
