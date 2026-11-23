import { expect, test } from '@playwright/test';
import { household, MONTHS, pauseFor } from './bill-pause';
import { openCapOf, setBudget } from './budget';
import { macV2 } from './mac-detail';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('pausing a bill for two months takes it out of Still to pay, shows the months, and Resume brings it back', async ({ page }) => {
  // Still to pay's exact figure (`bills-total`) is a v2 part of Mac Bills; v1's tiles round it.
  await macV2(page);
  await household(page);
  await expect(page.getByTestId('bills-total')).toContainText('500.000');

  await pauseFor(page, 'Gym', 2);
  const now = new Date();
  const next = MONTHS[(now.getMonth() + 1) % 12]!;
  await expect(page.getByTestId('bill-status')).toContainText('Paused');
  // This month and the next are paused, and the history says so.
  const history = page.getByTestId('bill-history');
  await expect(history.getByText('Paused')).toHaveCount(2);
  await expect(history).toContainText(`${next} bill`);
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Resume' })).toBeVisible();

  await page.goto('/bills');
  await expect(page.getByTestId('bills-total')).toContainText('150.000');
  await expect(page.getByTestId('bills-total')).not.toContainText('500.000');
  const paused = page.getByTestId('bills-paused');
  await expect(paused.getByTestId('bill-row').filter({ hasText: 'Gym' })).toContainText(/until \w{3} \d{4}/);

  await paused.getByTestId('bill-row').filter({ hasText: 'Gym' }).dblclick();
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('bill-status')).not.toContainText('Paused');
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.goto('/bills');
  await expect(page.getByTestId('bills-total')).toContainText('500.000');
  await expect(page.getByTestId('bills-paused')).toHaveCount(0);
});

test('a paused bill is not counted by Cashflow or by the budget’s bills', async ({ page }) => {
  await household(page);
  await page.goto('/budget');
  await setBudget(page, '— Sports & fitness', '1000000');
  let cap = await openCapOf(page, '— Sports & fitness');
  await expect(cap.getByTestId('cap-bills')).toContainText('350.000');
  await page.keyboard.press('Escape');

  await page.goto('/bills');
  await pauseFor(page, 'Gym', 1);

  // The month's bills line is the phone's Cashflow (a wide screen's Cashflow D has Bills in the sidebar instead).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('0 of 1 bill paid');
  await expect(page.getByTestId('recurring-card')).toContainText('150.000');
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto('/budget');
  cap = await openCapOf(page, '— Sports & fitness');
  await expect(cap.getByTestId('cap-spent')).toBeVisible();
  await expect(cap.getByTestId('cap-bills')).toHaveCount(0);
});
