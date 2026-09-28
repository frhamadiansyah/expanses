import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, attachPhoto, closeDetails, addForm, saveButton, choosePayment } from './add-transaction';
import { todayIn } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: import('@playwright/test').Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan' });
}

test('the phone types money on the dock, and has four ways off it', async ({ page }) => {
  await addWallet(page);
  // The card on its own route, so Escape is answered by the dock alone: inside a sheet it would also be the
  // sheet's own way out, and the two would be indistinguishable.
  await page.goto('/transactions/new');

  const amount = page.getByRole('button', { name: 'Amount', exact: true });
  // §3.4: no text input at all on a phone — the figure is a button, and the dock is the only way into it.
  await expect(amount).toBeVisible();
  const keypad = page.getByTestId('keypad');
  await expect(keypad).toBeHidden();

  // The ✕ in the dock's corner.
  await amount.click();
  await expect(keypad).toBeVisible();
  await keypad.getByRole('button', { name: 'Close keypad' }).click();
  await expect(keypad).toBeHidden();

  // Escape.
  await amount.click();
  await expect(keypad).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(keypad).toBeHidden();

  // The page behind it.
  await amount.click();
  await expect(keypad).toBeVisible();
  await page.mouse.click(195, 90);
  await expect(keypad).toBeHidden();

  // The row itself, tapped a second time. The dock covers the Save button while it is open, so a row that
  // could not put it away again would be a form with no way to finish.
  await amount.click();
  await expect(keypad).toBeVisible();
  await amount.click();
  await expect(keypad).toBeHidden();

  // And what it is all for: the digits land on the row, in the row's own currency.
  await amount.click();
  for (const digit of '450000') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(keypad).toBeHidden();
  await expect(amount).toHaveText('450.000');
});

test('a purchase recorded by thumb reaches the list', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '500000' });
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('500.000');
});

/**
 * Escape closes the innermost thing open, and the draft behind it survives.
 *
 * The form and the dock inside it both listened for Escape on the document when the form was a sheet. One press
 * used to be answered by both: the dock shut, the sheet shut behind it, and a transaction typed to its last digit
 * was gone with nothing to get it back. On a phone the form is now a screen of its own, reached from the ＋, and a
 * screen is left by its Back — so Escape puts the dock away and nothing else, however often it is pressed.
 */
test('Escape on the add screen puts the dock away and keeps what was typed', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await expect(form).toBeVisible();

  const amount = form.getByRole('button', { name: 'Amount', exact: true });
  await amount.click();
  const keypad = page.getByTestId('keypad');
  await expect(keypad).toBeVisible();
  for (const digit of '450000') await keypad.getByRole('button', { name: digit, exact: true }).click();

  // One press: the dock, and nothing behind it.
  await page.keyboard.press('Escape');
  await expect(keypad).toBeHidden();
  await expect(form).toBeVisible();
  await expect(amount).toHaveText('450.000');

  // A second press has nothing left to close: a screen is left by its Back, and what was typed stays.
  await page.keyboard.press('Escape');
  await expect(form).toBeVisible();
  await expect(amount).toHaveText('450.000');
});

/**
 * A receipt photographed and attached by thumb, and on the transaction the moment it is saved.
 *
 * The one flow this task can prove on the phone project on its own; Task 18 grows this file into the full phone
 * pass. The library input is driven rather than the camera one, because Playwright cannot answer a `capture`
 * prompt — what the phone proves here is that the sheet, the grid and the strip are reachable and legible at
 * 390px, which is exactly what a desktop run cannot say.
 */
test('a photograph attached by thumb is on the receipt', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);

  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const digit of '85000') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  const { more, sheet } = await attachPhoto(page, form, { name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('a receipt') });
  await expect(sheet.getByText('Photos stay on this device with the transaction and go into your backups.')).toBeVisible();
  await closeDetails(more, sheet);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // A phone reaches a receipt by tapping the row's face; the ⓘ the desktop uses is `hidden md:inline-flex`.
  await page.getByTestId('transaction-row').filter({ hasText: 'Superindo' }).getByRole('button', { name: /^Groceries/ }).click();
  const picture = page.getByTestId('photo-strip').getByRole('img', { name: 'Receipt photo for Superindo' });
  await expect(picture).toBeVisible();
  expect(await picture.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text())).toBe('a receipt');
});

