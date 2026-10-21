import { expect, type Locator, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, addTransaction, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';

// Local time, like every date field in the app: toISOString() is UTC, so between midnight and 07:00
// in Jakarta it names yesterday and any window built from it excludes what was just recorded.
const NOW = new Date();
export const TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;

/**
 * Every `<dl>` figure inside a card, read as label → figure.
 *
 * `toContainText` on a card is not an assertion about a figure, only about the card holding that run of characters
 * somewhere: a plan whose "Bought so far" and "Still to buy" happen to be the same amount passes twice over one of
 * them, a label swapped with its neighbour passes unchanged, and a row deleted outright can still pass off the
 * donut's own SVG label behind it. Read as pairs, each figure is pinned to the words above it, and a row that is
 * gone is a key that is missing.
 *
 * Both screens' figures are `<dl> > <div>` with a `<dt>` and a `<dd>` inside, so one reading serves the plan
 * screen's summary and the event page's rows under the ring. The no-break space Intl puts after "Rp" is flattened,
 * so an expected figure can be written with the ordinary one.
 */
export function figures(scope: Locator): Promise<Record<string, string>> {
  return scope
    .locator('dl > div')
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          (node.querySelector('dt')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          (node.querySelector('dd')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ]),
      ),
    );
}

/** The figures of a card, once they have settled: a plan screen refetches as things are tagged and bought. */
export async function expectFigures(scope: Locator, expected: Record<string, string>) {
  await expect.poll(() => figures(scope)).toEqual(expected);
}

/**
 * A card's `<p>` rows read as label → figure, the same pairing `figures` gives a `<dl>`.
 *
 * The plan screen's "Not planned" sits outside the summary grid, under a rule of its own, so it is a `<p>` and not
 * a `<dl>` row — and it was asserted with `toContainText('Not planned')` beside a sweep of every rupiah in the card
 * for the right number *somewhere*. That is the weaker pattern the diff's own comments criticise: the two halves
 * never meet, so the figure could belong to any row on the card, or to no row at all. Read as a pair, the label
 * carries its own figure and a row that is gone is a key that is missing.
 */
export function rowFigures(scope: Locator): Promise<Record<string, string>> {
  return scope
    .locator('p')
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes
          .filter((node) => node.children.length >= 2)
          .map((node) => [
            (node.firstElementChild?.textContent ?? '').replace(/\s+/g, ' ').trim(),
            (node.lastElementChild?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ]),
      ),
    );
}

export async function expectRows(scope: Locator, expected: Record<string, string>) {
  await expect.poll(() => rowFigures(scope)).toEqual(expected);
}

/**
 * A native-kit group read as label → figure — the same pairing `figures` gives a `<dl>`.
 *
 * The plan screens are drawn with `ui/native` now: a group is a `<section>` whose last block is its flat surface,
 * and each row in it puts its words first and its figure last. So the pair is read off the row itself, structurally,
 * with no Tailwind class anywhere in the locator — a row that is gone is still a key that is missing, and a label
 * swapped with its neighbour still fails. Whatever is `aria-hidden` (the icon, the chevron, the separator) is left
 * out, because none of it is said to anybody.
 */
export function kitFigures(scope: Locator): Promise<Record<string, string>> {
  return scope.locator('section > div:last-of-type > *').evaluateAll((nodes) =>
    Object.fromEntries(
      nodes.map((node) => {
        // Joined at every level, so a label carrying a second word in a span of its own — "Left on this receipt"
        // beside "not planned" — reads as the two words it shows rather than running them together.
        const words = (el: Node): string =>
          [...el.childNodes].map((child) => (child.nodeType === 3 ? (child.textContent ?? '') : words(child))).join(' ');
        const say = (el: Element | undefined) => (el ? words(el).replace(/\s+/g, ' ').trim() : '');
        const inner = node.lastElementChild ?? node;
        const parts = [...inner.children].filter((child) => !child.hasAttribute('aria-hidden'));
        return [say(parts[0]), say(parts[parts.length - 1])];
      }),
    ),
  );
}

