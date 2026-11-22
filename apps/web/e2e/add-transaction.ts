import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The add form, wherever it is drawn: a sheet over the page on a wide screen, a screen of its own on a phone.
 * Both carry the same name, so a journey written once runs at either width.
 */
/**
 * Save, wherever the form keeps it: the dock at the foot of a sheet on a wide screen, the ✓ in the bar on a phone's
 * add screen. Only one of them is ever drawn, so the pair still names one button.
 */
export const saveButton = (form: Locator): Locator =>
  form.getByRole('button', { name: 'Save', exact: true }).or(form.page().locator('header').getByRole('button', { name: 'Save', exact: true }));

/**
 * A transfer's To, chosen as a person does: the row, then the account in its list. Takes the name as the old select
 * labelled it too — "Jago (IDR)" — so a journey written against the select reads the same.
 */
export async function chooseTo(form: Locator, account: string) {
  await form.getByRole('button', { name: /^To/ }).click();
  const dialog = form.page().getByRole('dialog', { name: 'To', exact: true });
  const name = account.replace(/ \([A-Z]{3}\)$/, '');
  await expect(dialog.getByTestId('payment-sections')).toBeVisible();
  await openPocketOf(dialog, name);
  await dialog.getByRole('button', { name, exact: true }).click();
}

/**
 * A pocket — "Bank One Valas Plus · USD" — sits folded under its account when the account holds several currencies
 * (account tree, 12 Nov): when its row is not drawn, its account's row ("Bank One Valas Plus") is opened first, as a
 * person would. A row already drawn, or a name that is no pocket's, is left alone.
 */
export async function openPocketOf(dialog: Locator, name: string) {
  if (await dialog.getByRole('button', { name, exact: true }).isVisible()) return;
  const at = name.lastIndexOf(' · ');
  if (at < 0) return;
  const parent = dialog.getByRole('button', { name: name.slice(0, at), exact: true, expanded: false });
  if ((await parent.count()) > 0) await parent.click();
}

/** A transfer's or a trade's Goal: its own box under the form, a row, then the goal in its sheet. */
export async function chooseGoal(form: Locator, goal: string) {
  // A sell takes its units From goal; everything else names its Goal.
  await form.getByRole('button', { name: /^(Goal|From goal)$/ }).click();
  await form.page().getByRole('dialog', { name: /^(Goal|From goal)$/ }).getByRole('button', { name: goal, exact: true }).click();
}

/**
 * A trade's money figure — its amount, or Charged in — typed as the Expense form's amount is: a text field on a
 * desktop, the keypad's dock on a phone, where the figure is a button that opens it. `amount` is digits on a phone.
 */
export async function fillFigure(form: Locator, label: string | RegExp, amount: string) {
  const field = form.getByLabel(label, typeof label === 'string' ? { exact: true } : undefined).first();
  await field.waitFor();
  if ((await field.evaluate((node) => node.tagName)) === 'INPUT') return field.fill(amount);
  if (!/^\d+$/.test(amount)) throw new Error(`The keypad types digits: ${amount} has to be typed on a desktop`);
  await field.click();
  const keypad = form.page().getByTestId('keypad');
  await keypad.waitFor({ state: 'visible' });
  for (const digit of amount) await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(keypad).toHaveCount(0);
}

/** Opens a trade's Add more details, when it is not open already: Goal, the card's points rows and Fee are there. */
export async function openTradeMore(form: Locator) {
  const more = form.getByRole('button', { name: 'Add more details' });
  if ((await more.count()) > 0 && (await more.getAttribute('aria-expanded')) !== 'true') await more.click();
}

/** A card buy's Category for points: the row, then the category in the Select category sheet Expense opens. */
export async function choosePointsCategory(form: Locator, category: string) {
  await form.getByRole('button', { name: 'Category for points' }).click();
  const sheet = form.page().getByRole('dialog', { name: 'Select category' });
  await sheet.getByRole('button', { name: category, exact: true }).first().click();
  await expect(sheet).toHaveCount(0);
}

/**
 * Picks what paid — or received — in its sheet. Paid with keeps accounts and credit cards on two tabs and opens on
 * Accounts until a card is chosen, so a card not on the open tab is found by switching to Credit cards, as a person
 * would. Received into and From have no tabs and never need the switch.
 */
export async function choosePayment(page: Page, name: string, sheet: string | RegExp = /^(Payment method|Received into|From)$/) {
  const dialog = page.getByRole('dialog', { name: sheet });
  const option = dialog.getByRole('button', { name, exact: true });
  const cardsTab = dialog.getByRole('radio', { name: 'Credit cards' });
  await expect(dialog.getByTestId('payment-sections')).toBeVisible();
  await openPocketOf(dialog, name);
  if (!(await option.isVisible()) && (await cardsTab.count()) > 0) await cardsTab.click();
  await option.click();
}

/**
 * A trade's Paid with (Buy) or Received into (Sell): the same account sheet a purchase's Paid with opens. `name` is
 * the account's name; a "(IDR)" left on it from the old picker's labels is dropped.
 */
