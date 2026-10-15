import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard, openSettings, openTypes } from './accounts';
import { addForm, addTransaction, choosePayment, saveButton } from './add-transaction';

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

/** Nothing on the page is wider than the phone: a row that will not truncate pushes the whole list sideways. */
async function fitsThePhone(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
}

/**
 * Option A of the row (two lines, never three): a foreign purchase on a card reads the amount here on the right's first
 * line and the foreign amount under it, on one line with any points; the left names the card by its last four digits
 * alone, not by its long account name.
 */
test('a foreign card purchase is two lines on each side, the card named "···· 4417"', async ({ page }) => {
  // No rate server: the charged figure is typed, so nothing waits on one.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openCard(page, { name: 'Nusa Voyager Travel', owed: '0', last4: '4417' });

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'Nusa Voyager Travel');
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'USD US Dollar' }).first().click();
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const key of '86') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Charged in IDR' }).click();
  for (const key of '1390000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Lantern Noodle Bar');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  const noodles = row(page, 'Lantern Noodle Bar');
  // The left: the note, then the card by its digits, and not the account's name.
  await expect(noodles).toContainText('Lantern Noodle Bar · ···· 4417');
  await expect(noodles).not.toContainText('Nusa Voyager Travel');
  // The right: the amount here, and one line under it with the foreign amount.
  await expect(noodles).toContainText('1.390.000');
  const extra = noodles.getByTestId('amount-extra');
  await expect(extra).toHaveCount(1);
  await expect(extra).toHaveText('US$86,00');
  // One line of 12px type, never two stacked.
  expect((await extra.boundingBox())!.height).toBeLessThan(20);
  await fitsThePhone(page);
});

/**
 * The longest line under an amount there is — a foreign amount and points in a long unit — still leaves the left side
 * room to read: the category and the note keep a usable width, and nothing on the page scrolls sideways.
 */
test('a foreign purchase that earns cashback keeps the left side readable at a phone’s width', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openCard(page, { name: 'Nusa Voyager Travel', owed: '0', last4: '4417' });
  await page.goto('/cards');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^Nusa Voyager Travel(,|$)/ }).click();
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByLabel('Earns').selectOption({ label: 'Cashback' });
  await page.getByRole('button', { name: 'Set up rewards' }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Base');
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByLabel('Per spend (IDR)').fill('100');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Step 3 of 3')).toHaveCount(0);

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'Nusa Voyager Travel');
  await form.getByRole('button', { name: 'Currency' }).click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'EUR Euro' }).first().click();
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  for (const key of '1234,56') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Charged in IDR' }).click();
  for (const key of '1234500') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Harbour Lantern Brasserie');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  const dinner = row(page, 'Harbour Lantern Brasserie');
  const extra = dinner.getByTestId('amount-extra');
  // Both parts, on the one line under the amount.
  await expect(extra).toContainText('€1.234,56');
  await expect(extra).toContainText('12.345 cashback');
  expect((await extra.boundingBox())!.height).toBeLessThan(20);
  // The left side keeps room to be read: the category and the note are not squeezed to a sliver.
  const face = dinner.getByRole('button', { name: /^Restaurants/ });
  expect((await face.boundingBox())!.width).toBeGreaterThanOrEqual(120);
  await fitsThePhone(page);
});

/**
 * A digital wallet tied to a phone number says so by the number's last four digits, recorded on the form that opens it
 * and changed on its settings; its rows show them as a card's are shown, and it never becomes a card.
 */
test('a wallet with phone digits shows "···· 5521" on its rows, and is never offered as a card', async ({ page }) => {
  await openAccount(page, {
    subtype: 'ewallet',
    name: 'Kantong Biru',
    balance: '500000',
    extra: async (p) => {
      const digits = p.getByLabel('Last 4 digits of phone');
      // Anything but four digits is refused in words.
      await digits.fill('55');
      await expect(p.getByText('The last 4 digits of the phone number are four numbers, like 5521.')).toBeVisible();
      // A whole number pasted in keeps its last four, never the carrier's prefix.
      await digits.fill('0812-3456-5521');
      await expect(p.getByText('The last 4 digits of the phone number are four numbers, like 5521.')).toHaveCount(0);
    },
  });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Mie Ayam Pak Darmo', paidWith: 'Kantong Biru', category: 'Restaurants', amount: '35000' });
  const lunch = row(page, 'Mie Ayam Pak Darmo');
  await expect(lunch).toContainText('Mie Ayam Pak Darmo · ···· 5521');
  await expect(lunch).not.toContainText('Kantong Biru');
  await fitsThePhone(page);

  // Paid with offers the wallet as itself, with no card on it.
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Paid with' }).click();
  const sheet = page.getByRole('dialog', { name: /^(Paid with|Received into|From)$/ });
  await expect(sheet.getByRole('button', { name: 'Kantong Biru', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /5521/ })).toHaveCount(0);
  await page.goto('/cards');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByText('Kantong Biru')).toHaveCount(0);

  // Changed on the wallet's settings, the rows follow.
  await page.goto('/accounts');
  await openTypes(page);
  await page.getByRole('link', { name: 'Kantong Biru', exact: true }).click();
  await openSettings(page);
  const digits = page.getByLabel('Last 4 digits of phone');
  await expect(digits).toHaveValue('5521');
  await digits.fill('7310');
  await digits.blur();
  // Away inside the app, as a person would: a reload straight after the blur could cut the save short.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Transactions' }).click();
  await expect(row(page, 'Mie Ayam Pak Darmo')).toContainText('Mie Ayam Pak Darmo · ···· 7310');
});
