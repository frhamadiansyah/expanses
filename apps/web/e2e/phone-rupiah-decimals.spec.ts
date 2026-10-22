import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addForm, choosePayment, saveButton } from './add-transaction';
import { cardSection } from './card-section';
import { openSplit } from './split-row';

/*
 * Decimals on a whole-unit currency (spec 2026-10-14). A card charges a purchase of Rp 12.500,30 as 12.501 and earns
 * points on 12.500. The single amount takes the cents on the dock's comma; the ledger posts the whole figure and keeps
 * the exact one beside it; every screen after the save shows the whole figure.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

/** Types a figure on the open dock, key by key, and presses DONE. */
async function typeOnDock(page: Page, figure: string) {
  const keypad = page.getByTestId('keypad');
  for (const key of figure) await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(keypad).toBeHidden();
}

/** The figure on the receipt's Points earned line, beside its label. */
const pointsEarned = (page: Page): Locator => page.getByText('Points earned', { exact: true }).locator('xpath=following-sibling::span');

/**
 * A card earning 1 point per Rp 12.501: the charged 12.501 would earn one, the exact figure rounded down (12.500)
 * earns none — so the receipt tells which figure the points were worked out on.
 */
async function cardEarningPer12501(page: Page) {
  await openCard(page, { name: 'CIMB Octo' });
  await page.goto('/cards');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^CIMB Octo(,|$)/ }).click();
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByRole('button', { name: 'Set up rewards' }).click();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Base');
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByLabel('Per spend (IDR)').fill('12501');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Step 3 of 3')).toHaveCount(0);
}

test('a purchase typed with cents posts rounded up, reopens whole, and an edit of its note keeps its points on the exact figure', async ({ page }) => {
  await cardEarningPer12501(page);

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  const amount = form.getByRole('button', { name: 'Amount', exact: true });
  await amount.click();
  // The single amount of an expense takes cents, so the dock trades its 00 for a comma.
  const keypad = page.getByTestId('keypad');
  await expect(keypad.getByRole('button', { name: ',', exact: true })).toBeVisible();
  await expect(keypad.getByRole('button', { name: '00', exact: true })).toHaveCount(0);
  await typeOnDock(page, '12500,30');
  // The cents stay on screen while the form is open.
  await expect(amount).toHaveText('12.500,30');
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'CIMB Octo');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Kopi');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Charged rounded up, and shown whole.
  await expect(row(page, 'Kopi')).toContainText('12.501');
  await expect(row(page, 'Kopi')).not.toContainText('12.500,30');

  await row(page, 'Kopi').getByRole('button', { name: /^Groceries/ }).click();
  await expect(page.getByTestId('hero-amount')).toContainText('12.501');
  // Points on 12.500: none at 1 per 12.501. On the charged 12.501 there would be one.
  await expect(pointsEarned(page)).toHaveText(/^(≈ )?0 points?$/);

  // Reopened, the form shows the whole figure that posted.
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  const edit = page.getByRole('form', { name: 'Edit a transaction' });
  await expect(edit.getByRole('button', { name: 'Amount', exact: true })).toHaveText('12.501');
  // The amount is left alone and only the note changes: the exact figure is kept.
  await edit.getByLabel('Note').fill('Kopi susu');
  await saveButton(edit).click();
  await expect(edit).toHaveCount(0);

  await page.goto('/transactions');
  await expect(row(page, 'Kopi susu')).toContainText('12.501');
  await row(page, 'Kopi susu').getByRole('button', { name: /^Groceries/ }).click();
  await expect(page.getByTestId('hero-amount')).toContainText('12.501');
  await expect(pointsEarned(page)).toHaveText(/^(≈ )?0 points?$/);

  // The positive control: retyped to another whole amount, the exact figure goes, and the points follow the charge.
  // (Retyping the same 12.501 would keep it: the amount has not changed.)
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  await expect(edit.getByRole('button', { name: 'Amount', exact: true })).toHaveText('12.501');
  await edit.getByRole('button', { name: 'Amount', exact: true }).click();
  await page.getByTestId('keypad').getByRole('button', { name: 'C', exact: true }).click();
  await typeOnDock(page, '12502');
  await expect(edit.getByRole('button', { name: 'Amount', exact: true })).toHaveText('12.502');
  await saveButton(edit).click();
  await expect(edit).toHaveCount(0);

  await page.goto('/transactions');
  await expect(row(page, 'Kopi susu')).toContainText('12.502');
  await row(page, 'Kopi susu').getByRole('button', { name: /^Groceries/ }).click();
  await expect(page.getByTestId('hero-amount')).toContainText('12.502');
  await expect(pointsEarned(page)).toHaveText(/^(≈ )?1 points?$/);
});