export async function chooseTradeMoney(form: Locator, name: string, sell = false) {
  const label = sell ? 'Received into' : 'Payment method';
  await form.getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
  await choosePayment(form.page(), name.replace(/ \([A-Z]{3}\)$/, ''), label);
}

/**
 * A trade's Investment: the row opens its own sheet, drawn as Paid with is — the holdings under their kind, searchable.
 * `name` is the holding's own name, as the sheet lists it; `index` instead takes the tab's n-th holding.
 */
export async function chooseInvestment(form: Locator, pick: string | { index: number }) {
  await form.getByRole('button', { name: /^Investment/ }).click();
  const sheet = form.page().getByRole('dialog', { name: 'Investment' });
  const rows = sheet.getByTestId('investment-sections').locator('section button');
  await (typeof pick === 'string' ? sheet.getByRole('button', { name: pick, exact: true }) : rows.nth(pick.index)).click();
  await expect(sheet).toHaveCount(0);
}

/**
 * Trade, as a person opens it now: Net worth's corner, onto the Add screen's trade rows under their Buy and Sell tabs.
 * The Add form's tabs no longer offer it. `kind` taps the Sell tab when selling.
 */
export async function openBuyOrSell(page: Page, kind: 'buy' | 'sell' = 'buy'): Promise<Locator> {
  await page.goto('/net-worth');
  await page.getByRole('link', { name: 'Trade', exact: true }).first().click();
  const form = page.getByRole('form', { name: 'Trade' });
  // Neither tab is chosen on opening; every row is there already.
  await form.getByRole('radio', { name: kind === 'sell' ? 'Sell' : 'Buy' }).click();
  await expect(form.getByLabel('Investment')).toBeVisible();
  // The holding is chosen by hand too; a spec that names none takes the first one the tab offers.
  await chooseInvestment(form, { index: 0 });
  return form;
}

export const addForm = (page: Page): Locator =>
  page.getByRole('dialog', { name: 'Add a transaction' }).or(page.getByRole('form', { name: 'Add a transaction' }));

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
  tx: {
    mode?: 'Expense' | 'Income';
    description: string;
    paidWith: string;
    category: string;
    amount: string;
    date?: string;
    /** Type the desktop's amount a key at a time, as a person does, instead of filling it in one go. */
    keyByKey?: boolean;
    /**
     * A card purchase's Already paid off, set after the date: an old purchase starts out paid off by itself (owner, 22 Nov
     * 2026), so a spec that means one still owed on a card added today says so. Left out, the form's own default stands.
     */
    paidOff?: boolean;
  },
) {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  if (tx.mode && tx.mode !== 'Expense') await form.getByRole('radio', { name: tx.mode }).click();
  await openAmount(form);
  await fillAmount(page, form, tx.amount, tx.keyByKey);
  await form.getByRole('button', { name: /^(Payment method|Received into)/ }).click();
  await choosePayment(page, tx.paidWith);
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: tx.category, exact: true }).click();
  await form.getByLabel('Note').fill(tx.description);
  if (tx.date) await form.getByLabel('Date').fill(tx.date);
  if (tx.paidOff !== undefined) await setPaidOff(form, tx.paidOff);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