/** The figures of a kit group, once they have settled: a plan screen refetches as things are tagged and bought. */
export async function expectKitFigures(scope: Locator, expected: Record<string, string>) {
  await expect.poll(() => kitFigures(scope)).toEqual(expected);
}

/**
 * The three figures under the gauge's arc, as label → figure.
 *
 * They are the gauge's own `<b>`/`<span>` pairs rather than a `<dl>`, and they are the only place `PLAN_WORDS`
 * reaches the screen — a card handed the Budget page's words instead would print "Budgeted" here with every figure
 * still right. Located by the structure (the div after the arc), never by a Tailwind class.
 */
export function gaugeFigures(scope: Locator): Promise<Record<string, string>> {
  return scope
    .locator('svg[role="img"] + div > div')
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          (node.querySelector('span')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          (node.querySelector('b')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ]),
      ),
    );
}

export async function expectGauge(scope: Locator, expected: Record<string, string>) {
  await expect.poll(() => gaugeFigures(scope)).toEqual(expected);
}

/**
 * The foot of "What it covers", as label → figure.
 *
 * Three lines of one card, which `toContainText` cannot tell apart: "Given to items" and "Left on this receipt"
 * could swap places and two substring assertions on the card would pass unchanged. Each `<p>` is a label element
 * and a figure element, so the pair is read as it is shown — the amber "not planned" pill included, since it is
 * part of what the left-hand side says.
 */
export function coverFigures(page: Page): Promise<Record<string, string>> {
  // Three rows of one kit group now, rather than three `<p>`s of a card — read the same way, as label → figure.
  return kitFigures(page.getByTestId('cover-totals'));
}

export async function expectCover(page: Page, expected: Record<string, string>) {
  await expect.poll(() => coverFigures(page), { timeout: 15_000 }).toEqual(expected);
}

/**
 * Every rupiah figure in a piece of the page, in the order it is printed, as whole minor units.
 *
 * Case-insensitively, because `innerText` is the text as it is *drawn*: a kit group's header is uppercased by CSS,
 * so the figure riding on it reaches here as "RP 1.000.000". It is the same figure, printed in the same place, and
 * a reader that could not see it would let a heading go missing without a word.
 */
export async function moneyIn(scope: Locator): Promise<number[]> {
  const text = (await scope.innerText()).replace(/\s+/g, ' ');
  return [...text.matchAll(/Rp\s*([\d.]+)/gi)].map((match) => Number(match[1]!.replace(/\./g, '')));
}

export async function addWallet(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
}

/** Spending against the Food and beverage parent, which the event can then be planned against. */
export async function spend(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  await addTransaction(page, { description: description, paidWith: 'BCA Tahapan', category: 'Food and beverage', amount: amount });
  await expect(page.getByRole('listitem').filter({ hasText: description }).first()).toBeVisible();
}

/** An event for today. `set` is the category set it draws on, chosen by name; none, and it files under the monthly tree. */
export async function addEvent(page: Page, name: string, set?: string) {
  await page.goto('/events');
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  if (set) await page.getByLabel('Categories').selectOption({ label: set });
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  // Saving opens the event: planning it is what comes next.
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

export interface ItemFields {
  name: string;
  price: string;
  quantity?: string;
  category?: string;
  link?: string;
  note?: string;
}

/** Fills the item form that is already open, and saves it. */
export async function fillItem(page: Page, options: ItemFields) {
  await page.getByLabel('What', { exact: true }).fill(options.name);
  if (options.quantity) await page.getByLabel('How many').fill(options.quantity);
  await page.getByLabel('Price each').fill(options.price);
  if (options.category) await page.getByLabel('Category').selectOption({ label: options.category });
  if (options.link) await page.getByLabel('Link').fill(options.link);
  if (options.note) await page.getByLabel('Note').fill(options.note);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: options.name })).toBeVisible();
}

