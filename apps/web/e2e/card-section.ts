import { expect, type Locator, type Page } from '@playwright/test';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';

/**
 * A card on the wallet, by name. The Cards page also lists the points programmes, and a programme's row carries the
 * name of the card earning into it, so a card is looked for on the wallet itself.
 */
export const walletCard = (page: Page, name: string | RegExp) => page.getByRole('region', { name: 'Cards' }).getByRole('link', { name });

/**
 * The card's back holds Outstanding (or Credit), the limit and the nearest bonus or the points: a tap on the raised card turns it
 * over. Turns it when it is not turned already, so a journey that reads the back can call this wherever it is.
 */
export async function showCardBack(page: Page) {
  const turn = page.getByRole('button', { name: /, show balance$/ });
  const back = page.getByRole('button', { name: /, show card$/ });
  // The page says it has a back a moment after it mounts: wait for either side's button.
  await expect(turn.or(back)).toBeVisible();
  if ((await turn.count()) > 0) await turn.click();
  await expect(page.getByTestId('tile-points')).toBeVisible();
}

/**
 * Open one of the card's own pages from its summary. The four tabs it had are pages now: the statement (the round
 * Statement button), this statement's points (the round Points, Miles or Cashback button), and the settings (⚙ in the corner), which hold
 * what the Card and Rewards rules tabs did.
 */
export async function cardPage(page: Page, which: 'Statement' | 'Points' | 'Settings') {
  const main = page.getByRole('main');
  if (which === 'Statement') await main.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Statement', exact: true }).click();
  else if (which === 'Points') await main.getByRole('group', { name: 'Actions' }).getByRole('link', { name: /^(Points|Miles|Cashback)$/ }).click();
  else await main.getByRole('link', { name: 'Settings', exact: true }).first().click();
  const title = { Statement: 'Statement', Points: "This statement's points", Settings: 'Settings' }[which];
  await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
}

/**
 * Open a page under the card's Settings: Card product, Earning rules, Spend bonuses. A card on the catalogue shows no
 * rules or bonuses rows (it follows the catalogue), so for those the editor is reached by its address, which still
 * stands, to exercise the editors on catalogue rows.
 */
export async function cardSettingsPage(page: Page, which: 'Card product' | 'Earning rules' | 'Spend bonuses') {
  const row = page.getByRole('main').getByRole('button', { name: new RegExp(`^${which}`) });
  if (which !== 'Card product' && (await row.count()) === 0) {
    const here = new URL(page.url()).pathname.replace(/\/$/, '');
    await page.goto(`${here}/${which === 'Earning rules' ? 'rules' : 'bonuses'}`);
  } else {
    await row.click();
  }
  await expect(page.getByRole('heading', { name: which, exact: true }).first()).toBeVisible();
}

/** The card's purchases with what each earned: this statement's points, then Purchases. */
export async function cardPurchases(page: Page) {
  await cardPage(page, 'Points');
  await cardPointsPage(page, 'Purchases');
}

/**
 * Save the card's terms from its Settings page: Enter in a terms field (Due date unless given) is the form's own
 * save, and the page stays; the short wait lets the write settle before the spec moves on.
 */
export async function saveCardTerms(page: Page, field = 'Due date') {
  await page.getByLabel(field, { exact: true }).press('Enter');
  await page.waitForTimeout(500);
}

/**
 * From the card's Settings: choose the card from the catalogue. Card product → search → the card → its preview →
 * Use this card, which lands back on Settings with the product filled. `level` picks a member level when the card has them.
 */
export async function chooseCatalogueCard(page: Page, search: string, entryName: string, level?: string) {
  await page.getByRole('main').getByRole('button', { name: /^Card product/ }).click();
  await expect(page.getByRole('heading', { name: 'Card product', exact: true }).first()).toBeVisible();
  await page.getByLabel('Search card or bank').fill(search);
  await page.getByRole('main').getByRole('button', { name: new RegExp(`^${entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`) }).first().click();
  if (level) await page.getByLabel('Level').selectOption({ label: level });
  await page.getByRole('button', { name: 'Use this card' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).first()).toBeVisible();
}

/**
 * From the card's Settings: set its rewards up by hand — Card product → My card is not listed → Save — and open its
 * Earning rules page, where the rule forms are. `unit` and `name` fill the by-hand form first.
 */
export async function setUpRewardsByHand(page: Page, opts: { unit?: 'Points' | 'Miles' | 'Cashback'; name?: string; openRules?: boolean } = {}) {
  await page.getByRole('main').getByRole('button', { name: /^Card product/ }).click();
  await page.getByRole('button', { name: 'My card is not listed' }).click();
  await expect(page.getByRole('heading', { name: 'Set up by hand', exact: true }).first()).toBeVisible();
  if (opts.name) await page.getByLabel('Program name').fill(opts.name);
  if (opts.unit) await page.getByLabel('Earns').selectOption({ label: opts.unit });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  if (opts.openRules === false) return;
  await page.getByRole('main').getByRole('button', { name: /^Earning rules/ }).click();
  await expect(page.getByRole('heading', { name: 'Earning rules', exact: true }).first()).toBeVisible();
}

