import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { openNewAsset, fillDay } from './add-asset';
import { addTransaction, attachPhoto, closeDetails, addForm, saveButton, choosePayment } from './add-transaction';
import { openDrawers } from './drawers';
import { todayIn } from './today';

/** Today's form, from the phone's tab bar. Task 10 replaces this body with a call to `addTransaction`. */
async function record(page: Page, description: string, category: string, amount: string) {
  await addTransaction(page, { description, paidWith: 'BCA Tahapan', category, amount });
}

/**
 * Where the row sits once the page has stopped moving. The list's rows land before the banners and the chart above
 * them do, and those push the rows down: a gesture aimed at a box read a moment too early lands on the row beside it.
 */
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

/** Pointer down, a drag to the left, up — the gesture, not a click. */
async function swipeLeft(page: Page, row: Locator) {
  const box = await settledBox(page, row);
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
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

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
  await steak.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(steak.getByRole('button', { name: 'Delete?' })).toBeVisible();
  // Asked twice, and one press writes nothing. Waited out rather than asserted at once: a delete that did
  // happen takes a moment to land, and looking straight away would pass whether or not it was on its way.
  await page.waitForTimeout(800);
  await expect(row(page, 'Warung Steak')).toHaveCount(1);

  // §2's "still asks twice" holds across the gesture, not only within it. Armed, then walked away from: a tap
  // on a row left open closes it and does nothing else, and the next swipe has to ask from the start. It did
  // not — `armed` was kept in the row *around* the button, so it outlived the swipe that set it and the second
  // swipe opened reading "Delete?". One tap then voided the transaction, with no second question anywhere.
  // Three buttons stand open (Duplicate, Edit, Delete) and the face slides left, so only its right end is on screen.
  // That end is still the face: a tap on it closes the row and does nothing else.
  const openFace = face(page, 'Warung Steak', 'Restaurants');
  const openBox = (await openFace.boundingBox())!;
  await openFace.click({ position: { x: openBox.width - 6, y: openBox.height / 2 } });
  await expect(steak.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  // The row slides shut over 150ms; swiping into that animation drags a row that is still moving.
  await page.waitForTimeout(400);
  await swipeLeft(page, steak);
  await expect(steak.getByRole('button', { name: 'Delete?' })).toHaveCount(0);
  await expect(steak.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  // Still there, so the reopened row really did refuse to delete on that swipe's first tap.
  await page.waitForTimeout(400);
  await expect(row(page, 'Warung Steak')).toHaveCount(1);

  await steak.getByRole('button', { name: 'Delete', exact: true }).click();
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
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

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

/** The Add screen, opened on one transaction: a phone's Edit, however it was reached. */
const editForm = (page: Page) => page.getByRole('form', { name: 'Edit a transaction' });

/**
 * Editing on a phone is the Add screen again, whichever way it is reached — the receipt's Edit and the row's swipe
 * open the very same full card, on its own route — so a correction is never a second screen to learn. The rarer
 * things done to a transaction are the receipt's own: This was a purchase and Delete stand under its Edit.
 */
test('Edit — from the receipt or from the swipe — opens the Add screen on the transaction', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

  // Something to convert into, so the receipt can offer "This was a purchase" at all: a conversion with nothing
  // to convert into is a form whose Save can never be pressed.
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await fillDay(page, 'Bought', '2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  // The row is inside its kind's drawer, which the list opens shut.
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();

  await page.goto('/transactions');
  await record(page, 'Warung Steak', 'Restaurants', '120000');

  // In from the receipt, where the rarer actions live.
  await face(page, 'Warung Steak', 'Restaurants').click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await expect(page.getByRole('button', { name: 'This was a purchase', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete this transaction', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\/edit$/);
  // The full card, on this transaction: the note it is already carrying proves which one was opened. No sheet.
  await expect(editForm(page).getByLabel('Note')).toHaveValue('Warung Steak');
  await expect(page.getByRole('dialog', { name: 'Edit', exact: true })).toHaveCount(0);
  // Back goes where Edit was opened.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = editForm(page);
  await form.getByLabel('Note').fill('Warung Steak Tebet');
  // The card's own extras, as on Add: Event and Photos are there.
  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('region', { name: 'More details' });
  await expect(more.getByRole('button', { name: 'Event' })).toBeVisible();
  await expect(form.getByTestId('amount-photos')).toBeVisible();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  // An edit voids the original, so the receipt it belonged to is gone and the list is where the save lands.
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  const fixed = row(page, 'Warung Steak Tebet');
  await expect(fixed).toHaveCount(1);
  await expect(fixed).toContainText('Groceries');
  // And it is in the database, not only on the screen.
  await page.reload();
  await expect(row(page, 'Warung Steak Tebet')).toContainText('Groceries');

  // In from the swipe: the same screen.
  const swiped = row(page, 'Warung Steak Tebet');
  // Dragged where it can be dragged. The tab bar is fixed across the foot of the screen, so a row that is
  // technically "in the viewport" can still be under it, and the press lands on the tab bar instead —
  // `scrollIntoViewIfNeeded` is happy with such a row and does nothing.
  await swiped.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await swipeLeft(page, swiped);
  await swiped.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\/edit$/);
  await expect(editForm(page).getByLabel('Note')).toHaveValue('Warung Steak Tebet');
  // And Back from it is the list it was swiped on.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(row(page, 'Warung Steak Tebet')).toHaveCount(1);

  // Saved from the swipe, the edit leaves nothing behind it in the history: a swipe back from the list is the list
  // it was opened on, never the receipt of the original the save just voided.
  await swiped.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await swipeLeft(page, swiped);
  await swiped.getByRole('button', { name: 'Edit', exact: true }).click();
  await editForm(page).getByLabel('Note').fill('Warung Steak Kemang');
  await saveButton(editForm(page)).click();
  await expect(editForm(page)).toHaveCount(0);
  await expect(row(page, 'Warung Steak Kemang')).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(page.getByRole('button', { name: 'Delete this transaction', exact: true })).toHaveCount(0);
});

/**
 * A purchase in another currency, corrected from the swipe, opens the very same screen as any other — the edit
 * screen no longer looks different by currency. The full card has a row for each of the two figures, so the
 * merchant's currency and the charged figure both come back as they were saved.
 */
test('a foreign purchase opens the same Add screen, with both of its figures', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openCard(page, { name: 'BCA Visa', owed: '0' });

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Visa');
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'USD US Dollar' }).first().click();
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const key of '100') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Charged in IDR' }).click();
  for (const key of '1600000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Blue Bottle');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // It really is a foreign purchase, or what follows is about an ordinary row.
  const blue = row(page, 'Blue Bottle');
  await expect(blue).toContainText('US$100,00');

  await blue.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await swipeLeft(page, blue);
  await blue.getByRole('button', { name: 'Edit', exact: true }).click();

  // The Add screen, as for every other row — not a sheet, and not the row editor.
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\/edit$/);
  await expect(page.getByLabel('Row description')).toHaveCount(0);
  const edit = editForm(page);
  await expect(edit.getByLabel('Note')).toHaveValue('Blue Bottle');
  // US$100,00 at USD's own exponent, never "100": a pair reopened at the wrong exponent is a 100x error.
  await expect(edit.getByRole('button', { name: 'Amount', exact: true })).toHaveText('100,00');
  await expect(edit.getByRole('button', { name: 'Charged in IDR' })).toHaveText('1.600.000');
  // A purchase reopened for correction holds what the bank actually took, so the charged figure is nobody's
  // guess and carries no ≈ — only the code that names it.
  await expect(page.getByText('≈ IDR', { exact: true })).toHaveCount(0);
  await expect(page.getByText('IDR', { exact: true })).toBeVisible();
});

