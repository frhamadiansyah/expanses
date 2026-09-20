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
 * Moves money between two of your own accounts through the Transfer tab.
 *
 * The amount goes through `fillAmount`, so a phone types it on the keypad and a desktop in the input — the same
 * bargain `addTransaction` makes. **Received amount does not**: the keypad belongs to the amount row and writes
 * into `draft.amount`, so sending the second figure through `fillAmount` on a phone would either type it onto the
 * closed keypad or fill the amount row again. It is a plain input at every width, and it is filled as one.
 */
export async function addTransfer(
  page: Page,
  tx: { from: string; to: string; amount: string; note?: string; goal?: string; receivedAmount?: string },
) {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: tx.from, exact: true }).click();
  await openAmount(form);
  await fillAmount(page, form, tx.amount);
  await form.getByLabel('To', { exact: true }).selectOption({ label: tx.to });
  await form.getByLabel('Note').fill(tx.note ?? 'Transfer');
  if (tx.goal) await form.getByLabel('For goal').selectOption({ label: tx.goal });
  if (tx.receivedAmount) await form.getByLabel(/^Received amount/).fill(tx.receivedAmount);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

/**
 * Records a purchase or a sale through the Buy or sell tab.
 *
 * `what` is the holding's own name — the picker shows it under "Investments ›" when buying and "Sell ›" when
 * selling, and the helper builds that label rather than asking every caller to remember the prefix. None of these
 * figures goes near the keypad: the trade rows are plain inputs at every width, because the amount row and its dock
 * belong to `draft.amount`, and a trade's cost lives in `draft.purchase`.
 */
export async function addPurchase(
  page: Page,
  trade: {
    what: string;
    mode?: 'buy' | 'sell';
    amount: string;
    units?: string;
    lots?: string;
    fee?: string;
    paidWith: string;
    date?: string;
    goal?: string;
    pointsCategory?: string;
    mcc?: string;
  },
) {
  const sell = trade.mode === 'sell';
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Buy or sell' }).click();
  await form.getByLabel('What you bought or sold').selectOption({ label: `${sell ? 'Sell' : 'Investments'} › ${trade.what}` });
  await form.getByLabel(sell ? /^Proceeds, before fees/ : /^What it cost, before fees/).fill(trade.amount);
  if (trade.lots) await form.getByLabel('Lots').fill(trade.lots);
  // Whatever this holding calls its units — Grams for gold, Shares for a stock without lots.
  if (trade.units) await form.getByLabel(/^(Units|Shares|Grams)$/).fill(trade.units);
  if (trade.fee) await form.getByLabel(/^Fee /).fill(trade.fee);
  await form.getByLabel(sell ? 'Proceeds into' : 'Paid with').selectOption({ label: trade.paidWith });
  if (trade.date) await form.getByLabel('Date').fill(trade.date);
  if (trade.goal) await form.getByLabel(sell ? 'Sell from goal' : 'For goal').selectOption({ label: trade.goal });
  // Offered only on a credit card, and only when buying — the card's two facts, not the trade's.
  if (trade.pointsCategory) await form.getByLabel('Category for points').selectOption({ label: trade.pointsCategory });
  if (trade.mcc) await form.getByLabel('MCC').fill(trade.mcc);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

/**
 * Puts other people on a bill, through With under Add more details.
 *
 * `owes` on any of them means Custom amounts and each figure is typed; none of them means Split equally and the
 * sheet works the shares out. Both sheets are left open, because what a caller usually wants next is to read the
 * summary card before closing them.
 *
 * The helper is the only place that knows what With looks like, so the edit sheet Task 14 builds on the very same
 * component never has to touch a spec.
 */
export async function shareWith(page: Page, form: Locator, people: readonly { name: string; owes?: string }[]) {
  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  await more.getByRole('button', { name: 'With', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'With', exact: true });
  for (const person of people) {
    await sheet.getByLabel('Add a person').fill(person.name);
    await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  }
  if (people.some((person) => person.owes !== undefined)) {
    await sheet.getByRole('radio', { name: 'Custom amounts' }).click();
    for (const person of people) {
      if (person.owes !== undefined) await sheet.getByLabel(`What ${person.name} owe`).fill(person.owes);
    }
  } else {
    await sheet.getByRole('radio', { name: 'Split equally' }).click();
  }
  return { more, sheet };
}

/**
 * Both sheets shut again, innermost first, so the card underneath can be saved.
 *
 * The order is not a preference. A sheet is drawn inside the sheet that opened it, so while the inner one is up
 * there are two buttons called Close under `more` and neither can be picked out by name.
 */
export async function closeDetails(more: Locator, sheet: Locator) {
  await sheet.getByRole('button', { name: 'Close' }).click();
  await more.getByRole('button', { name: 'Close' }).click();
}

/**
 * Attaches one picture through Photos under Add more details, as a file chosen from the library.
 *
 * The bytes are the assertion's whole point elsewhere, so they are the caller's: a spec hands in what it will
 * later read back out of the blob URL on the receipt.
 */
export async function attachPhoto(page: Page, form: Locator, file: { name: string; mimeType: string; buffer: Buffer }) {
  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = page.getByRole('dialog', { name: 'More details' });
  await more.getByRole('button', { name: 'Photos' }).click();
  const sheet = page.getByRole('dialog', { name: 'Photos' });
  await sheet.getByTestId('photo-library-input').setInputFiles(file);
  await expect(sheet.getByRole('button', { name: 'Photo 1', exact: true })).toBeVisible();
  return { more, sheet };
}

/**
 * Puts the cursor in the amount, whichever thing this viewport gave us.
 *
 * On a phone the figure is a **button** that opens the keypad dock; on a desktop it is a real `<input>`, and
 * there is no button of that name to press at all. Asking for the button unconditionally — as this plan's first
 * draft did — fails every chromium spec at the first field.
 */
async function openAmount(form: Locator) {
  // The card first, whichever shape it takes here: `getByLabel` answers the phone's button and the desktop's
  // input alike. Asking "is there a button?" before the card is drawn answers **no** for the phone too, and the
  // helper then walks past the dock and types into a button — which is how a green spec came to type nothing.
  await form.getByLabel('Amount', { exact: true }).waitFor();
  const button = form.getByRole('button', { name: 'Amount', exact: true });
  if ((await button.count()) === 0) return;
  await button.click();
  // The dock is drawn a tick after the press, and `fillAmount` below asks for it with a non-retrying
  // `isVisible()`. Waiting for it here is the difference between typing on the keypad and typing into nothing:
  // a person presses the figure, waits for the dock to come up, and only then types.
  await form.page().getByTestId('keypad').waitFor({ state: 'visible' });
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
