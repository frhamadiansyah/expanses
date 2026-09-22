import { expect, type Locator, type Page } from '@playwright/test';
import { openAmount } from './add-transaction';
import { openGoalForm } from './goals';
import { addBill, addGoal, addMoneyAccount, goalCard, jeniusWithTwoGoals, openAccountPage, openExpense, setAside, transferOutBorrowingFromUmrah, typeAmount } from './set-aside';

/*
 * The combination walk end to end (Task 14, step 2). Each journey is run by `set-aside-combinations.spec.ts` on the
 * desktop and by `phone-set-aside-combinations.spec.ts` on the phone's own shell: the same steps, amounts typed one
 * keystroke at a time (the keypad digit by digit on a phone), and the same figures read back on the account page and
 * on /goals. Jenius is the record's account: Rp 42.500.000, Emergency fund Rp 30.000.000, Umrah Rp 7.500.000 — Rp 5.000.000 free.
 */

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;

/** Retypes an amount already on a form: cleared first, then typed key by key (on the keypad, C then the digits). */
async function retypeAmount(page: Page, form: Locator, amount: string) {
  await openAmount(form);
  const keypad = page.getByTestId('keypad');
  if (await keypad.isVisible()) {
    await keypad.getByRole('button', { name: 'C', exact: true }).click();
    for (const digit of amount) await keypad.getByRole('button', { name: digit, exact: true }).click();
    await keypad.getByRole('button', { name: 'DONE' }).click();
    return;
  }
  const input = form.getByLabel('Amount', { exact: true });
  await input.clear();
  await input.pressSequentially(amount);
  await input.press('Tab');
}

async function pickCategory(page: Page, form: Locator) {
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
}

/** A transaction's receipt: the ⓘ link on a desktop, the row itself on a phone. */
async function openReceipt(page: Page, what: string) {
  await page.goto('/transactions');
  const row = page.getByTestId('transaction-row').filter({ hasText: what }).first();
  await expect(row).toBeVisible();
  if (isPhone(page)) await row.getByRole('button').filter({ hasNotText: /^$/ }).first().click();
  else await page.getByRole('link', { name: `Receipt for ${what}` }).first().click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
}

/** The edit from the receipt: the phone's sheet ("Edit") or the full card ("Edit transaction"), whichever this is. */
async function openEdit(page: Page, what: string) {
  await openReceipt(page, what);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('dialog', { name: /^Edit( transaction)?$/ });
  await expect(form).toBeVisible();
  return form;
}

async function deleteFromReceipt(page: Page, what: string) {
  await openReceipt(page, what);
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
}

async function saveForm(form: Locator) {
  const save = form.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(form).toHaveCount(0);
}

async function openTransfer(page: Page, from: string, to: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: from, exact: true }).click();
  await form.getByLabel('To', { exact: true }).selectOption({ label: to });
  return form;
}

/** The account page's "Free to spend" row, whole: a leading minus is part of what it says. */
async function expectFree(page: Page, account: string, figure: string) {
  await openAccountPage(page, account);
  await expect(page.getByText('Free to spend', { exact: true }).locator('xpath=ancestor::div[@style][1]')).toHaveText(new RegExp(`^Free to spend\\s*${figure}$`));
}

/** One goal's row on an account page: its name, Covered or Short by, and what it promised there. */
const promiseRow = (page: Page, goal: string, rest: string) => page.getByRole('link', { name: new RegExp(`^${goal}.*${rest}`) });

async function expenseBorrowingEf(page: Page, amount: string, over: RegExp, note = 'Laptop') {
  const form = await openExpense(page, 'Jenius');
  await typeAmount(page, form, amount);
  await expect(form.getByText(over)).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await form.getByRole('button', { name: 'No — borrowing from it' }).click();
  await pickCategory(page, form);
  await form.getByLabel('Note').pressSequentially(note);
  await saveForm(form);
}

/**
 * Nothing in `scope` says a promise is short: neither the line under the figure ("Short by Rp 1.800.000") nor the
 * Funded-by row ("set aside · short by …"). The monthly plan's own "Short by" row is a different fact and is left alone.
 */
async function expectNotShort(scope: Locator) {
  await expect(scope.getByText(/^Short by (Rp|US\$)/)).toHaveCount(0);
  await expect(scope.getByText(/set aside · short by/)).toHaveCount(0);
}

export interface Journey {
  title: string;
  run: (page: Page) => Promise<void>;
}

