import { expect, type Page, test } from '@playwright/test';
import { addTransaction } from './add-transaction';

async function addCard(page: Page, name: string) {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

test('points: bonus cap cascades to base rule and the recommender ranks by value', async ({ page }) => {
  await page.goto('/accounts');
  await addCard(page, 'CIMB Octo');
  await addCard(page, 'BCA Visa');

  await page.goto('/cards');
  await page.getByRole('link', { name: 'CIMB Octo' }).click();
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByRole('button', { name: 'Set up rewards' }).click();

  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Base');
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByLabel('Per spend (IDR)').fill('2500');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();

  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('5x dining');
  await page.getByLabel('Points', { exact: true }).fill('5');
  await page.getByLabel('Per spend (IDR)').fill('2500');
  await page.getByLabel('Only these categories').selectOption([{ label: 'Food and beverage (all)' }]);
  await page.getByLabel('Priority').fill('10');
  await page.getByLabel('Bonus cap: spend per cycle (IDR)').fill('3000000');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('5 per Rp')).toBeVisible();

  await page.getByLabel('Points redeemed').fill('1');
  await page.getByLabel('Worth').fill('25');
  await page.getByRole('button', { name: 'Add value' }).click();
  await expect(page.getByText('= Rp')).toBeVisible();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Wedding dinner', paidWith: 'CIMB Octo', category: 'Restaurants', amount: '3500000' });
  await expect(page.getByText('Wedding dinner')).toBeVisible();

  // 3,000,000 at 5/2,500 = 6,000 + 500,000 at 1/2,500 = 200
  await page.goto('/cards');
  await expect(page.getByText('6.200 points')).toBeVisible();

  await page.goto('/recommend');
  await page.getByLabel('Amount (IDR)').fill('100000');
  await page.getByLabel('Category').selectOption({ label: 'Restaurants' });
  await page.getByRole('button', { name: 'Compare cards' }).click();
  const best = page.locator('section', { hasText: 'Best' });
  await expect(best).toContainText('CIMB Octo');
  await expect(best).toContainText('40 pts');
  await expect(best).toContainText('1.00% back');
});
