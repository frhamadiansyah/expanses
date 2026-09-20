import { expect, type Locator, type Page, test } from '@playwright/test';

/** Today's form, from the phone's tab bar. Task 10 replaces this body with a call to `addTransaction`. */
async function record(page: Page, description: string, category: string, amount: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add a transaction' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a transaction' });
  await sheet.getByLabel('Description').fill(description);
  await sheet.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await sheet.getByLabel('Category', { exact: true }).selectOption({ label: category });
  await sheet.getByLabel('Amount', { exact: true }).fill(amount);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
}

/** Pointer down, a drag to the left, up — the gesture, not a click. */
async function swipeLeft(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 12;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from - (160 * step) / 10, y);
  await page.mouse.up();
}

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });
/** The row's own face, told apart from the category circle beside it — which also names the purchase. */
const face = (page: Page, what: string, category: string) => row(page, what).getByRole('button', { name: new RegExp(`^${category}`) });
/** Not any status: the install hint and the backup banner are statuses too. */
const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });

test('a row opens its receipt, swipes to Edit and Delete, and its icon fixes the category', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/transactions');
  await record(page, 'Warung Steak', 'Restaurants', '120000');
  await record(page, 'Superindo', 'Groceries', '250000');

  // Tap the row → the receipt. The circle beside it is a separate control, so the tap target is the face alone.
  await face(page, 'Warung Steak', 'Restaurants').click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await expect(page.getByText('Warung Steak').first()).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);

  // Swipe → Edit and Delete. Both live inside the element carrying the test id, so a row-scoped locator reaches them.
  const steak = row(page, 'Warung Steak');
  // The content layer is opaque here, and only here: it slides over the action layer, and a see-through row
  // would show Edit and Delete through the words on top of them. The desktop's row is the other way round.
  await expect(steak.locator('div').filter({ has: page.getByRole('button', { name: 'Category for Warung Steak' }) }).last()).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(steak.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await swipeLeft(page, steak);
  await expect(steak.getByRole('button', { name: 'Edit' })).toBeVisible();
  await steak.getByRole('button', { name: 'Delete' }).click();
  await expect(steak.getByRole('button', { name: 'Delete?' })).toBeVisible();
  // Asked twice, and one press writes nothing. Waited out rather than asserted at once: a delete that did
  // happen takes a moment to land, and looking straight away would pass whether or not it was on its way.
  await page.waitForTimeout(800);
  await expect(row(page, 'Warung Steak')).toHaveCount(1);
  await steak.getByRole('button', { name: 'Delete?' }).click();
  await expect(page.getByText('Warung Steak')).toHaveCount(0);
  // And the second press did write: the database says so once it is read back.
  await page.reload();
  await expect(row(page, 'Superindo')).toHaveCount(1);
  await expect(row(page, 'Warung Steak')).toHaveCount(0);

  // Tap the circle → the category list, filed at once, with the way back.
  await expect(row(page, 'Superindo')).toContainText('Groceries');
  await page.getByRole('button', { name: 'Category for Superindo' }).click();
  await page.getByRole('dialog', { name: 'Category for Superindo' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await expect(toast(page)).toContainText('Moved to Restaurants');
  await expect(row(page, 'Superindo')).toContainText('Restaurants');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Superindo')).toContainText('Groceries');
});

/**
 * The phone is not the looser shell. A desktop refuses to edit, delete or re-file an opening balance — it posts
 * against system equity and has no form that could represent it — and the phone refuses exactly the same things:
 * no swipe actions, and no category circle. Tapping it still opens the receipt, because on a phone the tap is
 * the only way to a receipt at all (the ⓘ is `hidden md:inline-flex`); looking is not writing, and the receipt
 * refuses in the same place, by the same test.
 */
test('a phone refuses what a desktop refuses, and still lets the row be read', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/transactions');
  const opening = row(page, 'Opening balance');
  await expect(opening).toHaveCount(1);
  // No circle: an opening balance has no category to fix, and offering the gesture would open a sheet whose
  // every button the ledger refuses. Dropping the `clickable` gate on the row puts one here.
  await expect(opening.getByRole('button', { name: /^Category for/ })).toHaveCount(0);

  // And no swipe layer to reveal: with no Edit and no Delete the row is not a `SwipeRow` at all, so the drag
  // is read as a tap and opens the receipt. A row that did offer them would suppress that click and show Edit.
  await swipeLeft(page, opening);
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await expect(page.getByTestId('receipt-hero')).toBeVisible();
  // Looking is not writing, and the receipt carries the same refusal: nothing here edits or deletes it either.
  await expect(page.getByRole('button', { name: 'Edit this transaction' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete this transaction' })).toHaveCount(0);
});