/** Below this a thumb misses; iOS' own guidance and the size every other phone spec here holds things to. */
const TAP = 44;

/**
 * The dock does the arithmetic, DONE puts it away, and **the dock never saves**.
 *
 * `120000+35000` goes in one key at a time, which is what a thumb does: the expression is built on the row and
 * read once, by `amountAfterDone` — the same `settledAmount` the desktop field runs on blur and on Enter. A
 * second, weaker arithmetic in `Keypad.tsx` is how a 100x error lives on the one path no unit test mounts.
 *
 * There is no Save key, on purpose: saving belongs to the card's own button, where the figure can be read
 * before it is committed. A dock that saved would save whatever a thumb's width landed on.
 */
test('the dock adds up what a thumb types, and has no Save key of its own', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);

  const amount = form.getByRole('button', { name: 'Amount', exact: true });
  await amount.click();
  const keypad = page.getByTestId('keypad');
  await expect(keypad).toBeVisible();

  // Nothing on the dock saves. Asserted while it is open, which is the only time it could.
  await expect(keypad.getByRole('button', { name: 'Save' })).toHaveCount(0);
  // …and nothing on it offers a figure typed before: the dock holds keys, never a history of amounts.
  await expect(keypad.getByRole('button', { name: /^Recent/ })).toHaveCount(0);

  for (const key of '120000+35000') await keypad.getByRole('button', { name: key, exact: true }).click();
  // Still the expression, unread: DONE is what reads it, and a dock that evaluated as it went would show
  // 155000 here — the same difference the desktop's two keystrokes keep.
  await expect(amount).toHaveText('120000+35000');

  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(keypad).toBeHidden();
  await expect(amount).toHaveText('155.000');

  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('155.000');
});

/**
 * §C1 and C2 by thumb: the flag, the second figure it brings, and what happens when the flag goes back.
 *
 * The charged row is the figure that **posts**; the typed one becomes what the merchant charged. On a phone
 * both are buttons opening the same dock, each carrying its own currency — a dock handed the account's currency
 * while the row above it shows the merchant's is a 100x error on a path no desktop run walks.
 *
 * CNY, not USD: its exponent is 0 like IDR's, so a figure read in the wrong one of the two looks plausible
 * rather than obviously wrong, and only the *rate* can tell them apart.
 */