/** From the plan: ＋ and then the form. "Add the first item" on an empty plan opens the same form. */
export async function addItem(page: Page, options: ItemFields) {
  await page.getByRole('link', { name: 'Add an item' }).first().click();
  await fillItem(page, options);
}

/**
 * From an event: open its plan, add one thing in a category, and come back.
 *
 * The category is drawn on by planning something in it — there is no figure to set for a category any more, and a
 * category with no items is not part of the plan at all. The item takes the category's own name, which is what
 * migration 0049 made of the caps that came before it.
 */
export async function planFor(page: Page, category: string, amount: string, option = category) {
  // By test id, not by words: the card's link says "Plan what to buy" while nothing is planned and "See the whole
  // plan" once there are items, and this helper is called both before and after the first one.
  await showPlanCard(page);
  await page.getByTestId('open-plan').click();
  await addItem(page, { name: category, price: amount, category: option });
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await showPlanCard(page);
  await expect(page.getByTestId('open-plan')).toBeVisible();
}

/**
 * Records spending into the open event through its Add spending, which opens the ordinary Add screen with the event
 * already set — and Save comes back to the event it was opened from.
 *
 * Paid with is chosen before the figure, because a figure typed with a minus first is money back and the row then
 * asks where the money went ("Into") rather than what paid. The keypad a phone types on takes digits only, so money
 * back is a desktop journey.
 */
export async function recordIntoEvent(
  page: Page,
  tx: { description: string; amount: string; category?: string; paidWith?: string },
) {
  const event = page.url();
  await page.getByRole('button', { name: 'Add spending' }).click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, tx.paidWith ?? 'BCA Tahapan');
  await openAmount(form);
  await fillAmount(page, form, tx.amount);
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: tx.category ?? 'Food and beverage', exact: true }).click();
  await form.getByLabel('Note').fill(tx.description);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(event);
}

/**
 * "Buy it now" on an item's page: the Add screen, filled in from the item, and Save ties the payment to it.
 *
 * Only Paid with has to be chosen. `paid` is the receipt's real figure typed over the estimate — cleared first, so a
 * phone's keypad replaces the estimate rather than typing after it. Returns the form, still open when Save refused.
 */
export async function buyItNow(page: Page, options: { paid?: string; paidWith?: string } = {}) {
  await page.getByRole('button', { name: 'Buy it now' }).click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, options.paidWith ?? 'BCA Tahapan');
  if (options.paid !== undefined) {
    await form.getByRole('button', { name: 'Clear amount' }).click();
    await openAmount(form);
    await fillAmount(page, form, options.paid);
  }
  await saveButton(form).click();
  return form;
}

/** The plan card sits under Against the plan, the chart that reads it: swipe there first when the event has a plan. */
export async function showPlanCard(page: Page) {
  await expect(page.getByTestId('event-sheet')).toBeVisible();
  const card = page.getByTestId('open-plan');
  // Retried, because a workspace tab just chosen redraws the chart under the click.
  await expect(async () => {
    if (!(await card.isVisible())) {
      const dot = page.getByRole('button', { name: 'Against the plan', exact: true });
      if ((await dot.count()) > 0) await dot.click();
    }
    await expect(card).toBeVisible({ timeout: 1000 });
  }).toPass();
}

/** The plan screen's top: how many are bought, what is left to buy, and what was planned (with any difference). */
export async function expectPlanHero(page: Page, expected: { count: string; toGo: string; planned: string }) {
  const read = async (id: string) => ((await page.getByTestId(id).textContent()) ?? '').replace(/\s+/g, ' ').trim();
  await expect.poll(async () => ({ count: await read('plan-count'), toGo: await read('plan-to-go'), planned: await read('plan-planned') })).toEqual(expected);
}
