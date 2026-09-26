import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { openNewAsset } from './add-asset';
import { addTransaction, attachPhoto, closeDetails, addForm, saveButton } from './add-transaction';
import { openDrawers } from './drawers';
import { todayIn } from './today';

/** Today's form, from the phone's tab bar. Task 10 replaces this body with a call to `addTransaction`. */
async function record(page: Page, description: string, category: string, amount: string) {
  await addTransaction(page, { description, paidWith: 'BCA Tahapan', category, amount });
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
  await face(page, 'Warung Steak', 'Restaurants').click();
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

/**
 * Editing on a phone is one sheet, whichever way it is reached — the receipt's Edit and the row's swipe open the
 * very same screen — and the rarer things you can do to a transaction sit behind ⋯ rather than crowding it.
 *
 * The sheet is a **new way in**, so what it opens is what already exists: `MoreDetails` is the card's own
 * component with the card's own props (Event and Photos are there, With is not, because §15.6 does not offer a
 * shared bill on a correction), and Escape closes the innermost thing only, through the one listener `useEscape`
 * keeps. A second copy of either is how this branch has broken itself six times.
 */
test('Edit — from the receipt or from the swipe — is one sheet, and ⋯ holds the rest', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

  // Something to convert into, so ⋯ can offer "This was a purchase" at all: the sheet carries the receipt's own
  // gate, and a conversion with nothing to convert into is a form whose Save can never be pressed.
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await page.getByLabel('Bought on').fill('2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (IDR)').fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  // The row is inside its kind's drawer, which the list opens shut.
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();

  await page.goto('/transactions');
  await record(page, 'Warung Steak', 'Restaurants', '120000');

  // In from the receipt.
  await face(page, 'Warung Steak', 'Restaurants').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit', exact: true });
  await sheet.getByLabel('Note').fill('Warung Steak Tebet');

  // More opens the card's own extras screen, not a second set of them: Event and Photos are on it, and With is
  // not, because a correction posts through `replaceTransaction` and cannot become a shared bill.
  await sheet.getByRole('button', { name: 'More', exact: true }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  await expect(more.getByRole('button', { name: 'Event' })).toBeVisible();
  await expect(more.getByRole('button', { name: 'Photos' })).toBeVisible();
  await expect(more.getByRole('button', { name: 'With', exact: true })).toHaveCount(0);
  // Escape answers the innermost thing open and nothing else: the extras go, the half-typed edit stays.
  await page.keyboard.press('Escape');
  await expect(more).toHaveCount(0);
  await expect(sheet).toHaveCount(1);
  await expect(sheet.getByLabel('Note')).toHaveValue('Warung Steak Tebet');

  await sheet.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  // An edit voids the original, so the receipt it belonged to is gone and the list is where the save lands.
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  const fixed = row(page, 'Warung Steak Tebet');
  await expect(fixed).toHaveCount(1);
  await expect(fixed).toContainText('Groceries');
  // And it is in the database, not only on the screen.
  await page.reload();
  await expect(row(page, 'Warung Steak Tebet')).toContainText('Groceries');

  // In from the swipe: the same sheet, and the rarer actions behind ⋯.
  const swiped = row(page, 'Warung Steak Tebet');
  // Dragged where it can be dragged. The tab bar is fixed across the foot of the screen, so a row that is
  // technically "in the viewport" can still be under it, and the press lands on the tab bar instead —
  // `scrollIntoViewIfNeeded` is happy with such a row and does nothing.
  await swiped.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await swipeLeft(page, swiped);
  await swiped.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(sheet).toHaveCount(1);
  await sheet.getByRole('button', { name: 'More actions' }).click();
  const actions = page.getByRole('dialog', { name: 'More actions' });
  for (const name of ['Open in full form', 'This was a purchase', 'Delete this transaction']) {
    await expect(actions.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await actions.getByRole('button', { name: 'Open in full form' }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+\/edit$/);
  // The full card, on this transaction: the note it is already carrying proves which one was opened.
  await expect(page.getByLabel('Note')).toHaveValue('Warung Steak Tebet');
});

/**
 * The combination the sheet cannot hold: a purchase in another currency, corrected from the swipe.
 *
 * `canEditInSheet` refuses three shapes — a split, a transfer and a foreign purchase — because the sheet has
 * one category, one account and one figure, and a foreign purchase carries a second figure it has no row for.
 * A sheet that opened anyway would show the charged figure alone and, on Save, post it as the typed one: the
 * merchant's currency quietly dropped, which is `formToPost`'s original pair thrown away by a screen rather
 * than by the kit. The fallback is the in-place editor the row has always had, so no transaction loses its
 * way in — which is the whole promise a new entry point has to keep.
 */
test('a foreign purchase falls back to the in-place editor, because the sheet cannot hold it', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openCard(page, { name: 'BCA Visa', owed: '0' });

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Visa', exact: true }).click();
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

  // It really is a foreign purchase, or the fallback below is about an ordinary row.
  const blue = row(page, 'Blue Bottle');
  await expect(blue).toContainText('US$100,00');

  await blue.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await swipeLeft(page, blue);
  await blue.getByRole('button', { name: 'Edit', exact: true }).click();

  // Not the sheet — and not the row editor either: `isQuickEditable` refuses a foreign row for the same reason
  // the sheet does. What opens is the full card, the one screen with a row for each of the two figures.
  await expect(page.getByRole('dialog', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Row description')).toHaveCount(0);
  // It opens in the row's own place rather than over it, and says what an edit will leave behind — kept, and not
  // where to look for it: a phone has no door to the deleted rows.
  await expect(page.getByText('The original is kept')).toBeVisible();
  // Both figures are on it, each in its own currency: the pair survived the trip through `formFromTransaction`,
  // which is the half a sheet showing one figure would have thrown away on its next Save.
  await expect(page.getByLabel('Note')).toHaveValue('Blue Bottle');
  // US$100,00 at USD's own exponent, never "100": a pair reopened at the wrong exponent is a 100x error. The
  // row shows a settled figure grouped the way the app writes money, so the exponent is read off the face.
  await expect(page.getByRole('button', { name: 'Amount', exact: true })).toHaveText('100,00');
  await expect(page.getByRole('button', { name: 'Charged in IDR' })).toHaveText('1.600.000');
});

/**
 * The phone's edit sheet drew the manual-rate row and threw the rate away — an unescapable dead end.
 *
 * `EditSheet.save()` was a line-for-line copy of `TransactionCard.submit()` with the rate block left out, and
 * `draft.manualRate` had exactly one reader in the whole app. So: Save → "Add it under “More”" → open More,
 * type the rate → Save → **the same error, for ever**. The only way out was ⋯ → Open in full form.
 *
 * Both ways in now go through one `ratesForSave`, so what the sheet asks for is what the sheet stores.
 */
test('the rate typed into the edit sheet is the rate the edit sheet saves', async ({ page }) => {
  // No rate server: what this device has stored is all there is, which is what puts the row on screen at all.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
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
  const sheet = page.getByRole('dialog', { name: 'Edit', exact: true });
  await sheet.getByLabel('Date').fill(earlier);
  await sheet.getByRole('button', { name: 'Save' }).click();
  // The refusal, and it says where to go — this screen's row is called More, the card's Add more details.
  await expect(sheet.getByText(`No CNY→IDR rate for ${earlier}. Add it under “More”.`)).toBeVisible();

  // Go where it says, type the rate, and save again.
  await sheet.getByRole('button', { name: 'More', exact: true }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  await more.getByLabel('Rate: IDR per 1 CNY').fill('2300');
  await more.getByRole('button', { name: 'Close' }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();

  // It saved. It used to answer with the very same sentence, however many times the rate was typed.
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText(`No CNY→IDR rate for ${earlier}`)).toHaveCount(0);
  const corrected = row(page, 'Luckin');
  await expect(corrected).toHaveCount(1);
  await expect(corrected).toContainText('CN¥120,00');
  // And it is in the database, under the new date, not only on the screen.
  await page.reload();
  await expect(row(page, 'Luckin')).toHaveCount(1);
});

/**
 * The phone's edit sheet said a transaction with a receipt had no photos.
 *
 * `formFromTransaction`'s fourth argument is the pictures the transaction already has; the sheet left it off,
 * so `photoIds` defaulted to `[]` and the Photos row read **None** on every correction made from a phone.
 * `movePhotosTx` re-keys the rows regardless, so the picture survived — but a row that states the opposite of
 * the truth is what data loss looks like from the outside, and there was no way to see or remove it from here.
 */
test('the edit sheet shows the receipt the transaction already has', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const key of '120000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
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
  const edit = page.getByRole('dialog', { name: 'Edit', exact: true });
  await edit.getByRole('button', { name: 'More', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'More details' });

  // "1 photo", not "None" — and the picture itself is behind the row, to be looked at or taken off.
  await expect(details.getByRole('button', { name: 'Photos' })).toContainText('1 photo');
  await details.getByRole('button', { name: 'Photos' }).click();
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
  await target.evaluate((el) => el.scrollIntoView({ block: 'end' }));

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