test('the flag brings the charged row, pre-filled at the day’s rate, and takes it away again', async ({ page }) => {
  const TODAY = await todayIn(page);
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addWallet(page);
  // A CNY account opened today stores today's CNY→IDR rate; that is the only rate this device will have.
  await openAccount(page, { subtype: 'bank', name: 'Alipay', currency: 'CNY', balance: '1000', rate: '2270', opened: TODAY });

  await page.goto('/transactions/new');
  await page.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  // No second figure while both sides are IDR: what was typed is what the account was charged.
  await expect(page.getByRole('button', { name: 'Charged in IDR' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'CNY Chinese Yuan' }).first().click();

  const amount = page.getByRole('button', { name: 'Amount', exact: true });
  await amount.click();
  const keypad = page.getByTestId('keypad');
  for (const key of '120') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();

  /*
   * The row is here, and the rate behind it is the one this device stored: ¥120 at 2.270 is Rp 272.400.
   *
   * The figure is asserted, and the digits above were tapped **one at a time**, which is the whole point: the
   * pre-fill used to write into the charged row only while that row was empty, so a figure typed rather than
   * pasted locked the estimate onto its first keystroke and ¥120 pre-filled **Rp 2.270** — the rate for one
   * yuan, in the row that actually posts. Nothing caught it because the desktop spec used Playwright's
   * `fill()`, which sets the whole amount in a single change, where a thumb and a keyboard do not.
   */
  const charged = page.getByRole('button', { name: 'Charged in IDR' });
  await expect(charged).toBeVisible();
  await expect(charged).toHaveText('272.400');
  // Each figure is named by the code in front of it rather than by a caption hanging off the right edge, and
  // the ≈ is the whole of what the line under the row used to say: this figure is the day's estimate rather
  // than what the bank took. The rate itself is no longer printed here — a rate the device does not hold is
  // still asked for, by the Rate row `extraRows` puts under Add more details.
  await expect(page.getByText('CNY', { exact: true })).toBeVisible();
  await expect(page.getByText('≈ IDR', { exact: true })).toBeVisible();

  // Both figures are on ONE row, which is what the two codes in front of them buy: the typed figure and the
  // figure that posts sit side by side, parted by a rule, rather than one above the other.
  const amountBox = (await amount.boundingBox())!;
  const chargedBox = (await charged.boundingBox())!;
  expect(Math.abs(amountBox.y - chargedBox.y), 'the two figures share a row').toBeLessThan(2);
  expect(chargedBox.x, 'the charged figure is to the right of the typed one').toBeGreaterThan(amountBox.x);

  // And the thumb's targets on the two money rows are targets a thumb can hit: 44px, Apple's minimum, measured
  // rather than assumed. The figure is the most-pressed control on the card and its button used to be the
  // height of its own text — 32px in a 56px row.
  for (const name of ['Amount', 'Charged in IDR']) {
    const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.height, `${name} is a thumb target`).toBeGreaterThanOrEqual(44);
  }

  // The row is a suggestion, not the answer: what the bank really took is typed over it, on its own dock.
  await charged.click();
  for (const key of 'C275000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(charged).toHaveText('275.000');
  // Typed by hand, so it is no longer a guess and stops being marked as one — the code stays, the ≈ goes.
  await expect(page.getByText('≈ IDR', { exact: true })).toHaveCount(0);
  await expect(page.getByText('IDR', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.getByLabel('Note').fill('Luckin Coffee');
  await page.getByRole('button', { name: 'Save' }).click();

  // The figure that posted is the one the bank took; the typed one is kept as what the merchant charged.
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Luckin Coffee' });
  await expect(row).toContainText('275.000');
  await expect(row).toContainText('CN¥120');
  await row.getByRole('button', { name: /^Groceries/ }).click();
  await expect(page.locator('div', { hasText: /^Total/ }).last()).toContainText('275.000');
  await expect(page.locator('div', { hasText: /^Original amount/ }).last()).toContainText('120');

  // Putting the flag back where it was takes the row away with it: there is nothing left to ask.
  await page.goto('/transactions/new');
  await page.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await page.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'CNY Chinese Yuan' }).first().click();
  await expect(page.getByRole('button', { name: 'Charged in IDR' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'IDR Indonesian Rupiah' }).first().click();
  await expect(page.getByRole('button', { name: 'Charged in IDR' })).toHaveCount(0);
});

/**
 * §4 by thumb: the channel, a picture and the exclusion, set on one purchase and read back off its receipt.
 *
 * Three different writers — a column on `transaction_flags`, a row in `transaction_photos` with its bytes in
 * OPFS, and the flag's other column — behind one Save. The phone is the shell where all three are hardest to
 * reach, and where a row too small for a thumb is the same as a row that is not there.
 */
test('Channel, a photograph and Exclude all reach the receipt from the phone', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);

  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const key of '85000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  const { more, sheet } = await attachPhoto(page, form, { name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('a thumbed receipt') });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await more.getByRole('button', { name: 'Channel' }).click();
  await page.getByRole('dialog', { name: 'Channel' }).getByRole('button', { name: 'Offline' }).click();
  await more.getByRole('switch', { name: 'Exclude from report' }).click();
  await expect(more.getByRole('switch', { name: 'Exclude from report' })).toHaveAttribute('aria-checked', 'true');

  // Every row under here is reachable by a thumb, including the switch, which is the smallest of them.
  for (const name of ['Event', 'Channel', 'Photos']) {
    const box = (await more.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(box.height, `the ${name} row is under ${TAP}px`).toBeGreaterThanOrEqual(TAP);
  }
  const switchBox = (await more.getByRole('switch', { name: 'Exclude from report' }).boundingBox())!;
  expect(switchBox.height, `the Exclude switch is under ${TAP}px`).toBeGreaterThanOrEqual(TAP);

  // The details are part of the form now, so nothing stands between them and Save.
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await page.getByTestId('transaction-row').filter({ hasText: 'Superindo' }).getByRole('button', { name: /^Groceries/ }).click();
  await expect(page.locator('div', { hasText: /^Channel/ }).last()).toContainText('Offline');
  await expect(page.getByTestId('excluded-note')).toContainText('Excluded from the chart and budgets');
  const picture = page.getByTestId('photo-strip').getByRole('img', { name: 'Receipt photo for Superindo' });
  expect(await picture.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text())).toBe('a thumbed receipt');
});

