import { expect, test } from '@playwright/test';
// The wallet, the spending and the event are shared with the plan specs, which drive the same three screens.
import { addEvent, addWallet, fillItem, planFor, spend } from './event-plan';
import { addCap, budgetTab, monthSoFar } from './budget';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('an event is planned as a list of things to buy, and suggests what to tag', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Hampers', '4200000');
  await addEvent(page, 'Lebaran');

  await expect(page.getByTestId('event-suggestions')).toHaveCount(0);

  await page.getByRole('link', { name: 'Plan what to buy' }).click();
  await page.getByRole('link', { name: 'Add the first item' }).click();
  await fillItem(page, { name: 'Hampers', price: '3000000', category: 'Food and beverage' });
  await page.getByRole('link', { name: 'Back to the event' }).click();

  const suggestions = page.getByTestId('event-suggestions');
  await expect(suggestions).toContainText('Hampers');
  await suggestions.getByRole('button', { name: 'Tag Hampers' }).click();

  // Tagged but unclaimed: it is spending nobody planned, and the event is over what it meant to spend.
  await expect(page.getByTestId('event-plan-card')).toContainText('3.000.000');
  await page.getByTestId('event-sheet').getByRole('button', { name: 'Against the plan' }).click();
  await expect(page.getByTestId('event-sheet')).toContainText('Over the plan by');
  await expect(page.getByTestId('event-sheet')).toContainText('Not planned');
});

test('tagged spending leaves the monthly caps but is still taken off what is left', async ({ page }) => {
  await addWallet(page);
  await spend(page, 'Hampers', '4200000');

  await page.goto('/budget');
  // The same sheet budget.spec.ts drives: the parent option is its plain name.
  await addCap(page, { option: 'Food and beverage', amount: '1000000' });
  await expect(page.getByTestId('line-Food and beverage')).toContainText('4.200.000');
  await monthSoFar(page);
  await expect(page.getByTestId('month-spent')).toContainText('4.200.000');
  const leftOverBefore = await page.getByTestId('left-over-actual').textContent();

  await addEvent(page, 'Lebaran');
  await planFor(page, 'Food and beverage', '1000000');
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Hampers' }).click();
  // Wait for the write to land: navigating on the next line can abandon it in flight.
  await expect(page.getByTestId('event-sheet')).toContainText('4.200.000');

  await page.goto('/budget');
  // Out of the caps, named on its own line, and what is left has not moved.
  await expect(page.getByTestId('line-Food and beverage')).toContainText('left of 1.000.000');
  await budgetTab(page, 'Plan');
  await expect(page.getByTestId('event-line')).toContainText('4.200.000');
  await monthSoFar(page);
  await expect(page.getByTestId('month-spent')).toContainText('Rp 0');
  expect(await page.getByTestId('left-over-actual').textContent()).toBe(leftOverBefore);
});
