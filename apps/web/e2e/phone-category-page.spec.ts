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

  await countsAs(page, 'Warung makan').selectOption('lifestyle');
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

test('a category of your own gets an icon, a colour and a parent from its page, and moves back to the top', async ({ page }) => {
  await page.goto('/categories');
  const tree = page.getByTestId('category-tree');
  page.once('dialog', (dialog) => void dialog.accept('Syalala'));
  await page.getByRole('button', { name: 'Add category' }).click();
  await tree.getByRole('link', { name: 'Syalala', exact: true }).click();
  const hero = page.getByTestId('category-hero');
  await expect(hero).toContainText('Syalala');
  await expect(hero).not.toContainText('in ');

  // Icon: searched for in Indonesian, picked, saved with ✓.
  await page.getByRole('button', { name: 'Icon for Syalala' }).click();
  const icons = page.getByRole('dialog', { name: 'Icon' });
  await expect(icons.getByRole('region', { name: 'Transport' })).toBeVisible();
  await icons.getByLabel('Search icons').fill('zzqx');
  await expect(icons.getByText('No icon by that name.')).toBeVisible();
  await icons.getByLabel('Search icons').fill('kopi');
  await expect(icons.getByRole('region', { name: 'Transport' })).toHaveCount(0);
  await icons.getByRole('button', { name: 'coffee', exact: true }).click();
  await expect(icons.getByRole('button', { name: 'coffee', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await icons.getByRole('button', { name: 'Save icon' }).click();
  await expect(icons).toHaveCount(0);
  await expect(hero.locator('svg.lucide-coffee')).toHaveCount(1);
  await expect(page.getByTestId('category-icon-row').locator('svg.lucide-coffee')).toHaveCount(1);

  // Colour: a swatch, saved with ✓; the hero's mark is drawn in it.
  await page.getByRole('button', { name: 'Colour for Syalala' }).click();
  const colours = page.getByRole('dialog', { name: 'Colour' });
  await expect(colours.getByRole('button', { name: 'Automatic' })).toHaveAttribute('aria-pressed', 'true');
  await colours.getByRole('button', { name: 'Violet' }).click();
  await colours.getByRole('button', { name: 'Save colour' }).click();
  await expect(colours).toHaveCount(0);
  await expect(page.getByTestId('category-colour-swatch')).toHaveAttribute('data-colour', '#7c3aed');
  await expect(hero.getByTestId('category-mark')).toHaveCSS('color', 'rgb(124, 58, 237)');

  // Parent: under Food and beverage. It is a subcategory now, so it has no colour of its own.
  await page.getByRole('button', { name: 'Parent of Syalala' }).click();
  const parents = page.getByRole('dialog', { name: 'Parent' });
  await expect(parents.getByRole('button', { name: 'None (top level)' })).toHaveAttribute('aria-pressed', 'true');
  await expect(parents.getByRole('button', { name: 'Restaurants' })).toHaveCount(0);
  await parents.getByRole('button', { name: 'Food and beverage' }).click();
  await parents.getByRole('button', { name: 'Save parent' }).click();
  await expect(parents).toHaveCount(0);
  await expect(hero).toContainText('in Food and beverage');
  await expect(page.getByRole('button', { name: 'Colour for Syalala' })).toHaveCount(0);
  await expect(page.getByTestId('category-parent-row')).toContainText('Food and beverage');

  // And back to the top: the caption goes, the Colour row returns — automatic, since the move dropped the pick.
  await page.getByRole('button', { name: 'Parent of Syalala' }).click();
  await parents.getByRole('button', { name: 'None (top level)' }).click();
  await parents.getByRole('button', { name: 'Save parent' }).click();
  await expect(hero).not.toContainText('in Food and beverage');
  // Back at the top the Colour row returns, the picked colour gone with the move: just the swatch, no word under it.
  await expect(page.getByRole('button', { name: 'Colour for Syalala' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Colour for Syalala' })).not.toContainText('Automatic');
});

test('a category with subcategories of its own cannot be filed under another', async ({ page }) => {
  await page.goto('/categories');
  await page.getByTestId('category-tree').getByRole('link', { name: 'Food and beverage', exact: true }).click();
  await page.getByRole('button', { name: 'Parent of Food and beverage' }).click();
  const parents = page.getByRole('dialog', { name: 'Parent' });
  await expect(parents.getByTestId('parent-blocked')).toContainText('Move or archive its subcategories first');
  await expect(parents.getByRole('button', { name: 'Transportation' })).toBeDisabled();
  await expect(parents.getByRole('button', { name: 'None (top level)' })).toBeEnabled();
  await parents.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('category-hero')).not.toContainText('in ');
});
