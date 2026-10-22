import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { TODAY } from './event-plan';

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });
/** The row's own face, told apart from the tick and the category circle beside it. */
const face = (page: Page, what: string, category: string) => row(page, what).getByRole('button', { name: new RegExp(`^${category}`) });
const tick = (page: Page, what: string) => page.getByRole('checkbox', { name: `Select ${what}` });
const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected transactions' });
/** The top of select mode, the one bar it has: ✕, how many are selected, and ⋯. */
const top = (page: Page) => bar(page);
/** One of the ticked rows' actions, from the ⋯ menu in the title row. */
async function act(page: Page, action: string) {
  await bar(page).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: action }).click();
}
/** Whether an action is offered for what is ticked, read off the ⋯ menu and the menu put away again. */
async function expectActionDisabled(page: Page, action: string) {
  await bar(page).getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: action })).toBeDisabled();
  await bar(page).getByRole('button', { name: 'Actions' }).click();
}

async function startSelecting(page: Page) {
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByTestId('filters-menu').getByRole('menuitem', { name: 'Select' }).click();
  await expect(bar(page)).toBeVisible();
}

/**
 * Select mode on the list: tick rows of any date and category, and put them all into an event at once — then take
 * one back out. The event's own history is where the result is read, because that is where the tag is used.
 */
test('ticked rows go into an event together, and one comes back out', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

  // An event to put them in, made where events are made.
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Lombok trip');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Lombok trip', exact: true })).toBeVisible();
  const eventUrl = page.url();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Sate Rembiga', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '85000' });
  await addTransaction(page, { description: 'Pertashop', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '62000' });
  await addTransaction(page, { description: 'Kopi Tuku', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '24000' });

  await startSelecting(page);
  await expect(top(page)).toContainText('None selected');
  // Nothing on the bar works until a row is ticked.
  await expectActionDisabled(page, 'Add to event');
  // An opening balance is not spending to put anywhere: hidden from the list by default, so there is nothing to tick.
  await expect(row(page, 'Opening balance')).toHaveCount(0);

  // A tap on the row ticks it — it does not open the receipt — and a second tap unticks it.
  await face(page, 'Sate Rembiga', 'Restaurants').click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(tick(page, 'Sate Rembiga')).toBeChecked();
  await face(page, 'Kopi Tuku', 'Restaurants').click();
  await face(page, 'Kopi Tuku', 'Restaurants').click();
  await expect(tick(page, 'Kopi Tuku')).not.toBeChecked();
  // The tick itself does the same.
  await tick(page, 'Pertashop').click();
  await expect(tick(page, 'Pertashop')).toBeChecked();
  await expect(top(page)).toContainText('2 selected');
  // Select All ticks every row that can be ticked, and reads Deselect All once it has.
  await act(page, 'Select All');
  await expect(top(page)).toContainText('3 selected');
  await act(page, 'Deselect All');
  await expect(top(page)).toContainText('None selected');
  await tick(page, 'Sate Rembiga').click();
  await tick(page, 'Pertashop').click();

  await act(page, 'Add to event');
  await page.getByRole('dialog', { name: 'Add to event' }).getByRole('button', { name: 'Lombok trip' }).click();
  await expect(toast(page)).toContainText('2 transactions added to Lombok trip');
  // Done: select mode is over, and a row's tap is the receipt's again.
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);

  // Read where the tag is used: the event's history holds the two, and not the third.
  await page.goto(eventUrl);
  const history = page.getByTestId('event-history');
  await expect(history.filter({ hasText: 'Sate Rembiga' })).toHaveCount(1);
  await expect(history.filter({ hasText: 'Pertashop' })).toHaveCount(1);
  await expect(history.filter({ hasText: 'Kopi Tuku' })).toHaveCount(0);

  // And one back out.
  await page.goto('/transactions');
  await startSelecting(page);
  await tick(page, 'Pertashop').click();
  await act(page, 'Remove from event');
  await expect(toast(page)).toContainText('1 transaction removed from Lombok trip');
  await expect(bar(page)).toHaveCount(0);

  await page.goto(eventUrl);
  await expect(history.filter({ hasText: 'Sate Rembiga' })).toHaveCount(1);
  await expect(history.filter({ hasText: 'Pertashop' })).toHaveCount(0);
});

/** Undo puts every row back where it was, so a selection put in the wrong event costs one tap. */
test('Undo takes a whole selection back out of the event', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Lombok trip');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Lombok trip', exact: true })).toBeVisible();
  const eventUrl = page.url();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Sate Rembiga', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '85000' });
  await startSelecting(page);
  await tick(page, 'Sate Rembiga').click();
  await act(page, 'Add to event');
  await page.getByRole('dialog', { name: 'Add to event' }).getByRole('button', { name: 'Lombok trip' }).click();
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(toast(page)).toHaveCount(0);
  // Read back on the list first, so the page is not left while the write is still going out: ticked again, the row
  // is in no event, so there is nothing to remove it from.
  await startSelecting(page);
  await tick(page, 'Sate Rembiga').click();
  await expectActionDisabled(page, 'Remove from event');

  await page.goto(eventUrl);
  await expect(page.getByRole('heading', { name: 'Lombok trip', exact: true })).toBeVisible();
  await expect(page.getByTestId('event-history')).toHaveCount(0);
});
