import { expect, type Locator, type Page } from '@playwright/test';

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
  return page
    .getByTestId('cover-totals')
    .locator('p')
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => [
          // Joined child by child: the amber pill is a span of its own with no whitespace beside it, and
          // `textContent` would run it into the words before it as "…this receiptnot planned".
          [...(node.firstElementChild?.childNodes ?? [])]
            .map((child) => child.textContent ?? '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
          (node.lastElementChild?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ]),
      ),
    );
}

export async function expectCover(page: Page, expected: Record<string, string>) {
  await expect.poll(() => coverFigures(page), { timeout: 15_000 }).toEqual(expected);
}

/** Every rupiah figure in a piece of the page, in the order it is printed, as whole minor units. */
export async function moneyIn(scope: Locator): Promise<number[]> {
  const text = (await scope.innerText()).replace(/\s+/g, ' ');
  return [...text.matchAll(/Rp\s*([\d.]+)/g)].map((match) => Number(match[1]!.replace(/\./g, '')));
}

export async function addWallet(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('50000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

/** Spending against the Food and beverage parent, which the event can then be planned against. */
export async function spend(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Food and beverage (general)' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: description }).first()).toBeVisible();
}

export async function addEvent(page: Page, name: string) {
  await page.goto('/events');
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
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
  await page.getByTestId('open-plan').click();
  await addItem(page, { name: category, price: amount, category: option });
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await expect(page.getByTestId('open-plan')).toBeVisible();
}
