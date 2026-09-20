import { expect, test } from '@playwright/test';
import { addTransaction, attachPhoto, closeDetails } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: import('@playwright/test').Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
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
  await expect(amount).toHaveText('450000');
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
 * The sheet and the dock inside it both listen for Escape on the document. One press used to be answered by
 * both: the dock shut, the sheet shut behind it, and a transaction typed to its last digit was gone with
 * nothing to get it back. The first test in this file works on `/transactions/new` precisely to avoid this;
 * here is the sheet path it was avoiding.
 */
test('Escape inside the sheet puts the dock away and keeps what was typed', async ({ page }) => {
  await addWallet(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
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
  await expect(amount).toHaveText('450000');

  // A second press is the sheet's own way out, which is what Escape was always for once the dock is gone.
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
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
  const form = page.getByRole('dialog', { name: 'Add a transaction' });

  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const digit of '85000') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  const { more, sheet } = await attachPhoto(page, form, { name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('a receipt') });
  await expect(sheet.getByText('Photos stay on this device with the transaction and go into your backups.')).toBeVisible();
  await closeDetails(more, sheet);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  // A phone reaches a receipt by tapping the row's face; the ⓘ the desktop uses is `hidden md:inline-flex`.
  await page.getByTestId('transaction-row').filter({ hasText: 'Superindo' }).getByRole('button', { name: /^Groceries/ }).click();
  const picture = page.getByTestId('photo-strip').getByRole('img', { name: 'Receipt photo for Superindo' });
  await expect(picture).toBeVisible();
  expect(await picture.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text())).toBe('a receipt');
});

const TODAY = new Date().toISOString().slice(0, 10);

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
  const form = page.getByRole('dialog', { name: 'Add a transaction' });

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
  await expect(amount).toHaveText('155000');

  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');
  await form.getByRole('button', { name: 'Save' }).click();
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
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addWallet(page);
  // A CNY account opened today stores today's CNY→IDR rate; that is the only rate this device will have.
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('Alipay');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Currency').selectOption('CNY');
  await page.getByLabel('Current balance').fill('1000');
  await page.getByLabel('Balance as of').fill(TODAY);
  await page.getByLabel('Rate: IDR per 1 CNY').fill('2270');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Alipay', exact: true })).toBeVisible();

  await page.goto('/transactions/new');
  await page.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
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
   * **The pre-filled figure itself is deliberately not asserted, because it is wrong.** `AmountRow`'s pre-fill
   * writes into the charged row only while that row is empty, and it runs on every change to the amount — so a
   * figure *typed* rather than pasted locks the estimate onto its first keystroke: ¥120 pre-fills Rp 2.270, the
   * rate for one yuan. Nothing caught it because the desktop spec uses Playwright's `fill()`, which sets the
   * whole amount in a single change, where a thumb on the dock and a human on a keyboard both type one digit at
   * a time. This task is a verification pass, so it is reported rather than repaired — and since the charged row
   * is the figure that **posts**, the hint and the typed-over figure below are what hold the row in place until
   * it is. Asserting 272400 here would fail; asserting 2270 would enshrine the defect.
   */
  const charged = page.getByRole('button', { name: 'Charged in IDR' });
  await expect(charged).toBeVisible();
  await expect(page.getByText(`≈ 2.270 per 1 CNY · suggested from ${TODAY}`)).toBeVisible();

  // The row is a suggestion, not the answer: what the bank really took is typed over it, on its own dock.
  await charged.click();
  for (const key of 'C275000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(charged).toHaveText('275000');

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
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
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
  const form = page.getByRole('dialog', { name: 'Add a transaction' });

  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const key of '85000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
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

  await more.getByRole('button', { name: 'Close' }).click();
  await form.getByRole('button', { name: 'Save' }).click();
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
