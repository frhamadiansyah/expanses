import { expect, test } from '@playwright/test';
import { household, pauseFor } from './bill-pause';
import { openCapOf, setBudget } from './budget';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('on a phone: a paused bill leaves Still to pay for a Paused group, and comes back with Resume', async ({ page }) => {
  await household(page);
  await pauseFor(page, 'Gym', 2);
  await expect(page.getByTestId('bill-history').getByText('Paused')).toHaveCount(2);

  await page.goto('/bills');
  await expect(page.getByTestId('bills-total')).toContainText('150.000');
  const row = page.getByTestId('bills-paused').getByTestId('bill-row').filter({ hasText: 'Gym' });
  await expect(row).toContainText(/until \w{3} \d{4}/);
  await row.click();
  const actions = page.getByRole('group', { name: 'Actions' });
  await actions.getByRole('button', { name: 'Resume' }).click();
  // The resume has landed once the button turns back into Pause; leaving sooner can drop it.
  await expect(actions.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.goto('/bills');
  await expect(page.getByTestId('bills-total')).toContainText('500.000');
});

test('on a phone: Budget and Cashflow leave a paused bill out', async ({ page }) => {
  await household(page);
  await page.goto('/budget');
  await setBudget(page, '— Sports & fitness', '1000000');
  await page.goto('/bills');
  await pauseFor(page, 'Gym', 1);
  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('0 of 1 bill paid');
  await page.goto('/budget');
  const cap = await openCapOf(page, '— Sports & fitness');
  await expect(cap.getByTestId('cap-spent')).toBeVisible();
  await expect(cap.getByTestId('cap-bills')).toHaveCount(0);
});