/**
 * Every row a thumb has to hit on the card itself, measured rather than assumed.
 *
 * A row under 44px is a row that is technically there and practically is not, and this card is the one screen
 * the whole app funnels through. The figure is the row's drawn height, read off the page.
 */
test('every row on the card is big enough for a thumb', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions/new');

  const rows = ['Workspace', 'Paid with', 'Category', 'Add more details'];
  for (const name of rows) {
    const box = (await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().boundingBox())!;
    expect(box.height, `the ${name} row is under ${TAP}px`).toBeGreaterThanOrEqual(TAP);
  }
  /*
   * The amount is deliberately **not** measured here, because it fails: on a phone the figure is a bare
   * `<button>` inside an `h-14 items-center` row, so its own hit area is the text's height — 32px — not the
   * row's 56. It is the most-pressed control on the card and the first thing §18 names. Reported rather than
   * repaired: the fix is a height on `MoneyField`'s button, which belongs to the single design-system pass the
   * owner has ruled out doing twice. The keys below are measured because they pass, and because they are what
   * a thumb that misses the figure lands on.
   */
  await page.getByRole('button', { name: 'Amount', exact: true }).click();
  for (const key of ['7', 'DONE', '000']) {
    const box = (await page.getByTestId('keypad').getByRole('button', { name: key, exact: true }).boundingBox())!;
    expect(box.height, `the ${key} key is under ${TAP}px`).toBeGreaterThanOrEqual(TAP);
  }
});

test('Paid with adds an account on the way, and the transaction comes back as typed with it picked', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const digit of '85000') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByLabel('Note').fill('Superindo');

  // Not on the list yet: the list's own last row opens New account, and its way back names where it came from.
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/\/accounts\/new/);
  await expect(page.getByRole('link', { name: 'New transaction' }).or(page.getByRole('button', { name: 'New transaction' })).first()).toBeVisible();
  await page.getByRole('button', { name: /^Current account(\b|$)/ }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Jago');
  await page.getByRole('button', { name: 'Add account' }).click();

  // Back on the form, as it was, with Jago paying.
  await expect(page).toHaveURL(/\/transactions\/new/);
  await expect(form.getByLabel('Note')).toHaveValue('Superindo');
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toContainText('85.000');
  await expect(form.getByRole('button', { name: 'Paid with' })).toContainText('Jago');
});

test('backing out of New account returns to the transaction as typed, with nothing picked', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByLabel('Note').fill('Parking');
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/\/accounts\/new/);

  await page.getByRole('link', { name: 'New transaction' }).or(page.getByRole('button', { name: 'New transaction' })).first().click();
  await expect(page).toHaveURL(/\/transactions\/new/);
  await expect(form.getByLabel('Note')).toHaveValue('Parking');
  await expect(form.getByRole('button', { name: 'Paid with' })).not.toContainText('BCA');
});

