import { expect, type Page, test } from '@playwright/test';

async function addCard(page: Page, name: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name })).toBeVisible();
}

// The menu is the navigation landmark: a card page's own way back is also named "Cards", above its title.
const menu = (page: Page, name: string) => page.getByRole('navigation').getByRole('link', { name, exact: true }).click();

// Regression: with exactly one card, the card page and the cards list shared a query cache key
// holding different data shapes, so returning to Cards through the menu crashed the page.
test('menu navigation between a card page and the cards list keeps working', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') crashes.push(m.text());
  });

  await addCard(page, 'Only Card');

  await menu(page, 'Cards');
  await page.getByRole('link', { name: 'Only Card' }).first().click();
  await expect(page.getByText('Card terms')).toBeVisible();
  await menu(page, 'Cards');
  await expect(page.getByRole('heading', { name: 'Cards & points' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Only Card' }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Only Card' }).first().click();
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByRole('button', { name: 'Set up rewards' }).click();
  await expect(page.getByRole('button', { name: 'Add rule' })).toBeVisible();
  await menu(page, 'Cards');
  await expect(page.getByRole('heading', { name: 'Cards & points' })).toBeVisible();
  // Scope to the card's own row: the page heading "Cards & points" would also match a bare /points$/.
  const row = page.locator('section', { has: page.getByRole('link', { name: 'Only Card' }) });
  await expect(row).toContainText(/\d+ points/);
  await expect(row).not.toContainText('Rewards not set up');

  expect(crashes).toEqual([]);
});
