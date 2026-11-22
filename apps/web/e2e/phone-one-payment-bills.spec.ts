import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { addBill } from './bill-pause';
import { addPart, donePart, fillPart, openPart, openSplit, pickPartCategory, splitSheet } from './split-row';

/*
 * One payment, several bills (owner mockup 2026-11-22): three bills paid in one marketplace checkout show as one line on
 * the card. Invented bills, card and figures: Internet Rp 385.000, Mobile phone Rp 150.000, Mobile phone 2 Rp 100.000,
 * on Kartu Contoh 4417.
 */

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function threeBills(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await openAccount(page, { subtype: 'credit_card', name: 'Kartu Contoh', last4: '4417' });
  await addBill(page, 'Internet', '385000', 'Internet provider');
  await addBill(page, 'Mobile phone', '150000', 'Mobile phone');
  await addBill(page, 'Mobile phone 2', '100000', 'Mobile phone');
}

const paidGroup = (page: Page) => page.getByTestId('bills-paid');
const unpaid = (page: Page, name: string) => page.locator('[data-testid="bill-row"]:not([data-testid="bills-paid"] *)').filter({ hasText: new RegExp(`^${name}(?! 2)`) });
const txRow = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

test('Pay several › One payment records one transaction on the card, split by bill; all three read paid, and deleting it un-pays all three', async ({ page }) => {
  await threeBills(page);
  await page.goto('/bills');
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  for (const name of ['Internet', 'Mobile phone', 'Mobile phone 2']) await page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Pay 3 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });

  // On each bill's own account, One payment says what it needs.
  await sheet.getByRole('checkbox', { name: 'One payment' }).click();
  await expect(sheet).toContainText('Choose the one Payment method they were paid with.');
  await expect(sheet.getByRole('button', { name: /^Record 3 bills/ })).toBeDisabled();

  await sheet.getByTestId('several-with').getByRole('button').click();
  await page.getByRole('dialog', { name: 'Payment method' }).getByRole('button', { name: /Kartu Contoh/ }).click();
  await expect(sheet).toContainText('One transaction on the card, split by bill, as the statement shows it.');
  await expect(sheet.getByLabel('Note')).toHaveAttribute('placeholder', 'Note');
  await sheet.getByLabel('Note').fill('Bayar sekaligus');
  const record = sheet.getByRole('button', { name: /^Record 3 bills · Rp\s?635\.000$/ });
  await expect(record).toBeVisible();
  await shot(page, 'one-payment-sheet');
  await record.click();
  await expect(sheet).toHaveCount(0);

  // All three paid for this month.
  for (const name of ['Internet', 'Mobile phone', 'Mobile phone 2']) await expect(paidGroup(page).getByTestId('bill-row').filter({ hasText: name }).first()).toBeVisible();
  await expect(paidGroup(page).getByTestId('bill-row')).toHaveCount(3);
  await shot(page, 'one-payment-bills-page');

  // One row in Cashflow for all three.
  await page.goto('/transactions');
  await expect(txRow(page, 'Bayar sekaligus')).toHaveCount(1);
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);
  await txRow(page, 'Bayar sekaligus').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'one-payment-cashflow');

  // Each bill's paid month opens the same one transaction.
  await page.goto('/bills');
  await paidGroup(page).getByTestId('bill-row').filter({ hasText: 'Mobile phone 2' }).click();
  await expect(page.getByTestId('bill-hero')).toBeVisible();

  // Deleted from its receipt: every bill it paid is owed again.
  await page.goto('/transactions');
  await txRow(page, 'Bayar sekaligus').getByRole('button').first().click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await expect(page.getByTestId('receipt-bill')).toContainText('3 bills');
  await page.getByRole('button', { name: 'Delete this transaction', exact: true }).click();
  await page.getByRole('button', { name: 'Click again to delete', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(page.getByTestId('transaction-row')).toHaveCount(0);
  await page.goto('/bills');
  for (const name of ['Internet', 'Mobile phone', 'Mobile phone 2']) await expect(unpaid(page, name)).toHaveCount(1);
  await expect(paidGroup(page)).toHaveCount(0);
});

test('a Split part’s Bill row links that bill to the purchase', async ({ page }) => {
  await threeBills(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'Kartu Contoh');
  await openAmount(form);
  await fillAmount(page, form, '535000');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Internet provider', exact: true }).click();
  await form.getByLabel('Note').fill('Tokopedia');
  await form.getByRole('button', { name: 'Add more details' }).click();
  await openSplit(page);
  await addPart(page);
  await fillPart(page, 1, '385000');
  await pickPartCategory(page, 2, 'Mobile phone');

  // Part 2 pays Mobile phone: its own category's bills come first, and None is there.
  const part = await openPart(page, 2);
  await part.getByTestId('split-part-bill').getByRole('button').click();
  const list = page.getByRole('dialog', { name: 'Bill', exact: true });
  const choices = list.getByTestId('split-bill-choice');
  await expect(choices.first()).toContainText('None');
  await expect(choices.nth(1)).toContainText(/^Mobile phone · /);
  await expect(choices.nth(2)).toContainText(/^Mobile phone 2 · /);
  await choices.nth(1).click();
  await expect(part.getByTestId('split-part-bill')).toContainText(/Mobile phone · /);
  await shot(page, 'split-part-bill');
  await donePart(page);
  await expect(splitSheet(page).getByTestId('split-row').nth(1)).toContainText(/Bill: Mobile phone · /);
  await shot(page, 'split-parts');
  await splitSheet(page).getByRole('button', { name: 'Done' }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await page.goto('/bills');
  await expect(paidGroup(page).getByTestId('bill-row')).toHaveCount(1);
  await expect(paidGroup(page)).toContainText('Mobile phone');
  await expect(unpaid(page, 'Internet')).toHaveCount(1);
  await expect(unpaid(page, 'Mobile phone 2')).toHaveCount(1);
});

test('Undo payment on one bill’s page asks to undo the whole payment, naming all three, and un-pays them', async ({ page }) => {
  await threeBills(page);
  await page.goto('/bills');
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  for (const name of ['Internet', 'Mobile phone', 'Mobile phone 2']) await page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Pay 3 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  await sheet.getByTestId('several-with').getByRole('button').click();
  await page.getByRole('dialog', { name: 'Payment method' }).getByRole('button', { name: /Kartu Contoh/ }).click();
  await sheet.getByRole('checkbox', { name: 'One payment' }).click();
  await sheet.getByRole('button', { name: /^Record 3 bills · / }).click();
  await expect(sheet).toHaveCount(0);

  page.removeAllListeners('dialog');
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await paidGroup(page).getByTestId('bill-row').filter({ hasText: 'Mobile phone 2' }).click();
  await page.getByTestId('bill-history').getByRole('button', { name: /bill/ }).click();
  await page.getByRole('dialog', { name: /^Mobile phone 2 · .* bill$/ }).getByRole('button', { name: 'Undo payment' }).click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toMatch(/^Undo the whole payment\?\s+Deletes the Rp\s?635\.000 payment\. Internet, Mobile phone and Mobile phone 2 become unpaid for \w+\.$/);
  await expect(page.getByTestId('bill-history')).toHaveCount(0);
  await page.goto('/bills');
  for (const name of ['Internet', 'Mobile phone', 'Mobile phone 2']) await expect(unpaid(page, name)).toHaveCount(1);
});