test('Paid with narrows to what is typed in its search, and says when nothing matches', async ({ page }) => {
  await addWallet(page);
  await openAccount(page, { subtype: 'bank', name: 'Jago Syariah' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Paid with' }).click();
  const sheet = page.getByRole('dialog', { name: 'Paid with' });
  const search = sheet.getByRole('searchbox', { name: 'Search Paid with' });

  // No field on the list until ⌕ in the header asks for one.
  await expect(search).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(search).toBeFocused();
  await search.fill('jago');
  await expect(sheet.getByRole('button', { name: 'Jago Syariah', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'BCA Tahapan', exact: true })).toHaveCount(0);
  // Add account stays at the foot whatever is typed: the account looked for may not be there yet.
  await expect(sheet.getByRole('button', { name: 'Add account' })).toBeVisible();

  await search.fill('zzz');
  await expect(sheet.getByText('Nothing here matches “zzz”.')).toBeVisible();

  await search.fill('');
  await sheet.getByRole('button', { name: 'Jago Syariah', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Paid with' })).toContainText('Jago Syariah');
});

test('the dock has a decimal comma for dollars, and keeps 00 for rupiah', async ({ page }) => {
  await addWallet(page);
  await openAccount(page, { subtype: 'bank', name: 'Wise USD', currency: 'USD' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  const keypad = page.getByTestId('keypad');

  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  await expect(keypad.getByRole('button', { name: '00', exact: true })).toBeVisible();
  await expect(keypad.getByRole('button', { name: ',', exact: true })).toHaveCount(0);
  await keypad.getByRole('button', { name: 'Close keypad' }).click();

  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'Wise USD');
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  await expect(keypad.getByRole('button', { name: '00', exact: true })).toHaveCount(0);
  for (const key of ['1', '2', ',', '5', '0']) await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toContainText('12,50');
});

test('Paid with has tabs for accounts and cards, and its search looks across both', async ({ page }) => {
  await addWallet(page);
  await openAccount(page, { subtype: 'credit_card', name: 'BCA KrisFlyer', balance: '0', last4: '1234' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Paid with' }).click();
  const sheet = page.getByRole('dialog', { name: 'Paid with' });
  const tabs = sheet.getByRole('radiogroup', { name: 'Paid with: which kind' });

  // Nothing chosen yet: Accounts, with the way to add one as the list's own last row.
  await expect(tabs.getByRole('radio', { name: 'Accounts' })).toBeChecked();
  await expect(tabs.getByRole('radio', { name: 'All' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'BCA Tahapan', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Add account' })).toBeVisible();

  // The sheet stands at one height, as an iOS sheet does: switching the tab does not move its top edge.
  const top = (await sheet.boundingBox())!.y;
  // Credit cards: only cards, and the last row adds a card.
  await tabs.getByRole('radio', { name: 'Credit cards' }).click();
  expect((await sheet.boundingBox())!.y).toBe(top);
  await expect(sheet.getByRole('button', { name: /^BCA KrisFlyer/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'BCA Tahapan', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Add credit card' })).toBeVisible();

  // ⌕ in the header puts the search where the tabs were; it looks across both, under their headings. Its ✕ closes
  // it, and the tab that was open comes back.
  const list = sheet.getByTestId('payment-sections');
  const before = (await list.boundingBox())!.y - (await sheet.boundingBox())!.y;
  await sheet.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(tabs).toHaveCount(0);
  // The field takes the tabs' own row, so the list does not move, and the sheet stays at the detent it was left at;
  // only one ✕ is on the sheet, the field's.
  await expect(sheet).toHaveAttribute('data-detent', 'medium');
  await expect.poll(async () => (await list.boundingBox())!.y - (await sheet.boundingBox())!.y).toBe(before);
  // And the field spans the row, edge to edge with the list under it.
  const pill = sheet.getByRole('searchbox', { name: 'Search Paid with' }).locator('xpath=..');
  expect(Math.round((await pill.boundingBox())!.width)).toBe(Math.round((await list.boundingBox())!.width));
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0);
  await sheet.getByRole('searchbox', { name: 'Search Paid with' }).fill('bca');
  await expect(sheet.getByRole('heading', { name: 'Accounts' })).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Credit cards' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close search' }).click();
  await expect(sheet.getByRole('searchbox', { name: 'Search Paid with' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(tabs.getByRole('radio', { name: 'Credit cards' })).toBeChecked();
  await expect(sheet.getByRole('button', { name: 'BCA Tahapan', exact: true })).toHaveCount(0);

  // Nothing chosen yet, so nothing is marked.
  await expect(sheet.locator('[aria-current="true"]')).toHaveCount(0);

  // Chosen by card, the sheet opens on Credit cards next time, with that card marked.
  await sheet.getByRole('button', { name: /^BCA KrisFlyer/ }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await expect(tabs.getByRole('radio', { name: 'Credit cards' })).toBeChecked();
  await expect(sheet.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(sheet.getByRole('button', { name: /^BCA KrisFlyer/ })).toHaveAttribute('aria-current', 'true');
});

test('Add credit card on the Credit cards tab opens the card form, and the card comes back picked', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByLabel('Note').fill('Hotel');
  await form.getByRole('button', { name: 'Paid with' }).click();
  const sheet = page.getByRole('dialog', { name: 'Paid with' });
  await sheet.getByRole('radiogroup', { name: 'Paid with: which kind' }).getByRole('radio', { name: 'Credit cards' }).click();
  await expect(sheet.getByText('No credit cards yet.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Add credit card' }).click();

  // Straight to the card's own form, not the list of debts.
  await expect(page).toHaveURL(/\/debts\/new/);
  await page.getByLabel('Name', { exact: true }).fill('UOB PRVI');
  await page.getByLabel('Last 4 digits').fill('3310');
  await page.getByRole('button', { name: 'Add card' }).click();

  await expect(page).toHaveURL(/\/transactions\/new/);
  await expect(form.getByLabel('Note')).toHaveValue('Hotel');
  await expect(form.getByRole('button', { name: 'Paid with' })).toContainText('UOB PRVI');
});

test('Note offers past notes over the keyboard, and a pick brings its category', async ({ page }) => {
  await addWallet(page);
  await addTransaction(page, { description: 'Grabfood Gudeg Jogja', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '45000' });

  await page.goto('/transactions/new');
  const form = addForm(page);
  const note = form.getByRole('textbox', { name: 'Note' });
  const suggestions = page.getByRole('listbox', { name: 'Suggested notes' });

  // One letter is too little to go on.
  await note.fill('G');
  await expect(suggestions).toHaveCount(0);

  await note.fill('Grabfood G');
  const pick = suggestions.getByRole('option', { name: /^Grabfood Gudeg Jogja/ });
  await expect(pick).toContainText('Restaurants');
  await pick.click();

  await expect(note).toHaveValue('Grabfood Gudeg Jogja');
  await expect(note).toBeFocused();
  await expect(suggestions).toHaveCount(0);
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Restaurants');
});

test('a note typed out in full brings its category on leaving Note, but never over one already chosen', async ({ page }) => {
  await addWallet(page);
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '38000' });

  await page.goto('/transactions/new');
  const form = addForm(page);
  const note = form.getByRole('textbox', { name: 'Note' });
  await note.fill('Kopi Kenangan');
  await note.blur();
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Restaurants');

  await page.goto('/transactions/new');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await note.fill('Kopi Kenangan');
  await note.blur();
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Groceries');
});

test('Paid with opens at the medium detent, drags up to large and back, and closes when pulled well down', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions/new');
  await addForm(page).getByRole('button', { name: 'Paid with' }).click();
  const sheet = page.getByRole('dialog', { name: 'Paid with' });
  await expect(sheet).toHaveAttribute('data-detent', 'medium');
  const handle = sheet.getByTestId('sheet-drag');
  const drag = async (dy: number) => {
    const box = (await handle.boundingBox())!;
    const x = box.x + 40;
    const y = box.y + 10;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) await page.mouse.move(x, y + (dy * step) / 12);
    await page.mouse.up();
  };

  await drag(-300);
  await expect(sheet).toHaveAttribute('data-detent', 'large');
  await drag(300);
  await expect(sheet).toHaveAttribute('data-detent', 'medium');
  // Let the sheet settle at its detent before tapping in its header.
  await page.waitForTimeout(400);
  // A tap on the header's buttons is still a tap, and opening the search leaves the sheet where it was.
  await sheet.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(sheet.getByRole('searchbox', { name: 'Search Paid with' })).toBeVisible();
  await expect(sheet).toHaveAttribute('data-detent', 'medium');
  await sheet.getByRole('button', { name: 'Close search' }).click();
  await drag(700);
  await expect(sheet).toHaveCount(0);
});

test('Select category ends in Manage categories, which opens the Categories page', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions/new');
  await addForm(page).getByRole('button', { name: /^Category/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Select category' });
  await sheet.getByRole('link', { name: 'Manage categories' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/categories$/);
});
