import { expect, test } from '@playwright/test';
import { addMoneyAccount, addSetAsideRow, goalCard, goalRow } from './set-aside';
import { openGoalForm } from './goals';

/*
 * The goal form as a page of the kit's own rows: ‹ at the left, ✓ at the right, the kind a row on the page, and
 * Money set aside only the accounts added.
 */

test('a goal is made from the + on a full page: kind, name, a payment, an account row, ✓', async ({ page }) => {
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
  await page.getByLabel(/Cost in today's money/).first().fill('4000000');
  await expect(save).toBeEnabled();

  await page.getByRole('button', { name: 'Add a payment' }).click();
  await page.getByLabel('What', { exact: true }).nth(1).fill('Hotel');
  await page.getByLabel(/Cost in today's money/).nth(1).fill('2000000');

  // Only the rows added show: nothing is listed until an account is.
  await expect(page.getByTestId('set-aside-row')).toHaveCount(0);
  await addSetAsideRow(page, 'Jenius');
  await page.getByLabel('Jenius', { exact: true }).fill('1500000');

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
  await page.getByLabel(/Cost in today's money/).first().fill('8000000');
  await page.getByRole('button', { name: 'Save goal' }).click();
  const card = await goalCard(page, 'Wedding');

  await card.getByRole('button', { name: 'Set aside', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Set aside' });
  await sheet.getByRole('button', { name: 'Add an account' }).click();
  const chooser = page.getByRole('dialog', { name: 'Add an account' });
  await chooser.getByRole('button', { name: 'Jenius', exact: true }).click();
  await sheet.getByLabel('Jenius', { exact: true }).fill('3000000');
  // An account already added is not offered again.
  await sheet.getByRole('button', { name: 'Add an account' }).click();
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
