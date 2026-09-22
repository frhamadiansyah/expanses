import { expect, type Locator, type Page } from '@playwright/test';
import { openAmount } from './add-transaction';
import { openGoalForm } from './goals';

/**
 * A goal's row on /goals, where each goal is one line of the list. The goal itself — its figure, stages, what
 * funds it, Edit — is on its own page, which `goalCard` opens.
 */
export const goalRow = (page: Page, name: string) => page.getByTestId('goal-row').filter({ hasText: name }).first();

/**
 * The goal's own page, opened from its row on the list: everything that used to be a card on /goals is read
 * there now. Returns the page's own root, so a caller scopes its reads the way it used to scope them to a card.
 *
 * A caller fresh from the goal form is already on the list, and is not sent back to it: a reload while the save
 * is still being written would throw the goal away. The row is waited for where the page already stands.
 */
export async function goalCard(page: Page, name: string) {
  if (!/\/goals$/.test(page.url())) await page.goto('/goals');
  await goalRow(page, name).click();
  await expect(page).toHaveURL(/\/goals\/[^/]+$/);
  // Scoped by the goal's own name in the title: a locator kept while another goal is opened must not quietly
  // read that goal's page instead.
  return page.getByTestId('goal-page').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

/**
 * Types an amount one keystroke at a time: the keypad digit by digit on a phone, the input key by key on a desktop.
 * The amount row is opened first with `openAmount` from `./add-transaction` (export it there — today it is a private
 * helper): on a phone the figure is a button that opens the keypad, and without pressing it `keypad.isVisible()` is
 * false and `pressSequentially` types into a button. Do not call `fillAmount` — it uses `fill()` on a desktop.
 */
export async function typeAmount(page: Page, form: Locator, amount: string) {
  await openAmount(form);
  const keypad = page.getByTestId('keypad');
  if (await keypad.isVisible()) {
    for (const digit of amount) await keypad.getByRole('button', { name: digit, exact: true }).click();
    await keypad.getByRole('button', { name: 'DONE' }).click();
    return;
  }
  const input = form.getByLabel('Amount', { exact: true });
  await input.click();
  await input.pressSequentially(amount);
  await input.press('Tab');
}

export async function addMoneyAccount(page: Page, name: string, subtype: string, balance: string, currency = 'IDR', rate?: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).pressSequentially(name);
  await page.getByLabel('Type').selectOption(subtype);
  if (currency !== 'IDR') await page.getByLabel('Currency').selectOption(currency);
  await page.getByLabel('Current balance').pressSequentially(balance);
  if (rate) await page.getByLabel(/^Rate:/).pressSequentially(rate);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

export async function addGoal(page: Page, name: string, amount: string, dueOn = '2027-12-31') {
  await page.goto('/goals');
  await openGoalForm(page, 'Holiday');
  await page.getByLabel('What kind of goal').selectOption('holiday');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/Cost in today's money/).first().pressSequentially(amount);
  await page.getByLabel('Needed by').first().fill(dueOn);
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(goalRow(page, name)).toBeVisible();
}

export async function setAside(page: Page, goal: string, box: string, amount: string) {
  const card = await goalCard(page, goal);
  await card.getByRole('button', { name: 'Edit' }).click();
  const input = page.getByLabel(box);
  await input.clear();
  await input.pressSequentially(amount);
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Saved, not merely pressed: the form closes once the save lands. Navigating away before that loses it.
  await expect(page.getByRole('button', { name: 'Save goal' })).toHaveCount(0);
  await expect(card.getByTestId('goal-link').filter({ hasText: box.replace(/ \(.*\)$/, '') }).first()).toBeVisible();
}

/** The record's account: Jenius Rp 42.500.000, Emergency fund Rp 30.000.000 (first), Umrah Rp 7.500.000 — Rp 5.000.000 free. */
export async function jeniusWithTwoGoals(page: Page) {
  await addMoneyAccount(page, 'Jenius', 'savings', '42500000');
  await addGoal(page, 'Emergency fund', '30000000');
  await addGoal(page, 'Umrah 2027', '7500000');
  await setAside(page, 'Emergency fund', 'Jenius (IDR)', '30000000');
  await setAside(page, 'Umrah 2027', 'Jenius (IDR)', '7500000');
}

/** A fixed monthly bill paid from Jenius, out on the 1st. */
export async function addBill(page: Page, name: string, amount: string) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).pressSequentially(name);
  await page.getByLabel('Amount', { exact: true }).pressSequentially(amount);
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'Jenius' });
  await page.getByLabel('Bill is out on').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByTestId('bill-row').filter({ hasText: name })).toBeVisible();
}

export async function openExpense(page: Page, paidWith: string) {
  // The add button lives on the transactions page; the setup helpers leave the browser on /goals.
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: paidWith, exact: true }).click();
  return form;
}

export async function openAccountPage(page: Page, name: string) {
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).first().click();
}

/**
 * Jenius goes short: Rp 21.500.000 moved out to a new, empty BCA, answered as borrowing from Umrah. 16.500.000 of it
 * was more than was free; Umrah can carry no more than its 7.500.000, so the other 9.000.000 falls on the Emergency fund.
 */
export async function transferOutBorrowingFromUmrah(page: Page) {
  await addMoneyAccount(page, 'BCA', 'savings', '0');
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'Jenius', exact: true }).click();
  await form.getByLabel('To', { exact: true }).selectOption({ label: 'BCA (IDR)' });
  await typeAmount(page, form, '21500000');
  await expect(form.getByText(/16\.500\.000 more than is free/)).toBeVisible();
  await form.getByRole('button', { name: 'Take from Umrah 2027' }).click();
  await form.getByRole('button', { name: 'No — borrowing from it' }).click();
  await form.getByLabel('Note').pressSequentially('To BCA');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);
}

/**
 * The text on the page whose nearest painted surface is a literal white — what a light-only colour leaves behind in
 * the dark. Reads what the browser painted, so a token that resolves dark passes and a hard-coded white does not.
 */
export async function textOnWhite(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    // A filled control (the kit's primary button inverts in the dark, a light fill with dark ink) is its own ground,
    // chosen on purpose; what this looks for is a surface — a panel, a group, a bar — left light.
    const ground = (start: Element | null): string => {
      for (let node = start; node; node = node.parentElement) {
        const colour = getComputedStyle(node).backgroundColor;
        if (colour !== 'rgba(0, 0, 0, 0)' && colour !== 'transparent') return node.closest('button,a,[role=button]') === node ? 'control' : colour;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      const words = text.textContent?.trim();
      const parent = text.parentElement;
      if (!words || !parent || parent.closest('script,style')) continue;
      const box = parent.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (ground(parent) === 'rgb(255, 255, 255)') found.push(words);
    }
    return found;
  });
}
