import { expect, type Page, test } from '@playwright/test';

// Local time, like every date field in the app: toISOString() is UTC, so between midnight and 07:00
// in Jakarta it names yesterday and any window built from it excludes what was just recorded.
const NOW = new Date();
const TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('50000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

/** Spending against the Food and beverage parent, which the event can then be planned against. */
async function spend(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Food and beverage (general)' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: description }).first()).toBeVisible();
}

async function addEvent(page: Page, name: string) {
  await page.goto('/events');
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  // Saving opens the event: planning it is what comes next.
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('an event is planned by category, and suggests what to tag', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Hampers', '4200000');
  await addEvent(page, 'Lebaran');

  // Nothing is suggested until the event says which categories it draws on.
  await expect(page.getByTestId('event-suggestions')).toHaveCount(0);

  await page.getByLabel('Category').selectOption({ label: 'Food and beverage' });
  await page.getByLabel('Planned', { exact: true }).fill('3000000');
  await page.getByRole('button', { name: 'Add category' }).click();

  const suggestions = page.getByTestId('event-suggestions');
  await expect(suggestions).toContainText('Hampers');

  await suggestions.getByRole('button', { name: 'Tag Hampers' }).click();

  // Tagged: it counts towards the event, and is over what was planned for it.
  const sheet = page.getByTestId('event-sheet');
  await expect(sheet).toContainText('4.200.000');
  await expect(sheet).toContainText('Over the plan by');
});

test('tagged spending leaves the monthly caps but is still taken off what is left', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Hampers', '4200000');

  await page.goto('/budget');
  // The same form budget.spec.ts drives: the parent option is its plain name.
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Food and beverage' });
  await page.getByLabel('Monthly amount (IDR)').fill('1000000');
  await page.getByLabel('Just this month').uncheck();
  await page.getByRole('button', { name: 'Set budget' }).click();
  const leftOverBefore = await page.getByTestId('left-over-actual').textContent();
  await expect(page.getByTestId('spent-total')).toContainText('4.200.000');

  await addEvent(page, 'Lebaran');
  await page.getByLabel('Category').selectOption({ label: 'Food and beverage' });
  // A plan is a list of things to buy, so a category is drawn on by planning something in it: there is no
  // longer a way to name a category and leave the figure out.
  await page.getByLabel('Planned', { exact: true }).fill('1000000');
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Hampers' }).click();
  // Wait for the write to land: navigating on the next line can abandon it in flight.
  await expect(page.getByTestId('event-sheet')).toContainText('4.200.000');

  await page.goto('/budget');
  // Out of the caps, named on its own line, and what is left has not moved.
  await expect(page.getByTestId('spent-total')).toContainText('Rp 0');
  await expect(page.getByTestId('event-line')).toContainText('4.200.000');
  expect(await page.getByTestId('left-over-actual').textContent()).toBe(leftOverBefore);
});
