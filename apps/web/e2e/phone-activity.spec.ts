import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

async function record(page: Page, description: string, category: string, amount: string) {
  await addTransaction(page, { description, paidWith: 'BCA Tahapan', category, amount });
}

async function settledBox(page: Page, row: Locator) {
  let box = (await row.boundingBox())!;
  await expect(async () => {
    await page.waitForTimeout(150);
    const again = (await row.boundingBox())!;
    const still = again.x === box.x && again.y === box.y && again.height === box.height;
    box = again;
    expect(still).toBe(true);
  }).toPass({ timeout: 5_000 });
  return box;
}

async function swipeLeft(page: Page, row: Locator) {
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = await settledBox(page, row);
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 12;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from - (160 * step) / 10, y);
  await page.mouse.up();
}

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });
const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });
const line = (page: Page, what: string) => page.getByTestId('activity-line').filter({ hasText: what });

/** Settings → Activity, the way a person gets there: the Account page, then the row. */
async function openActivity(page: Page) {
  await page.goto('/account');
  const entry = page.getByRole('link', { name: /^Activity/ });
  await expect(entry).not.toContainText('What was changed');
  await entry.click();
  await expect(page).toHaveURL(/\/settings\/activity$/);
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
}

test('an edit is listed with what changed, and Undo puts the transaction back as it was', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await record(page, 'Superindo', 'Groceries', '250000');
  await expect(row(page, 'Superindo')).toContainText('Groceries');

  await page.getByRole('button', { name: 'Category for Superindo' }).click();
  await page.getByRole('dialog', { name: 'Category for Superindo' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await expect(row(page, 'Superindo')).toContainText('Restaurants');

  await openActivity(page);
  const edited = line(page, 'Superindo edited');
  await expect(edited).toContainText('Category Groceries → Restaurants');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  // Nothing is recorded for accounts yet, so the segment is not offered.
  await expect(page.getByRole('radio', { name: 'Accounts' })).toHaveCount(0);

  // The line opens: when, what changed, and the two ways on.
  await edited.getByRole('link').click();
  await expect(page.getByTestId('activity-when')).toContainText('Today');
  await expect(page.getByTestId('activity-change')).toContainText('Groceries → Restaurants');
  await expect(page.getByTestId('activity-undo-this')).toBeVisible();
  await expect(page.getByTestId('activity-open')).toBeVisible();
  await page.getByTestId('activity-undo-this').click();
  await expect(page.getByTestId('activity-state')).toContainText('Undone');

  await page.goto('/transactions');
  await expect(row(page, 'Superindo')).toHaveCount(1);
  await expect(row(page, 'Superindo')).toContainText('Groceries');
  await expect(row(page, 'Superindo')).toContainText('250.000');

  // The undo is a line of its own, and the edit it undid says so.
  await openActivity(page);
  await expect(line(page, 'Undone: Superindo edit')).toBeVisible();
  await expect(line(page, 'Superindo edited')).toContainText('Undone');
  await expect(line(page, 'Superindo edited').getByTestId('activity-undo')).toHaveCount(0);
});

test('a delete is listed and Undo posts the purchase again; a rename says it cannot be undone', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await record(page, 'Warung Steak', 'Restaurants', '120000');

  const steak = row(page, 'Warung Steak');
  await swipeLeft(page, steak);
  await steak.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(toast(page)).toContainText('Deleted Warung Steak');
  // The delete is written once the toast has gone by itself.
  await expect(toast(page)).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await expect(row(page, 'Warung Steak')).toHaveCount(0);

  // A category renamed on its own page: recorded, with no earlier name kept.
  await page.goto('/categories');
  await page.getByTestId('category-tree').getByRole('link', { name: 'Restaurants', exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept('Warung makan'));
  await page.getByRole('button', { name: 'Rename Restaurants' }).click();
  await expect(page.getByTestId('category-hero')).toContainText('Warung makan');

  await openActivity(page);
  const deleted = line(page, 'Warung Steak deleted');
  await expect(deleted).toContainText('BCA Tahapan');
  // Accounts has something to show now.
  await page.getByRole('radio', { name: 'Accounts' }).click();
  await expect(line(page, 'Account renamed')).toContainText('Cannot undo');
  await expect(line(page, 'Account renamed').getByTestId('activity-undo')).toHaveCount(0);
  await expect(deleted).toHaveCount(0);
  await page.getByRole('radio', { name: 'Transactions' }).click();
  await expect(line(page, 'Account renamed')).toHaveCount(0);

  await deleted.getByTestId('activity-undo').click();
  await expect(line(page, 'Undone: Warung Steak delete')).toBeVisible();
  await page.goto('/transactions');
  await expect(row(page, 'Warung Steak')).toHaveCount(1);
  await expect(row(page, 'Warung Steak')).toContainText('120.000');
});