/** Open a page under this statement's points — the purchases, or the points the statement shows. */
export async function cardPointsPage(page: Page, which: 'Purchases' | 'Points the statement shows') {
  await page.getByRole('main').getByRole('link', { name: new RegExp(`^${which}`) }).click();
  await expect(page.getByRole('heading', { name: which === 'Purchases' ? 'Purchases' : 'Points on the statement', exact: true }).first()).toBeVisible();
}

/**
 * Start the card's first instalment plan, the only way in while it has none: Settings, the Instalments row, then ＋.
 * The New instalment plan sheet is left open for the caller to fill.
 */
export async function startPlan(page: Page) {
  await cardPage(page, 'Settings');
  await page.getByRole('main').getByRole('link', { name: /^Instalments/ }).click();
  await expect(page.getByRole('heading', { name: 'Instalments', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Add a plan' }).click();
}

/** Back from the Instalments page and the settings to the card's own page, where the plans box now shows. */
export async function backToCardFromPlans(page: Page) {
  await page.goBack();
  await page.goBack();
  await expect(page.getByTestId('card-instalments')).toBeVisible();
}

/** Picks "Charged on" (a day and a month, no year) from an ISO date, or clears it with ''. */
export async function pickChargedOn(page: Page, isoDate: string) {
  const day = page.getByLabel('Charged on day');
  const month = page.getByLabel('Charged on month');
  await day.selectOption(isoDate ? String(Number(isoDate.slice(8, 10))) : '0');
  if (isoDate) await month.selectOption(String(Number(isoDate.slice(5, 7))));
}

/**
 * The card's round Pay (owner, 17 Nov 2026): the Add screen in its Transfer layout, locked to paying the card — titled
 * "Pay credit card", no tabs, To fixed on the card, the bill filled in, From left to be chosen. Returns the form.
 */
export async function openCardPay(page: Page): Promise<Locator> {
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pay credit card', exact: true })).toBeVisible();
  const form = addForm(page);
  await expect(form.getByTestId('pay-card-to')).toBeVisible();
  return form;
}

/** Pays the card from `from` on its Pay screen: the bill as filled in, or `amount` typed over it. */
export async function payCard(page: Page, o: { from: string; amount?: string }): Promise<void> {
  const form = await openCardPay(page);
  await chooseCardPayFrom(form, o.from);
  if (o.amount) {
    // The amount opens filled with the bill: cleared first, so what is typed is the whole figure.
    await form.getByRole('button', { name: 'Clear amount' }).click();
    await openAmount(form);
    await fillAmount(page, form, o.amount);
  }
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

/** The Pay screen's From, through the same sheet a transfer's From opens. */
export async function chooseCardPayFrom(form: Locator, from: string): Promise<void> {
  await form.getByRole('button', { name: 'From' }).click();
  await choosePayment(form.page(), from, 'From');
}

/**
 * The statement's Pay for the ticked purchases (owner, 17 Nov 2026): the same "Pay credit card" screen, the purchases
 * listed under "Paying N purchases", the amount their total and fixed. Returns the form.
 */
export async function openStatementPay(page: Page): Promise<Locator> {
  await page.getByTestId('statement-select-bar').getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pay credit card', exact: true })).toBeVisible();
  const form = addForm(page);
  await expect(form.getByTestId('pay-card-to')).toBeVisible();
  return form;
}

/** Pays the ticked purchases from `from` on that screen, and is back on the statement. */
export async function payStatementPurchases(page: Page, from: string): Promise<void> {
  const form = await openStatementPay(page);
  await chooseCardPayFrom(form, from);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(/\/cards\/[^/]+\/statement/);
}

/** A paid statement line's green ✓: covered by a payment, paid off (or settled, or ticked paid), or paid one by one. */
export const paidTick = (line: Locator) => line.getByTestId(/^statement-(covered|paid-off|paid-by)$/);

/**
 * Taps a paid line's ✓ and gives back the bubble saying how it was paid, checked to be the one bubble open and its ✓
 * marked expanded. The bubble hangs over the page, outside the row.
 */
export async function openPaidBubble(page: Page, line: Locator): Promise<Locator> {
  await paidTick(line).click();
  const bubble = page.getByTestId('statement-paid-bubble');
  await expect(bubble).toHaveCount(1);
  await expect(paidTick(line)).toHaveAttribute('aria-expanded', 'true');
  return bubble;
}

/** Escape closes the bubble and gives focus back to its ✓. */
export async function closePaidBubble(page: Page, line: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('statement-paid-bubble')).toHaveCount(0);
  await expect(paidTick(line)).toHaveAttribute('aria-expanded', 'false');
}

/**
 * The statement keeps its payments off its list: Paid in the totals box (Previous bill on an open statement) opens
 * them in a sheet titled "Paid · Rp …". Gives back that sheet.
 */
export async function openPaidSheet(page: Page): Promise<Locator> {
  await page.getByTestId('statement-paid-open').click();
  const sheet = page.getByRole('dialog', { name: /^Paid · / });
  await expect(sheet.getByTestId('statement-paid-sheet')).toBeVisible();
  return sheet;
}
