import { expect, type Locator, type Page } from '@playwright/test';
import { openAmount } from './add-transaction';

/**
 * A goal's card on /goals. Never `locator('section', { hasText })`: the "Start from a template" group is a section
 * drawn first, and its rows include the template "Emergency fund", so `.first()` lands there (no Edit button).
 */
export const goalCard = (page: Page, name: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();

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
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('What kind of goal').selectOption('holiday');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel(/Cost in today's money/).first().pressSequentially(amount);
  await page.getByLabel('Needed by').first().fill(dueOn);
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

export async function setAside(page: Page, goal: string, box: string, amount: string) {
  await page.goto('/goals');
  await goalCard(page, goal).getByRole('button', { name: 'Edit' }).click();
  const input = page.getByLabel(box);
  await input.clear();
  await input.pressSequentially(amount);
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Saved, not merely pressed: the form closes once the save lands. Navigating away before that loses it.
  await expect(page.getByRole('button', { name: 'Save goal' })).toHaveCount(0);
  await expect(goalCard(page, goal).getByTestId('goal-link').filter({ hasText: box.replace(/ \(.*\)$/, '') }).first()).toBeVisible();
}

/** The record's account: Jenius Rp 42.500.000, Emergency fund Rp 30.000.000 (first), Umrah Rp 7.500.000 — Rp 5.000.000 free. */
export async function jeniusWithTwoGoals(page: Page) {
  await addMoneyAccount(page, 'Jenius', 'savings', '42500000');
  await addGoal(page, 'Emergency fund', '30000000');
  await addGoal(page, 'Umrah 2027', '7500000');
  await setAside(page, 'Emergency fund', 'Jenius (IDR)', '30000000');
  await setAside(page, 'Umrah 2027', 'Jenius (IDR)', '7500000');
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
