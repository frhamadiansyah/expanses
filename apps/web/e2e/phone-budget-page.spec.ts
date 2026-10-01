import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { setBudget } from './budget';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function spend(page: Page, what: string, category: string, amount: string) {
  await addTransaction(page, { description: what, paidWith: 'BCA Tahapan', category, amount });
}

test('a budget row leads with what is left or over, then what was spent and its share of the budget', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });

  await page.goto('/transactions');
  await spend(page, 'Warung Steak', 'Restaurants', '500000');
  await spend(page, 'Grab', 'Ride hailing', '120000');

  await page.goto('/budget');
  await setBudget(page, 'Food and beverage', '300000');
  // Saved before leaving: the budget screen already shows the month past it.
  await expect(page.getByTestId('line-Food and beverage')).toContainText('over by');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Against budget' }).click();
  await page.getByTestId('see-categories').click();

  const food = page.getByTestId('report-row').filter({ hasText: 'Food and beverage' });
  // How far past the budget leads the row; under it, what was spent and its share of the budget.
  await expect(food).toContainText(/Rp\s?200\.000 over/);
  await expect(food).toContainText(/Spent Rp\s?500\.000/);
  await expect(food).toContainText(/167% of Rp\s?300\.000/);

  // A category with no budget keeps the shape: its spend, and no share of a budget that does not exist.
  const transport = page.getByTestId('report-row').filter({ hasText: 'Transportation' });
  await expect(transport).toContainText('no budget');
  await expect(transport).not.toContainText('%');
});

test('by thumb: the ✓ on the cap sheet takes the tap it is given, even as the page opens', async ({ page }) => {
  /*
   * The ✓ is drawn before the workspace's books are read, and the books decide the currency a typed figure is parsed
   * in — so it is a real `disabled` button until then, which a tap waits for instead of vanishing into. The refusal it
   * must produce — "Choose a category", the sheet's own first check — is the proof it landed.
   */
  await page.goto('/budget');
  await page.getByRole('button', { name: 'More', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'Add a budget' }).tap();
  await page.getByRole('button', { name: 'Save budget' }).tap();
  await expect(page.getByRole('alert')).toHaveText('Choose a category');
  await page.getByRole('button', { name: 'Close' }).tap();

  // The same for the take-home, whose own empty case is worded rather than left to `parseMajor`.
  await page.getByRole('radiogroup', { name: 'Budget view' }).getByRole('radio', { name: 'Plan' }).tap();
  await page.getByTestId('income-line').tap();
  await page.getByRole('button', { name: 'Save take-home' }).tap();
  await expect(page.getByRole('alert')).toHaveText('The take-home is empty — type a figure');
});