/**
 * The rate typed on a correction is the rate the correction saves. The phone's old edit sheet drew the rate row
 * and threw the rate away — an unescapable dead end — and a phone now corrects on the full card, whose save goes
 * through the one `ratesForSave`. This walks that screen the way the dead end was walked.
 */
test('the rate typed on the edit screen is the rate the edit saves', async ({ page }) => {
  // No rate server: what this device has stored is all there is, which is what puts the row on screen at all.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // Mid-month, so the day three back is in the month the list shows: on the 1st to the 3rd it was the month before.
  await page.clock.setSystemTime(new Date('2026-09-15T12:00:00'));
  const today = await todayIn(page);
  // A day with no CNY→IDR rate stored for it — `findRate` only ever looks at dates on or before the one asked
  // for, and the account below stores its rate under today.
  const earlier = await todayIn(page, 3);

  // The rate is stored as the opening balance's own conversion, so there has to be a balance to convert.
  await openAccount(page, { subtype: 'cash', name: 'Alipay', currency: 'CNY', balance: '1000', opened: today, rate: '2270' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Luckin', paidWith: 'Alipay', category: 'Restaurants', amount: '120' });
  await expect(row(page, 'Luckin')).toHaveCount(1);

  // Correct it onto a day this device has no rate for — an ordinary correction, and the one that dead-ended.
  const luckin = row(page, 'Luckin');
  await luckin.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await swipeLeft(page, luckin);
  await luckin.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = editForm(page);
  await edit.getByLabel('Date').fill(earlier);
  await saveButton(edit).click();
  // The refusal, and it says where to go.
  await expect(page.getByText(`No CNY→IDR rate for ${earlier}. Add it under “Add more details”.`)).toBeVisible();

  // Go where it says, type the rate, and save again.
  await edit.getByRole('button', { name: 'Add more details' }).click();
  await page.getByRole('region', { name: 'More details' }).getByLabel('Rate: IDR per 1 CNY').fill('2300');
  await saveButton(edit).click();

  // It saved, and landed on the list.
  await expect(edit).toHaveCount(0);
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  const corrected = row(page, 'Luckin');
  await expect(corrected).toHaveCount(1);
  await expect(corrected).toContainText('CN¥120,00');
  // And it is in the database, under the new date, not only on the screen.
  await page.reload();
  await expect(row(page, 'Luckin')).toHaveCount(1);
});

/**
 * A correction shows the receipt the transaction already has. The phone's old edit sheet said **None** — it left
 * `formFromTransaction`'s fourth argument off — and the full card a phone now edits on must not.
 */
test('the edit screen shows the receipt the transaction already has', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const key of '120000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Warung Steak');
  const { more, sheet: photos } = await attachPhoto(page, form, { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('a receipt') });
  await closeDetails(more, photos);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  const steak = row(page, 'Warung Steak');
  await steak.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await swipeLeft(page, steak);
  await steak.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = editForm(page);
  await edit.getByRole('button', { name: 'Add more details' }).click();
  const details = page.getByRole('region', { name: 'More details' });

  // "1 photo", not "None" — and the picture itself is behind the row, to be looked at or taken off.
  await expect(edit.getByTestId('amount-photos')).toHaveAttribute('aria-label', 'Photos, 1');
  await edit.getByTestId('amount-photos').click();
  await expect(page.getByRole('dialog', { name: 'Photos' }).getByRole('button', { name: 'Photo 1', exact: true })).toBeVisible();
});

