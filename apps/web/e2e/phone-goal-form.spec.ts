import { expect, test } from '@playwright/test';
import { addMoneyAccount, addSetAsideRow, closeSetAsideRows, goalCard, goalRow, setAsideBar } from './set-aside';
import { addPayment, openGoalForm } from './goals';

/*
 * The goal form as a page of the kit's own rows: ‹ at the left, ✓ at the right, the kind a row on the page, and
 * Funding every account that can hold the goal's money, typed in place.
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

  // Funding is one row on the form; the accounts are behind it, each already listed with what it has free.
  await expect(page.getByRole('button', { name: /^Funding/ })).toContainText('None');
  await expect(page.getByTestId('set-aside-row')).toHaveCount(0);
  await addSetAsideRow(page, 'Jenius');
  await expect(page.getByTestId('set-aside-row')).toHaveCount(1);
  await page.getByLabel('Jenius', { exact: true }).fill('1500000');
  await closeSetAsideRows(page);
  await expect(page.getByRole('button', { name: /^Funding/ })).toContainText('1.500.000');

  await save.click();
  await expect(page).toHaveURL(/\/goals$/);
  await expect(goalRow(page, 'Lombok trip')).toBeVisible();

  const card = await goalCard(page, 'Lombok trip');
  await expect(card.getByTestId('goal-link').filter({ hasText: 'Jenius' }).first()).toBeVisible();
});

test('set aside from a saved goal: every account one line, typed in place, with the bar over the keyboard', async ({ page }) => {
  await addMoneyAccount(page, 'BCA', 'savings', '10000000');
  await addMoneyAccount(page, 'Jenius', 'savings', '20000000');
  await addMoneyAccount(page, 'Kosong', 'savings', '0');
  await page.goto('/goals');
  await openGoalForm(page, 'Wedding');
  await page.getByLabel(/Cost today/).first().fill('8000000');
  await page.getByRole('button', { name: 'Save goal' }).click();
  const card = await goalCard(page, 'Wedding');

  await card.getByRole('button', { name: 'Set aside', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Set aside' });
  // Nothing in the goal yet: one group, Can add, most free first, each with what it has free in grey. No chooser,
  // and an account with nothing free is not listed.
  await expect(sheet.getByText('Can add', { exact: true })).toBeVisible();
  await expect(sheet.getByText(/^In Wedding$/)).toHaveCount(0);
  await expect(sheet.getByTestId('set-aside-row')).toHaveCount(2);
  await expect(sheet.getByTestId('set-aside-row').first()).toContainText('Jenius');
  const jenius = sheet.getByLabel('Jenius', { exact: true });
  const bca = sheet.getByLabel('BCA', { exact: true });
  await expect(jenius).toHaveAttribute('placeholder', /^Rp.20\.000\.000$/);
  await expect(bca).toHaveAttribute('placeholder', /^Rp.10\.000\.000$/);
  await expect(sheet.getByLabel('Kosong', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Add an account' })).toHaveCount(0);

  // A tap on the line puts the caret in its figure, and the bar offers what fills the goal (less than all that is
  // free), half of it, and what the goal still needs.
  await sheet.getByTestId('set-aside-row').filter({ hasText: 'Jenius' }).click();
  await expect(jenius).toBeFocused();
  const bar = setAsideBar(page);
  await expect(bar.getByRole('option')).toHaveCount(3);
  await expect(bar.getByRole('option').first()).toHaveAccessibleName(/^Fills goal, Rp/);
  await expect(bar.getByRole('option').nth(1)).toHaveAccessibleName(/^Half, Rp/);
  await expect(bar.getByRole('option').nth(2)).toHaveAccessibleName(/still needed$/);
  await jenius.pressSequentially('3000000');
  await expect(jenius).toHaveValue('3.000.000');

  // Too much on BCA: warn, Save waits, and the bar's one slot puts in what is free.
  await bca.click();
  await bca.pressSequentially('12000000');
  await expect(sheet.getByTestId('set-aside-row').filter({ hasText: 'BCA' })).toHaveAttribute('data-over', 'true');
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await bar.getByRole('option', { name: /^Use the Rp.10\.000\.000 free$/ }).click();
  await expect(bca).toHaveValue('10.000.000');
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  // Emptied, BCA holds nothing.
  await bca.clear();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  await expect(card.getByTestId('goal-link').filter({ hasText: 'Jenius' }).first()).toContainText('3.000.000');
  await expect(card.getByTestId('goal-link').filter({ hasText: 'BCA' })).toHaveCount(0);

  // Opened again: Jenius is in the goal, in ink, and its bar offers the most possible and taking it back.
  await card.getByRole('button', { name: 'Set aside', exact: true }).click();
  const again = page.getByRole('dialog', { name: 'Set aside' });
  await expect(again.getByText(/^In Wedding$/)).toBeVisible();
  await expect(again.getByLabel('Jenius', { exact: true })).toHaveValue('3.000.000');
  await again.getByLabel('Jenius', { exact: true }).click();
  await expect(setAsideBar(page).getByRole('option').first()).toHaveAccessibleName(/^Most possible, Rp.20\.000\.000$/);
  await setAsideBar(page).getByRole('option', { name: 'Take back' }).click();
  await expect(again.getByLabel('Jenius', { exact: true })).toHaveValue('0');
  await again.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(again).toHaveCount(0);
  await expect(card.getByTestId('goal-link').filter({ hasText: 'Jenius' })).toHaveCount(0);
});