export const JOURNEYS: Journey[] = [
  {
    title: '1 · a borrow edited down in the full form: the question reopens on its answer, and the fund is short by the new overage',
    run: async (page) => {
      await jeniusWithTwoGoals(page);
      await expenseBorrowingEf(page, '6800000', /1\.800\.000 more than is free/);
      const edit = await openEdit(page, 'Laptop');
      await retypeAmount(page, edit, '6000000');
      // 6.000.000 − 5.000.000 free: the question asks about 1.000.000 now, already answered as it was saved.
      await expect(edit.getByText(/Rp.1\.000\.000 more than is free/)).toBeVisible();
      await expect(edit.getByRole('button', { name: 'Take from Emergency fund' })).toContainText('Taking it');
      await expect(edit.getByRole('button', { name: 'No — borrowing from it' })).toContainText('✓');
      await saveForm(edit);

      await page.goto('/goals');
      await expect(goalCard(page, 'Emergency fund').getByText(/^Short by Rp.1\.000\.000$/)).toBeVisible();
      await expectNotShort(goalCard(page, 'Umrah 2027'));
      await expectFree(page, 'Jenius', '-Rp.1\\.000\\.000');
      await expect(promiseRow(page, 'Emergency fund', 'Short by Rp.1\\.000\\.000')).toBeVisible();
    },
  },
  {
    title: '2 · a borrow edited to fit what is free: no question, the fund whole again and the borrow gone',
    run: async (page) => {
      await jeniusWithTwoGoals(page);
      await expenseBorrowingEf(page, '6800000', /1\.800\.000 more than is free/);
      const edit = await openEdit(page, 'Laptop');
      await retypeAmount(page, edit, '4000000');
      await expect(edit.getByText(/more than is free/)).toHaveCount(0);
      await saveForm(edit);

      await page.goto('/goals');
      const ef = goalCard(page, 'Emergency fund');
      await expectNotShort(ef);
      await expect(ef.getByTestId('goal-history').filter({ hasText: 'Borrowed' })).toHaveCount(0);
      // 42.500.000 − 4.000.000 − 37.500.000 promised.
      await expectFree(page, 'Jenius', 'Rp.1\\.000\\.000');
    },
  },
  {
    title: '3 · a transfer to BCA moves the promise with the money, and deleting it puts the promise back',
    run: async (page) => {
      await jeniusWithTwoGoals(page);
      await addMoneyAccount(page, 'BCA', 'savings', '0');
      const form = await openTransfer(page, 'Jenius', 'BCA (IDR)');
      await typeAmount(page, form, '20000000');
      await expect(form.getByText(/15\.000\.000 more than is free/)).toBeVisible();
      await form.getByRole('button', { name: 'Take from Emergency fund' }).click();
      await form.getByRole('button', { name: 'Move the promise to BCA' }).click();
      await form.getByLabel('Note').pressSequentially('To BCA');
      await saveForm(form);

      // 20.000.000 − 5.000.000 free = 15.000.000 of the fund's promise follows the money.
      await expectFree(page, 'Jenius', 'Rp.0');
      await expect(promiseRow(page, 'Emergency fund', 'Covered.*15\\.000\\.000')).toBeVisible();
      await expectFree(page, 'BCA', 'Rp.5\\.000\\.000');
      await expect(promiseRow(page, 'Emergency fund', 'Covered.*15\\.000\\.000')).toBeVisible();
      await page.goto('/goals');
      await expectNotShort(page.locator('body'));

      await deleteFromReceipt(page, 'To BCA');
      await expectFree(page, 'Jenius', 'Rp.5\\.000\\.000');
      await expect(promiseRow(page, 'Emergency fund', 'Covered.*30\\.000\\.000')).toBeVisible();
      await openAccountPage(page, 'BCA');
      await expect(page.getByText('Free to spend', { exact: true })).toHaveCount(0);
    },
  },
  {
    title: '4 · a transfer to a dollar account moves the promise at the transfer\'s own rate, floored',
    run: async (page) => {
      await jeniusWithTwoGoals(page);
      // A dollar balance to open with: its conversion is the rate the app keeps, so the save needs no live rate.
      await addMoneyAccount(page, 'Wise USD', 'bank', '10', 'USD', '16000');
      const form = await openTransfer(page, 'Jenius', 'Wise USD (USD)');
      await typeAmount(page, form, '20000000');
      await form.getByLabel(/^Received amount/).pressSequentially('1234.65');
      await expect(form.getByText(/15\.000\.000 more than is free/)).toBeVisible();
      await form.getByRole('button', { name: 'Take from Emergency fund' }).click();
      await form.getByRole('button', { name: 'Move the promise to Wise USD' }).click();
      await form.getByLabel('Note').pressSequentially('To Wise');
      await saveForm(form);

      // 15.000.000 × 123.465 ÷ 20.000.000 = 92.598,75 cents: US$925,98 — rounding would say US$925,99.
      await openAccountPage(page, 'Wise USD');
      await expect(promiseRow(page, 'Emergency fund', 'Covered.*US\\$.?925,98')).toBeVisible();
      await openAccountPage(page, 'Jenius');
      await expect(promiseRow(page, 'Emergency fund', 'Covered.*15\\.000\\.000')).toBeVisible();
      // The goal names the dollars in dollars, converted or said to have no rate — never added in as rupiah.
      await page.goto('/goals');
      const wise = goalCard(page, 'Emergency fund').getByTestId('goal-link').filter({ hasText: 'Wise USD' });
      await expect(wise).toContainText(/US\$.?925,98/);
      await expect(wise).toContainText(/\(Rp.[\d.]+\)|no IDR rate yet/);
    },
  },
  {
    title: '5 · a tagged transfer for Umrah uses Umrah\'s own money: silent, and the promise follows it to BCA',
    run: async (page) => {
      await jeniusWithTwoGoals(page);
      await addMoneyAccount(page, 'BCA', 'savings', '0');
      const form = await openTransfer(page, 'Jenius', 'BCA (IDR)');
      await typeAmount(page, form, '7500000');
      await form.getByLabel('For goal').selectOption({ label: 'Umrah 2027' });
      await form.getByLabel('Note').pressSequentially('Umrah to BCA');
      await expect(form.getByText(/more than is free/)).toHaveCount(0);
      await saveForm(form);

      await expectFree(page, 'BCA', 'Rp.0');
      await expect(promiseRow(page, 'Umrah 2027', 'Covered.*7\\.500\\.000')).toBeVisible();
      // Jenius: 35.000.000 held, the fund's 30.000.000 promised — still 5.000.000 free, and no Umrah row.
      await expectFree(page, 'Jenius', 'Rp.5\\.000\\.000');
      await expect(promiseRow(page, 'Umrah 2027', '')).toHaveCount(0);
    },
  },
  {
    title: '6 · Umrah\'s tickets answered "Yes": the whole payment comes off the promise, Done, and archiving frees the rest',
    run: async (page) => {
      await jeniusWithTwoGoals(page);
      const form = await openExpense(page, 'Jenius');
      await typeAmount(page, form, '6000000');
      await expect(form.getByText(/1\.000\.000 more than is free/)).toBeVisible();
      await form.getByRole('button', { name: 'Take from Umrah 2027' }).click();
      await form.getByRole('button', { name: 'Yes — this is what I saved for' }).click();
      await pickCategory(page, form);
      await form.getByLabel('Note').pressSequentially('Umrah tickets');
      await saveForm(form);

      await page.goto('/goals');
      const umrah = goalCard(page, 'Umrah 2027');
      // 7.500.000 − 6.000.000. Taking only the part over the free money would leave 6.500.000.
      await expect(umrah.getByTestId('goal-link').filter({ hasText: 'Jenius' })).toContainText(/Rp.1\.500\.000/);
      await expect(umrah.getByText('Done', { exact: true })).toBeVisible();
      await expect(umrah.getByText('Keeps the history, stops it claiming money.')).toBeVisible();
      await expectFree(page, 'Jenius', 'Rp.5\\.000\\.000');

      await page.goto('/goals');
      await goalCard(page, 'Umrah 2027').getByRole('button', { name: 'Archive' }).click();
      await expect(page.getByRole('heading', { name: 'Umrah 2027', exact: true })).toHaveCount(0);
      // Free rises by the 1.500.000 Umrah still promised: 5.000.000 → 6.500.000.
      await expectFree(page, 'Jenius', 'Rp.6\\.500\\.000');
    },
  },
  {
    title: '7 · already short: a second expense asks nothing, and a top-up makes the fund whole with no answer given',
    run: async (page) => {
      await jeniusWithTwoGoals(page);
      await transferOutBorrowingFromUmrah(page);
      const form = await openExpense(page, 'Jenius');
      await typeAmount(page, form, '100000');
      await pickCategory(page, form);
      await expect(form.getByText(/more than is free/)).toHaveCount(0);
      await saveForm(form);
      await expectFree(page, 'Jenius', '-Rp.16\\.600\\.000');

      const topUp = await openTransfer(page, 'BCA', 'Jenius (IDR)');
      await typeAmount(page, topUp, '16600000');
      await topUp.getByLabel('Note').pressSequentially('Top up');
      await expect(topUp.getByText(/more than is free/)).toHaveCount(0);
      await saveForm(topUp);

      await page.goto('/goals');
      await expectNotShort(page.locator('body'));
      // 42.500.000 − 21.500.000 − 100.000 + 16.600.000 = 37.500.000: exactly what is promised.
      await expectFree(page, 'Jenius', 'Rp.0');
      await expect(promiseRow(page, 'Emergency fund', 'Covered')).toBeVisible();
      await expect(promiseRow(page, 'Umrah 2027', 'Covered')).toBeVisible();
    },
  },
  {
    title: '8 · paying two bills that fit alone but not together, borrowed from the fund: short by what went over',
    run: async (page) => {
      await jeniusWithTwoGoals(page);
      await addBill(page, 'Rent', '3000000');
      await addBill(page, 'School', '4000000');
      await page.getByRole('button', { name: 'Select bills to pay' }).click();
      await page.getByRole('checkbox', { name: 'Select Rent' }).click();
      await page.getByRole('checkbox', { name: 'Select School' }).click();
      await page.getByRole('button', { name: /^Pay 2 selected/ }).click();
      const sheet = page.getByRole('dialog', { name: 'Pay several' });
      await expect(sheet.getByText(/2\.000\.000 more than is free/)).toBeVisible();
      await sheet.getByRole('button', { name: 'Take from Emergency fund' }).click();
      await sheet.getByRole('button', { name: 'No — borrowing from it' }).click();
      await sheet.getByRole('button', { name: 'Record 2 bills' }).click();
      await expect(sheet).toHaveCount(0);

      await page.goto('/goals');
      await expect(goalCard(page, 'Emergency fund').getByText(/^Short by Rp.2\.000\.000$/)).toBeVisible();
      await expectFree(page, 'Jenius', '-Rp.2\\.000\\.000');
    },
  },
  {
    title: '9 · the emergency fund spent on an emergency is drawn down but never Done: a standing level (ruling Q3)',
    run: async (page) => {
      await addMoneyAccount(page, 'Jenius', 'savings', '35000000');
      await page.goto('/goals');
      await openGoalForm(page, 'Emergency fund');
      await page.getByLabel('Name', { exact: true }).fill('Emergency fund');
      await page.getByRole('button', { name: 'Add goal' }).last().click();
      await expect(page.getByRole('heading', { name: 'Emergency fund', exact: true })).toBeVisible();
      await setAside(page, 'Emergency fund', 'Jenius (IDR)', '30000000');

      const form = await openExpense(page, 'Jenius');
      await typeAmount(page, form, '6800000');
      await expect(form.getByText(/1\.800\.000 more than is free/)).toBeVisible();
      await form.getByRole('button', { name: 'Take from Emergency fund' }).click();
      await form.getByRole('button', { name: 'Yes — this is what I saved for' }).click();
      await pickCategory(page, form);
      await form.getByLabel('Note').pressSequentially('Hospital');
      await saveForm(form);

      await page.goto('/goals');
      const ef = goalCard(page, 'Emergency fund');
      // 30.000.000 − 6.800.000, drawn down by the whole payment…
      await expect(ef.getByTestId('goal-link').filter({ hasText: 'Jenius' })).toContainText(/Rp.23\.200\.000/);
      // …and open to be rebuilt: not Done, and no archive note.
      await expect(ef.getByText('Done', { exact: true })).toHaveCount(0);
      await expect(ef.getByText('Keeps the history, stops it claiming money.')).toHaveCount(0);
    },
  },
  {
    title: '10 · a dollar account: posted, edited and deleted, every figure in cents on it',
    run: async (page) => {
      await addMoneyAccount(page, 'Wise USD', 'bank', '500.03', 'USD', '16000');
      await addGoal(page, 'Education', '10000000');
      await setAside(page, 'Education', 'Wise USD (USD)', '100.03');
      // US$400,00 free. The keypad has no decimal key, so the phone goes over by a dollar and the desktop by a cent.
      const phone = isPhone(page);
      const form = await openExpense(page, 'Wise USD');
      await typeAmount(page, form, phone ? '401' : '400.01');
      await expect(form.getByText(phone ? /US\$.?1,00 more than is free/ : /US\$.?0,01 more than is free/)).toBeVisible();
      await form.getByRole('button', { name: 'Take from Education' }).click();
      await form.getByRole('button', { name: 'No — borrowing from it' }).click();
      await pickCategory(page, form);
      await form.getByLabel('Note').pressSequentially('Books');
      await saveForm(form);

      await page.goto('/goals');
      await expect(goalCard(page, 'Education').getByText(phone ? /^Short by US\$.?1,00$/ : /^Short by US\$.?0,01$/)).toBeVisible();
      await expectFree(page, 'Wise USD', phone ? '-US\\$.?1,00' : '-US\\$.?0,01');

      const edit = await openEdit(page, 'Books');
      await retypeAmount(page, edit, '390');
      await expect(edit.getByText(/more than is free/)).toHaveCount(0);
      await saveForm(edit);
      await page.goto('/goals');
      await expectNotShort(goalCard(page, 'Education'));
      // 500,03 − 390,00 − 100,03 promised.
      await expectFree(page, 'Wise USD', 'US\\$.?10,00');

      await deleteFromReceipt(page, 'Books');
      await expectFree(page, 'Wise USD', 'US\\$.?400,00');
      await expect(promiseRow(page, 'Education', 'Covered.*US\\$.?100,03')).toBeVisible();
    },
  },
];