/** Sets a card purchase's Already paid off (the card icon on Payment method) to `on`, whatever the date made it. */
export async function setPaidOff(form: Locator, on: boolean) {
  const button = form.getByRole('button', { name: 'Already paid off' });
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-pressed')) !== String(on)) await button.click();
  await expect(button).toHaveAttribute('aria-pressed', String(on));
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
  tx: { from: string; to: string; amount: string; note?: string; goal?: string; receivedAmount?: string; fee?: string },
) {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  // Through the sheet's own tabs: a card is on Credit cards, the rest on Accounts.
  await choosePayment(page, tx.from, 'From');
  await openAmount(form);
  await fillAmount(page, form, tx.amount);
  await chooseTo(form, tx.to);
  await form.getByLabel('Note').fill(tx.note ?? 'Transfer');
  if (tx.goal) await chooseGoal(form, tx.goal);
  if (tx.receivedAmount) await form.getByLabel(/^Received amount/).fill(tx.receivedAmount);
  // The fee is its own row under the Amount, beside its category, on a transfer within one currency.
  if (tx.fee) await form.getByLabel(/^Fee in /).fill(tx.fee);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

/** The history's one ⋯ square (owner 2026-11-15): Select, Sort, Paid with and Reset are all in its menu. */
export function historyMenu(page: Page): Locator {
  return page.getByRole('button', { name: 'More', exact: true });
}

/** Select mode starts from the ⋯ menu; the dark square that takes ⋯'s place while ticking stops it. */
export async function startSelecting(page: Page) {
  await historyMenu(page).click();
  await page.getByTestId('sort-filter-menu').getByRole('menuitem', { name: 'Select', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Selected transactions' })).toBeVisible();
}

/**
 * Records a purchase or a sale through Trade's Buy or Sell tab.
 *
 * `what` is the holding's own name, as the picker lists it under the Buy or Sell tab: nothing is prefixed. The amount
 * and Charged in are Expense's amount row (`fillFigure`): a phone types them on the keypad.
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
    /** What the paying account was charged in its own currency, when it is not the holding's. */
    charged?: string;
  },
) {
  const sell = trade.mode === 'sell';
  const form = await openBuyOrSell(page, trade.mode);
  await chooseInvestment(form, trade.what);
  // Expense's order: Paid with (Received into), the amount, the holding, its units, the date.
  await chooseTradeMoney(form, trade.paidWith, sell);
  await fillFigure(form, sell ? /^Proceeds, before fees/ : /^What it cost, before fees/, trade.amount);
  if (trade.charged) await fillFigure(form, /^Charged in /, trade.charged);
  if (trade.lots) await form.getByLabel('Lots').fill(trade.lots);
  // Whatever this holding calls its units — Grams for gold, Shares for a stock without lots.
  if (trade.units) await form.getByLabel(/^(Units|Shares|Grams|Par value)$/).fill(trade.units);
  if (trade.date) await form.getByLabel('Date').fill(trade.date);
  // Goal, the card's two facts and the Fee wait under Add more details.
  if (trade.goal || trade.pointsCategory || trade.mcc || trade.fee) await openTradeMore(form);
  if (trade.goal) await chooseGoal(form, trade.goal);
  // Offered only on a credit card, and only when buying — the card's two facts, not the trade's.
  if (trade.pointsCategory) await choosePointsCategory(form, trade.pointsCategory);
  if (trade.mcc) await form.getByLabel('MCC').fill(trade.mcc);
  if (trade.fee) await form.getByLabel(/^Fee /).fill(trade.fee);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  // Saved, Trade goes back to Net worth; callers read on from Cashflow, where the Add form used to leave them.
  await page.goto('/transactions');
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
  const more = page.getByRole('region', { name: 'More details' });
  await more.getByRole('button', { name: 'With', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'With', exact: true });
  for (const person of people) {
    const search = sheet.getByLabel('Search or add a person');
    await search.fill(person.name);
    // One already on the books is its own circle in the row; a name nobody has met is added by the keyboard's Done.
    const known = sheet.getByRole('button', { name: person.name, exact: true });
    if (await known.count()) await known.click();
    else await search.press('Enter');
    await expect(sheet.getByRole('button', { name: person.name, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await search.fill('');
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
 * The sheet a detail row opened, shut again so the card underneath can be saved. The details themselves stay open
 * under the card: they are part of the form now rather than a sheet over it, so there is nothing else to close.
 */
export async function closeDetails(more: Locator, sheet: Locator) {
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
}

/**
 * Attaches one picture through Photos under Add more details, as a file chosen from the library.
 *
 * The bytes are the assertion's whole point elsewhere, so they are the caller's: a spec hands in what it will
 * later read back out of the blob URL on the receipt.
 */
export async function attachPhoto(page: Page, form: Locator, file: { name: string; mimeType: string; buffer: Buffer }) {
  // Already open when a transfer's For goal was chosen there.
  const open = form.getByRole('button', { name: 'Add more details' });
  if ((await open.count()) > 0) await open.click();
  const more = page.getByRole('region', { name: 'More details' });
  // Photos are the Amount row's camera now (Buy / sell keeps its row under Add more details).
  const camera = form.getByTestId('amount-photos');
  // With no picture yet the glyph goes straight to the system picker (one tap); the file lands on its input, and the
  // glyph then opens the Photos sheet, where the picture is seen and removed.
  if ((await camera.count()) > 0 && (await camera.getAttribute('aria-label')) === 'Photos') {
    await page.getByTestId('amount-photo-input').setInputFiles(file);
    await expect(camera).toHaveAttribute('aria-label', 'Photos, 1');
    await camera.click();
    const opened = page.getByRole('dialog', { name: 'Photos' });
    await expect(opened.getByRole('button', { name: 'Photo 1', exact: true })).toBeVisible();
    return { more, sheet: opened };
  }
  await ((await camera.count()) > 0 ? camera : more.getByRole('button', { name: 'Photos' })).click();
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
export async function openAmount(form: Locator) {
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
export async function fillAmount(page: Page, form: Locator, amount: string, keyByKey = false) {
  const keypad = page.getByTestId('keypad');
  if (await keypad.isVisible()) {
    if (!/^\d+$/.test(amount)) throw new Error(`The keypad types digits: ${amount} has to be typed on a desktop`);
    for (const digit of amount) await keypad.getByRole('button', { name: digit, exact: true }).click();
    await keypad.getByRole('button', { name: 'DONE' }).click();
    return;
  }
  const input = form.getByLabel('Amount', { exact: true });
  if (!keyByKey) return input.fill(amount);
  await input.click();
  await input.pressSequentially(amount, { delay: 30 });
}
