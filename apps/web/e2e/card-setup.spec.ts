import { expect, test } from '@playwright/test';

test('card setup guides billing date, then rewards, then a suggested base rule', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('Step Card');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();

  const accountRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Step Card', exact: true }) });
  await accountRow.getByRole('link', { name: 'Set up points' }).click();

  // Step 1: only card terms until the billing date exists.
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set up rewards' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0);

  await page.getByRole('navigation').getByRole('link', { name: 'Cards', exact: true }).click();
  const cardRow = page.locator('section', { has: page.getByRole('link', { name: 'Step Card', exact: true }) });
  await expect(cardRow).toContainText('Add billing date to see points');
  await cardRow.getByRole('link', { name: 'Step Card', exact: true }).click();

  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();

  // Step 2: rewards program.
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Set up rewards' }).click();

  // Step 3: first rule is pre-filled as a base rule.
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await expect(page.getByText('What points are worth')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add rule' }).click();
  await expect(page.getByLabel('Rule name')).toHaveValue('Base');
  await expect(page.getByLabel('Points', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Per spend (IDR)')).toHaveValue('2500');
  await page.getByRole('button', { name: 'Save rule' }).click();

  await expect(page.getByText('1 per Rp')).toBeVisible();
  await expect(page.getByText('Step 3 of 3')).toHaveCount(0);
  await expect(page.getByText('What points are worth')).toBeVisible();
});
