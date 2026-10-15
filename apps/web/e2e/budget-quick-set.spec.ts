import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { capField, openEditBudgets } from './budget';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('a category that spent is a Set away from its cap, and the sheet opens ready to type', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Sample', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Corner shop', paidWith: 'Bank Sample', category: 'Personal care', amount: '85000' });

  await page.goto('/budget');
  await page.getByTestId('uncapped-Personal care').click();
  const sheet = page.getByRole('dialog', { name: 'Personal care' });
  const cap = sheet.getByLabel('Cap', { exact: true });
  await expect(cap).toBeFocused();
  // Spent so far is offered; taking it fills the Cap row, monthly.
  await sheet.getByRole('button', { name: 'Spent so far, 85.000' }).click();
  await expect(cap).toHaveValue('85.000');
  await sheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByTestId('line-Personal care')).toContainText('left of 85.000');
  await expect(page.getByTestId('uncapped-Personal care')).toHaveCount(0);

  // Opened again, the figure is selected: typing replaces it.
  await page.getByTestId('line-Personal care').click();
  const again = page.getByRole('dialog', { name: 'Personal care' }).getByLabel('Cap', { exact: true });
  await expect(again).toBeFocused();
  await page.keyboard.type('120000');
  await expect(again).toHaveValue('120.000');
});

test('Edit budgets sets several caps at once, counts a yearly one as its month, and Save brings them to the page', async ({ page }) => {
  await page.goto('/budget');
  const screen = await openEditBudgets(page);
  const care = await capField(screen, 'Personal care');
  await care.field.fill('300000');
  await care.field.press('Enter');
  const transport = await capField(screen, 'Transportation');
  await transport.field.fill('1200000');
  await screen.getByLabel(`${transport.label} every`).selectOption('yearly');
  await expect(screen.getByTestId('edit-budgeted')).toContainText('400.000');

  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('budget-page')).toBeVisible();
  await expect(page.getByTestId('line-Personal care')).toContainText('left of 300.000');
  await expect(page.getByTestId('line-Transportation')).toContainText('left of 100.000');
});

test('a cap of nothing keeps Edit budgets open, names its row, and saves none of the others', async ({ page }) => {
  await page.goto('/budget');
  const screen = await openEditBudgets(page);
  await (await capField(screen, 'Personal care')).field.fill('300000');
  const transport = await capField(screen, 'Transportation');
  await transport.field.fill('0');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(screen.getByRole('alert')).toContainText(`${transport.label}: A budget must be above zero`);
  await expect(page.getByTestId('edit-budgets')).toBeVisible();

  await page.goto('/budget');
  await expect(page.getByTestId('line-Personal care')).toHaveCount(0);
});

test('back from Edit budgets with changes asks first; without them it simply goes back', async ({ page }) => {
  await page.goto('/budget');
  await openEditBudgets(page);
  await page.getByRole('button', { name: /Budget/ }).first().click();
  await expect(page.getByTestId('budget-page')).toBeVisible();

  const screen = await openEditBudgets(page);
  await (await capField(screen, 'Personal care')).field.fill('50000');
  page.removeAllListeners('dialog');
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: /Budget/ }).first().click();
  await expect.poll(() => asked).toBe('Discard changes?');
  await expect(page.getByTestId('edit-budgets')).toBeVisible();
});
