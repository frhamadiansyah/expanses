import { expect, test } from '@playwright/test';
import { countsAs, expectNeed } from './categories';

test('the list is only names; a subcategory opens its page, where it is renamed, marked and archived', async ({ page }) => {
  await page.goto('/categories');
  const tree = page.getByTestId('category-tree');
  await expect(tree.getByRole('link', { name: 'Restaurants', exact: true })).toBeVisible();
  // Nothing on the list but the categories themselves: every change lives on a category's own page.
  for (const word of ['MCC', 'Reset', 'Lifestyle', 'Essential', 'Clear mark', '+ Sub', 'Rename', 'Archive']) {
    await expect(tree.getByText(word, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /^(Rename|Archive|Mark) / })).toHaveCount(0);

  // 🔍 in the corner opens Cashflow's search in the title's row; it narrows the tree the way the picker's does,
  // and closing it brings the whole tree back.
  await expect(page.getByLabel('Search categories')).toHaveCount(0);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByLabel('Search categories')).toBeFocused();
  await page.getByLabel('Search categories').fill('restau');
  await expect(tree.getByRole('link')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.getByLabel('Search categories')).toHaveCount(0);
  await expect(tree.getByRole('link', { name: 'Restaurants', exact: true })).toBeVisible();

  await tree.getByRole('link', { name: 'Restaurants', exact: true }).click();
  await expect(page).toHaveURL(/\/categories\/[^/]+$/);
  await expect(page.getByTestId('category-hero')).toContainText('in Food and beverage');

  page.once('dialog', (dialog) => void dialog.accept('Warung makan'));
  await page.getByRole('button', { name: 'Rename Restaurants' }).click();
  await expect(page.getByTestId('category-hero')).toContainText('Warung makan');

  await countsAs(page, 'Warung makan').getByRole('radio', { name: 'Lifestyle' }).click();
  await expectNeed(page, 'Warung makan', 'Lifestyle', 'Marked by you');
  await expect(page.getByRole('button', { name: 'Clear the mark on Warung makan' })).toBeVisible();

  await page.getByRole('link', { name: 'Categories' }).first().click();
  await expect(page).toHaveURL(/\/categories$/);
  await tree.getByRole('link', { name: 'Warung makan', exact: true }).click();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Archive category' }).click();
  await expect(page).toHaveURL(/\/categories$/);
  await expect(tree.getByRole('link', { name: 'Food and beverage', exact: true })).toBeVisible();
  await expect(tree.getByRole('link', { name: 'Warung makan', exact: true })).toHaveCount(0);
});