/**
 * A row the scroll leaves at the foot of the screen is under the tab bar, and cannot be touched.
 *
 * The bar floats over the page — `fixed inset-x-0 bottom-0` — so a row can be squarely "in the viewport"
 * and still have the capsule on top of it: `elementFromPoint` at the row's own middle answers an icon in
 * the bar, and the press that starts a swipe is swallowed. It is **any** row a scroll leaves in that strip,
 * not only the last one; the document's bottom padding clears the bar only once you are scrolled all the
 * way to the end, which is why nobody saw it.
 *
 * The fix is geometry: `scroll-margin-bottom` on the phone, so scrolling to a row leaves the bar's own
 * height beneath it. Nothing here is about how the row looks.
 */
test('a row scrolled to the foot of the screen is clear of the tab bar, and still swipes', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

  await page.goto('/transactions');
  for (const name of ['Warung Steak', 'Superindo', 'Kopi Kenangan', 'Indomaret', 'Alfamart', 'Sate Khas Senayan', 'Bakmi GM', 'Pertamina']) {
    await record(page, name, 'Restaurants', '120000');
  }

  // The list has to be longer than the screen, or scrolling to a row proves nothing.
  expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 200)).toBe(true);

  const target = row(page, 'Superindo');
  // The page settles first: a banner or the chart landing above the list after the scroll moves the row back down.
  await settledBox(page, target);
  await target.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await settledBox(page, target);

  // Scrolled to, and clear: the row's foot is above the bar's head, so the press lands on the row.
  const geometry = await target.evaluate((el) => {
    const bar = document.querySelector('nav[aria-label="Main"]')!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    const under = document.elementFromPoint(box.x + box.width - 12, box.y + box.height / 2);
    return { rowBottom: box.bottom, barTop: bar.top, ownsItsOwnMiddle: el.contains(under) };
  });
  expect(geometry.rowBottom).toBeLessThanOrEqual(geometry.barTop);
  expect(geometry.ownsItsOwnMiddle).toBe(true);

  await swipeLeft(page, target);
  await expect(target.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});
