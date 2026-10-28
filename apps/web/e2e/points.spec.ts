import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, saveCardTerms } from './card-section';

async function addCard(page: Page, name: string) {
  await openCard(page, { name });
}

test('points: bonus cap cascades to base rule and the recommender ranks by value', async ({ page }) => {
  await openCard(page, { name: 'CIMB Octo' });
  await addCard(page, 'BCA Visa');

  await page.goto('/wallet');
  await page.getByRole('link', { name: 'CIMB Octo' }).click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await page.getByRole('button', { name: 'Set up rewards' }).click();

  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Base');
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByLabel('Per spend').fill('2500');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();

  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('5x dining');
  await page.getByLabel('Points', { exact: true }).fill('5');
  await page.getByLabel('Per spend').fill('2500');
  await page.getByLabel('Only these categories').selectOption([{ label: 'Food and beverage (all)' }]);
  await page.getByLabel('Priority').fill('10');
  await page.getByLabel('Bonus cap: spend per cycle').fill('3000000');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('5 per Rp')).toBeVisible();

  // What a point fetches is the programme's, set on its page.
  await page.getByRole('button', { name: 'CIMB Octo', exact: true }).click();
  await cardPage(page, 'Points');
  await page.getByTestId('statement-points-programme').click();
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Value per point/ }).click();
  await page.getByLabel('1 point = Rp').fill('25');
  await page.getByRole('button', { name: 'Save value' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Value per point/ })).toContainText(/Rp\s25/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Wedding dinner', paidWith: 'CIMB Octo', category: 'Restaurants', amount: '3500000' });
  await expect(page.getByText('Wedding dinner')).toBeVisible();

  // 3,000,000 at 5/2,500 = 6,000 + 500,000 at 1/2,500 = 200
  await page.goto('/wallet');
  // As the balance of the programme the card earns into.
  // Points are a page of their own, from Wallet's corner, not a list under the cards.
  await expect(page.getByTestId('points-programmes')).toHaveCount(0);
  await page.getByRole('link', { name: 'Points', exact: true }).click();
  await expect(page).toHaveURL(/\/cards\/points$/);
  await expect(page.getByRole('region', { name: 'Points' }).getByRole('link', { name: /6\.200 points/ })).toBeVisible();
  // The programmes are a pile of faces, as Wallet's cards are; ＋ to add one is in the title's corner.
  await expect(page.getByRole('region', { name: 'Points' }).getByTestId('wallet-card')).toHaveCount(1);
  await page.locator('header').getByRole('button', { name: 'New programme' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/recommend');
  await page.getByLabel('Amount', { exact: true }).fill('100000');
  await page.getByLabel('Category').selectOption({ label: 'Restaurants' });
  await page.getByRole('button', { name: 'Compare cards' }).click();
  const best = page.locator('section', { hasText: 'Best' });
  await expect(best).toContainText('CIMB Octo');
  await expect(best).toContainText('40 pts');
  await expect(best).toContainText('1.00% back');
});
