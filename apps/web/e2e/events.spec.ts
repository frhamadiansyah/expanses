import { expect, type Page, test } from '@playwright/test';

const TODAY = new Date().toISOString().slice(0, 10);

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

/** Spending against the Food & Drink parent, which the occasion can then be planned against. */
async function spend(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Food & Drink (general)' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: description }).first()).toBeVisible();
}

async function addOccasion(page: Page, name: string) {
  await page.goto('/events');
  await page.getByRole('button', { name: 'Add an occasion' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save occasion' }).click();
  await expect(page.getByTestId('event-row')).toContainText(name);
}

test('an occasion is planned by category, and suggests what to tag', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Hampers', '4200000');
  await addOccasion(page, 'Lebaran');

  // Nothing is suggested until the occasion says which categories it draws on.
  await expect(page.getByTestId('event-suggestions')).toHaveCount(0);

  await page.getByLabel('Category').selectOption({ label: 'Food & Drink' });
  await page.getByLabel('Planned', { exact: true }).fill('3000000');
  await page.getByRole('button', { name: 'Add category' }).click();

  const suggestions = page.getByTestId('event-suggestions');
  await expect(suggestions).toContainText('Hampers');

  await suggestions.getByRole('button', { name: 'Tag Hampers' }).click();

  // Tagged: it counts towards the occasion, and is over what was planned for it.
  const sheet = page.getByTestId('event-sheet');
  await expect(sheet).toContainText('4.200.000');
  await expect(sheet).toContainText('Over by');
});

test('tagged spending leaves the monthly caps but is still taken off what is left', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Hampers', '4200000');

  await page.goto('/budget');
  // The same form budget.spec.ts drives: the parent option is its plain name.
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Food & Drink' });
  await page.getByLabel('Monthly amount (IDR)').fill('1000000');
  await page.getByLabel('Just this month').uncheck();
  await page.getByRole('button', { name: 'Set budget' }).click();
  const leftOverBefore = await page.getByTestId('left-over-actual').textContent();
  await expect(page.getByTestId('spent-total')).toContainText('4.200.000');

  await addOccasion(page, 'Lebaran');
  await page.getByLabel('Category').selectOption({ label: 'Food & Drink' });
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
