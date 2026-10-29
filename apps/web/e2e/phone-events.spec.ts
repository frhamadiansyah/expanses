import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { planFor, recordIntoEvent, TODAY, showPlan } from './event-plan';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Add spending opens the Add screen with the event set; a set's own categories are what its Category offers. */
const record = (page: Page, description: string, category: string, amount: string) => recordIntoEvent(page, { description, category, amount });

test('an event reads like Cashflow: where it went, and a swipe to what it planned', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '90000000' });

  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Singapore');
  await page.getByLabel('Categories').selectOption({ label: 'Holiday' });
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Singapore', exact: true })).toBeVisible();

  await planFor(page, 'Flights', '4500000');
  await planFor(page, 'Lodging', '3000000');

  await record(page, 'Garuda', 'Flights', '4280000');
  await record(page, 'Hotel', 'Lodging', '3900000');

  // No Expense and Income, and no arrows: an event is spending, and the list is one tap back.
  const sheet = page.getByTestId('event-sheet');
  await expect(sheet.getByRole('radiogroup', { name: 'Show' })).toHaveCount(0);
  await expect(page.getByTestId('event-total')).toContainText('8.180.000');
  // Where it went keeps every category, folded until the chart is tapped: its share of the trip and what it came to.
  const rows = page.getByTestId('event-detail-sheet');
  await expect(rows).toHaveCount(0);
  await page.getByTestId('event-sheet').getByTestId('see-categories').click();
  await expect(rows).toContainText('52%');
  await expect(rows).toContainText('3.900.000');

  // Turned to the plan, the whole of what was spent in the planned categories against the whole of what was planned.
  await sheet.getByRole('button', { name: 'Against the plan' }).click();
  await showPlan(page);
  await expect(sheet).toContainText('Over the plan by');
  await expect(sheet).toContainText(/Rp\s?680\.000/);
  await expect(sheet).toContainText('Still to pay');

  // The event's own history sits under it.
  await expect(page.getByRole('heading', { name: 'Transaction history' })).toBeVisible();
  await expect(page.getByText('Garuda')).toBeVisible();

  // And the list shows it as a card with what it cost against its plan.
  await page.getByRole('link', { name: 'All events' }).click();
  await expect(page.getByTestId('event-row')).toContainText('8.180.000');
  await expect(page.getByTestId('event-row')).toContainText('7.500.000');
});

test('the plan under the gauge starts folded, and a tap on the gauge shows it and folds it again', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '90000000' });
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Singapore');
  await page.getByLabel('Categories').selectOption({ label: 'Holiday' });
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Singapore', exact: true })).toBeVisible();
  await planFor(page, 'Flights', '4500000');

  // The plan card was opened to add the item, which leaves the plan shown: a fresh load starts it folded.
  await page.reload();
  const sheet = page.getByTestId('event-sheet');
  await sheet.getByRole('button', { name: 'Against the plan' }).click();
  // Swiped to the gauge: it is drawn, the plan rows are not.
  await expect(page.getByTestId('see-plan')).toBeVisible();
  await expect(page.getByTestId('event-plan-card')).toHaveCount(0);

  // Through the helper, which waits out the swipe still settling: a tap that lands mid-swipe is lost to it.
  await showPlan(page);
  await expect(page.getByTestId('hide-plan')).toHaveAttribute('aria-label', 'Hide the plan');
  await expect(page.getByTestId('event-plan-card')).toBeVisible();

  await page.getByTestId('hide-plan').click();
  await expect(page.getByTestId('see-plan')).toHaveAttribute('aria-label', 'See the plan');
  await expect(page.getByTestId('event-plan-card')).toHaveCount(0);
  // The gauge itself never goes: its frame is the thing tapped.
  await expect(page.getByTestId('see-plan')).toBeVisible();
});