test('the card shows a purchase typed with cents at what it was charged, and still earns on the exact figure', async ({ page }) => {
  await cardEarningPer12501(page);

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  await typeOnDock(page, '12500,30');
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'CIMB Octo');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Kopi');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await page.goto('/cards');
  await page.getByRole('region', { name: 'Cards' }).getByRole('link', { name: /^CIMB Octo(,|$)/ }).click();
  // Wallet's latest transactions: the charge, 12.501, never the 12.500 the points are worked out on.
  const latest = page.getByTestId('latest-transactions');
  await expect(latest).toContainText('12.501');
  await expect(latest).not.toContainText('12.500');

  await cardSection(page, 'Points');
  // The cycle's Spend and the purchase's row say what the card was charged ...
  const spend = page.getByText('Spend', { exact: true }).locator('xpath=following-sibling::span');
  await expect(spend).toContainText('12.501');
  await expect(spend).not.toContainText('12.500');
  const purchase = page.getByTestId('purchase').filter({ hasText: 'Kopi' });
  await expect(purchase).toContainText('12.501');
  await expect(purchase).not.toContainText('12.500');
  // ... while the estimate is still worked out on 12.500: none at 1 per 12.501.
  await expect(purchase).toContainText(/(^|\D)0 points?/);
});

test('an income typed with cents posts rounded down', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('radio', { name: 'Income' }).click();
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  await typeOnDock(page, '12345,67');
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toHaveText('12.345,67');
  await form.getByRole('button', { name: /^Received into/ }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Salary', exact: true }).click();
  await form.getByLabel('Note').fill('Bunga');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await expect(row(page, 'Bunga')).toContainText('12.345');
  await expect(row(page, 'Bunga')).not.toContainText('12.346');
});

test('a split with cents is refused in words, and its dock keeps 00', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Superindo');

  await form.getByRole('button', { name: 'Add more details' }).click();
  await openSplit(page);
  const split = page.getByRole('dialog', { name: 'Split' });
  await split.getByRole('button', { name: '+ Split' }).click();
  await split.getByLabel('Split 1 amount').fill('50000,50');
  await split.getByLabel('Split 2 category').selectOption({ label: 'Restaurants' });
  await split.getByLabel('Split 2 amount').fill('49999');
  // Said on the sheet where the row is typed: on a phone the ✓ is greyed while the draft would be refused.
  await expect(split.getByRole('alert')).toHaveText('Decimals go on a single amount only');
  await split.getByRole('button', { name: 'Close' }).click();
  await expect(saveButton(form)).toBeDisabled();

  // Spread over a split, the amount has no single line to round onto: the dock offers no comma.
  await form.getByRole('button', { name: 'Amount', exact: true }).click();
  const keypad = page.getByTestId('keypad');
  await expect(keypad.getByRole('button', { name: '00', exact: true })).toBeVisible();
  await expect(keypad.getByRole('button', { name: ',', exact: true })).toHaveCount(0);
  await keypad.getByRole('button', { name: 'Close keypad' }).click();

  // The cents taken off, the split saves whole.
  await openSplit(page);
  await split.getByLabel('Split 1 amount').fill('50001');
  await expect(split.getByRole('alert')).toHaveCount(0);
  await split.getByRole('button', { name: 'Close' }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(row(page, 'Superindo')).toContainText('100.000');
});
