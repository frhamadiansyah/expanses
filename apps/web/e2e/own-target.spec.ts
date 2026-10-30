import { expect, test } from '@playwright/test';
import { editGoal } from './goals';
import { goalCard } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('a Target amount typed over the calculated one is the goal total, and Edit goal carries the same setting', async ({ page }) => {
  await page.goto('/calculators/emergency');
  await page.getByLabel('Household').selectOption('children');
  await page.getByLabel('Income').selectOption('salaried');
  await page.getByLabel('What goes out a month', { exact: true }).fill('17000000');
  const answer = page.getByTestId('answer-emergency');
  const months = await page.getByLabel('Months of outgoings').inputValue();
  expect(Number(months)).toBeGreaterThan(0);
  await expect(answer).toContainText('Needed');
  const target = page.getByLabel('Target amount');
  const calculated = await target.inputValue();
  await expect(answer).toContainText(calculated);
  // Opens on the calculated figure, with nothing to reset.
  const reset = page.getByRole('button', { name: 'Use the calculated amount' });
  await expect(reset).toHaveCount(0);
  // It follows the calculation while untouched.
  await page.getByLabel('What goes out a month', { exact: true }).fill('18000000');
  await expect(target).not.toHaveValue(calculated);
  const moved = await target.inputValue();
  await page.getByLabel('What goes out a month', { exact: true }).fill('17000000');
  await expect(target).toHaveValue(calculated);

  await target.fill('250000000');
  await expect(target).toHaveValue('250.000.000');
  await expect(answer).toContainText('Calculated');
  await expect(answer).toContainText(calculated);
  await expect(reset).toBeVisible();
  // Typed, so it stays put when the calculation moves.
  await page.getByLabel('What goes out a month', { exact: true }).fill('18000000');
  await expect(target).toHaveValue('250.000.000');
  await expect(answer).toContainText(moved);
  await page.getByLabel('What goes out a month', { exact: true }).fill('17000000');

  await reset.click();
  await expect(target).toHaveValue(calculated);
  await expect(answer).toContainText('Needed');
  await expect(reset).toHaveCount(0);

  await target.fill('250000000');
  await page.getByRole('button', { name: 'Set a goal' }).click();
  await page.getByRole('alertdialog', { name: 'Added to Goals' }).getByRole('button', { name: 'Open goal' }).click();
  await expect(page.getByTestId('goal-target')).toContainText('250.000.000');

  // Edit goal: the same setting, months greyed.
  await editGoal(page);
  await expect(page.getByLabel('Target amount')).toHaveValue('250.000.000');
  await expect(page.getByLabel('Months of outgoings')).toBeDisabled();
  await expect(page.getByLabel('Months of outgoings')).toHaveValue('not used');
  await expect(page.getByRole('button', { name: 'Use the calculated amount' })).toBeVisible();
  await page.getByLabel('Target amount').fill('300000000');
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await goalCard(page, 'Emergency fund');
  await expect(page.getByTestId('goal-target')).toContainText('300.000.000');

  // Still linked to its calculator: the working opens and carries the typed target.
  await editGoal(page);
  await page.getByRole('button', { name: 'Calculator' }).click();
  await expect(page.getByLabel('Target amount')).toHaveValue('300.000.000');
  await page.getByRole('button', { name: 'Use the calculated amount' }).click();
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.getByTestId('goal-target')).toContainText(calculated);

  // Edit goal again: following, months editable; type, then reset from the form.
  await editGoal(page);
  await expect(page.getByLabel('Months of outgoings')).toBeEnabled();
  await expect(page.getByLabel('Target amount')).toHaveValue(calculated);
  await page.getByLabel('Target amount').fill('260000000');
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await goalCard(page, 'Emergency fund');
  await expect(page.getByTestId('goal-target')).toContainText('260.000.000');
  await editGoal(page);
  await page.getByRole('button', { name: 'Use the calculated amount' }).click();
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await goalCard(page, 'Emergency fund');
  await expect(page.getByTestId('goal-target')).toContainText(calculated);
  // Still linked after all of it.
  await editGoal(page);
  await expect(page.getByRole('button', { name: 'Calculator' })).toBeVisible();
});

test('a hand-made goal has no Target amount row', async ({ page }) => {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByLabel('Kind', { exact: true }).selectOption({ label: 'Holiday' });
  await expect(page.getByLabel('Target amount')).toHaveCount(0);
});
