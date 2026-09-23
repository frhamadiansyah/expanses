import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';

/** Anything a finger is meant to hit must be at least this tall or wide. */
const TAP = 44;

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
}

async function addBill(page: Page, name: string, amount: string) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Bill is out on').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}

const row = (page: Page, name: string) => page.getByTestId('bill-row').filter({ hasText: name });

/** A horizontal drag across the row, in small steps, the way a thumb moves. */
async function swipe(page: Page, target: Locator, dx: number) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x + (dx * step) / 10, y);
  await page.mouse.up();
}

test('swiping a bill right opens its payment, and recording it settles the month', async ({ page }) => {
  await addWallet(page);
  await addBill(page, 'Phone', '150000');
  // No Pay button on a row: paying is a swipe away.
  await expect(row(page, 'Phone').getByRole('button', { name: /^Pay/ })).toHaveCount(0);

  await swipe(page, row(page, 'Phone'), 140);
  const sheet = page.getByRole('dialog', { name: 'Pay Phone' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'See bill ›' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  // Not any status: the install hint and the backup banner are statuses too (see recurring-bills.spec.ts's `toast`).
  await expect(page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) })).toContainText('Paid Phone');
  await expect(row(page, 'Phone')).toContainText('✓ Paid');
});

test('swiping a bill left reveals Skip', async ({ page }) => {
  await addWallet(page);
  await addBill(page, 'Gym', '350000');
  await swipe(page, row(page, 'Gym'), -120);
  const skip = page.getByRole('button', { name: 'Skip Gym' });
  await expect(skip).toBeVisible();
  expect((await skip.boundingBox())!.height).toBeGreaterThanOrEqual(TAP);
  await skip.click();
  await expect(row(page, 'Gym')).toContainText('Skipped');
  // A settled row does not swipe open again.
  await swipe(page, row(page, 'Gym'), -120);
  await expect(page.getByRole('button', { name: 'Skip Gym' })).toHaveCount(0);
});

test('a tap opens the bill, not a swipe', async ({ page }) => {
  await addWallet(page);
  await addBill(page, 'Phone', '150000');
  await row(page, 'Phone').click();
  await expect(page.getByRole('heading', { name: 'Phone' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('select mode puts a pay bar above the tab bar, and swipes rest while it is on', async ({ page }) => {
  await addWallet(page);
  await addBill(page, 'Phone', '150000');
  await addBill(page, 'Internet', '395000');
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await swipe(page, row(page, 'Phone'), 140);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('checkbox', { name: 'Select Internet' }).click();
  const bar = page.getByRole('button', { name: /^Pay \d selected/ });
  await expect(bar).toBeVisible();
  const tabs = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(tabs.y);
  expect(barBox.height).toBeGreaterThanOrEqual(TAP);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(bar).toHaveCount(0);
});
