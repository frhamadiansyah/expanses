import { expect, test } from '@playwright/test';
// The wallet, the spending and the event are shared with the plan specs, which drive the same three screens.
import { addEvent, addWallet, planFor, spend } from './event-plan';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('an event is planned by category, and suggests what to tag', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Hampers', '4200000');
  await addEvent(page, 'Lebaran');

  // Nothing is suggested until the event says which categories it draws on.
  await expect(page.getByTestId('event-suggestions')).toHaveCount(0);

  // A category is drawn on by planning something in it: there is no figure to set for a category.
  await planFor(page, 'Food and beverage', '3000000');

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
  await planFor(page, 'Food and beverage', '1000000');
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Hampers' }).click();
  // Wait for the write to land: navigating on the next line can abandon it in flight.
  await expect(page.getByTestId('event-sheet')).toContainText('4.200.000');

  await page.goto('/budget');
  // Out of the caps, named on its own line, and what is left has not moved.
  await expect(page.getByTestId('spent-total')).toContainText('Rp 0');
  await expect(page.getByTestId('event-line')).toContainText('4.200.000');
  expect(await page.getByTestId('left-over-actual').textContent()).toBe(leftOverBefore);
});
