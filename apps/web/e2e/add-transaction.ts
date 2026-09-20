import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Records an expense or income through the Option B card, from wherever the + is.
 *
 * The amount is typed two different ways because the card offers two: a phone gets a keypad in the dock and no
 * text input at all (§3.4), a desktop gets a text input that evaluates on blur and Enter. Asking for the input
 * unconditionally is how this helper would break every phone spec that uses it.
 *
 * The helper is the only place that knows what the card looks like, so the next tab never touches a spec again.
 */
export async function addTransaction(
  page: Page,
  tx: { mode?: 'Expense' | 'Income'; description: string; paidWith: string; category: string; amount: string; date?: string },
) {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  if (tx.mode && tx.mode !== 'Expense') await form.getByRole('radio', { name: tx.mode }).click();
  await openAmount(form);
  await fillAmount(page, form, tx.amount);
  await form.getByRole('button', { name: /^(Paid with|Received into)/ }).click();
  await page.getByRole('dialog', { name: /^(Paid with|Received into)$/ }).getByRole('button', { name: tx.paidWith, exact: true }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: tx.category, exact: true }).click();
  await form.getByLabel('Note').fill(tx.description);
  if (tx.date) await form.getByLabel('Date').fill(tx.date);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

/**
 * Puts the cursor in the amount, whichever thing this viewport gave us.
 *
 * On a phone the figure is a **button** that opens the keypad dock; on a desktop it is a real `<input>`, and
 * there is no button of that name to press at all. Asking for the button unconditionally — as this plan's first
 * draft did — fails every chromium spec at the first field.
 */
async function openAmount(form: Locator) {
  const button = form.getByRole('button', { name: 'Amount', exact: true });
  if ((await button.count()) > 0) await button.click();
}

/** The amount row is open. Type into whichever thing this viewport gave us. */
export async function fillAmount(page: Page, form: Locator, amount: string) {
  const keypad = page.getByTestId('keypad');
  if (await keypad.isVisible()) {
    if (!/^\d+$/.test(amount)) throw new Error(`The keypad types digits: ${amount} has to be typed on a desktop`);
    for (const digit of amount) await keypad.getByRole('button', { name: digit, exact: true }).click();
    await keypad.getByRole('button', { name: 'DONE' }).click();
    return;
  }
  await form.getByLabel('Amount', { exact: true }).fill(amount);
}
