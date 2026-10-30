import { expect, test } from '@playwright/test';
import { addMoneyAccount, addSetAsideRow, closeSetAsideRows, goalCard, goalRow } from './set-aside';
import { addPayment, openGoalForm } from './goals';

/*
 * The goal form as a page of the kit's own rows: ‹ at the left, ✓ at the right, the kind a row on the page, and
 * Funding only the accounts added.
 */

test('a goal is made from the + on a full page: kind, name, payments, an account row, ✓', async ({ page }) => {
  await addMoneyAccount(page, 'Jenius', 'savings', '20000000');
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await expect(page).toHaveURL(/\/goals\/new$/);
  await expect(page.getByRole('heading', { name: 'New goal' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Save goal' });

  await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'Holiday' });
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Holiday');
  await page.getByLabel('Name', { exact: true }).fill('Lombok trip');
  // The ✓ waits for a figure.
  await expect(save).toBeDisabled();
  await page.getByLabel(/Cost today/).first().fill('4000000');
  await expect(save).toBeEnabled();

  await addPayment(page, { what: 'Hotel', cost: '2000000' });
  // Two payments: a row each, the first under the goal's name.
  await expect(page.getByTestId('payment-row')).toHaveCount(2);
  await expect(page.getByTestId('payment-row').first()).toContainText('Lombok trip');
  await expect(page.getByTestId('payment-row').nth(1)).toContainText('Hotel');

  // Funding is one row on the form; the accounts are behind it, and nothing is listed until one is added.
  await expect(page.getByRole('button', { name: /^Funding/ })).toContainText('None');
  await expect(page.getByTestId('set-aside-row')).toHaveCount(0);
  await addSetAsideRow(page, 'Jenius');
  await page.getByLabel('Jenius', { exact: true }).fill('1500000');
  await closeSetAsideRows(page);
  await expect(page.getByRole('button', { name: /^Funding/ })).toContainText('1.500.000');

  await save.click();
  await expect(page).toHaveURL(/\/goals$/);
  await expect(goalRow(page, 'Lombok trip')).toBeVisible();

  const card = await goalCard(page, 'Lombok trip');
  await expect(card.getByTestId('goal-link').filter({ hasText: 'Jenius' }).first()).toBeVisible();
});

test('set aside from a saved goal adds an account through the sheet, and a row can be taken away', async ({ page }) => {
  await addMoneyAccount(page, 'Jenius', 'savings', '20000000');
  await addMoneyAccount(page, 'BCA', 'savings', '10000000');
  await page.goto('/goals');
  await openGoalForm(page, 'Wedding');
  await page.getByLabel(/Cost today/).first().fill('8000000');
  await page.getByRole('button', { name: 'Save goal' }).click();
  const card = await goalCard(page, 'Wedding');

  await card.getByRole('button', { name: 'Set aside', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Set aside' });
  await sheet.getByRole('button', { name: 'Set aside', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Add an account' });
  await chooser.getByRole('button', { name: 'Jenius', exact: true }).click();
  await sheet.getByLabel('Jenius', { exact: true }).fill('3000000');
  // An account already added is not offered again.
  await sheet.getByRole('button', { name: 'Set aside', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add an account' }).getByRole('button', { name: 'Jenius', exact: true })).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Add an account' }).getByRole('button', { name: 'BCA', exact: true }).click();
  await sheet.getByLabel('BCA', { exact: true }).fill('1000000');
  await sheet.getByRole('button', { name: 'Remove BCA' }).click();
  await expect(sheet.getByLabel('BCA', { exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  await expect(card.getByTestId('goal-link').filter({ hasText: 'Jenius' }).first()).toBeVisible();
  await expect(card.getByTestId('goal-link').filter({ hasText: 'BCA' })).toHaveCount(0);
});
