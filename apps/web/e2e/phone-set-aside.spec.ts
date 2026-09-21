import { expect, test } from '@playwright/test';
import { goalCard, jeniusWithTwoGoals, openAccountPage, openExpense, textOnWhite, typeAmount } from './set-aside';

/*
 * The laptop again, on the phone's own shell: the figure goes in on the keypad, digit by digit, and the question,
 * the goal card and the account page read the same figures the desktop reads.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the laptop on a phone: borrowed from the Emergency fund, and the account page shows the split', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  const form = await openExpense(page, 'Jenius');
  await typeAmount(page, form, '6800000');
  await expect(form.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await form.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await form.getByRole('button', { name: 'No — borrowing from it' }).click();
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').pressSequentially('Laptop');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);

  await page.goto('/goals');
  await expect(goalCard(page, 'Emergency fund').getByText(/short by Rp.?1\.800\.000/i).first()).toBeVisible();
  await expect(goalCard(page, 'Umrah 2027').getByText(/short by/i)).toHaveCount(0);

  await openAccountPage(page, 'Jenius');
  await expect(page.getByText(/35\.700\.000/).first()).toBeVisible();
  const free = page.getByText(/^-Rp.1\.800\.000$/);
  await expect(free).toBeVisible();
  await expect(free.locator('..')).toHaveClass(/ph-alarm/);
  await expect(page.getByRole('link', { name: /^Emergency fund.*Short by Rp.1\.800\.000.*30\.000\.000/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Umrah 2027.*Covered.*7\.500\.000/ })).toBeVisible();

  // The probe sees the light page's white groups (so it can fail)...
  expect(await textOnWhite(page)).toContain('Free to spend');
  // ...and in the dark, the new rows and the bar sit on the kit's grounds: no text is left on a literal white.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.getByText('Free to spend')).toBeVisible();
  expect(await textOnWhite(page)).toEqual([]);
});
