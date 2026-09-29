import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { countsAs, expectNeed, openCategory } from './categories';

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
  await expectNeed(page, 'Warung makan', 'Lifestyle', 'Set here');
  await expect(page.getByRole('button', { name: 'Clear the mark on Warung makan' })).toBeVisible();

  await page.getByRole('link', { name: 'Categories' }).first().click();
  await expect(page).toHaveURL(/\/categories$/);
  await tree.getByRole('link', { name: 'Warung makan', exact: true }).click();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'More' }).click();
  // A built-in category cannot be deleted — it would come back on the next start — and the greyed line says so.
  const builtInDelete = page.getByRole('menuitem', { name: /^Delete category/ });
  await expect(builtInDelete).toBeDisabled();
  await expect(builtInDelete).toContainText('Built in, so it would come back. Archive it instead.');
  await expect(page.getByRole('menuitem', { name: 'Archive category' })).not.toHaveClass(/ph-alarm/);
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

test('a category nothing uses can be deleted from its page; one with a transaction can only be archived', async ({ page }) => {
  await page.goto('/categories');
  const tree = page.getByTestId('category-tree');
  page.once('dialog', (dialog) => void dialog.accept('Syalala'));
  await page.getByRole('button', { name: 'Add category' }).click();
  await tree.getByRole('link', { name: 'Syalala', exact: true }).click();
  await expect(page.getByTestId('category-hero')).toContainText('Syalala');

  await page.getByRole('button', { name: 'More' }).click();
  const remove = page.getByRole('menuitem', { name: /^Delete category/ });
  await expect(remove).toBeVisible();
  await expect(remove).not.toHaveClass(/ph-alarm/);
  await expect(remove.locator('svg.lucide-trash2, svg.lucide-trash-2')).toHaveCount(1);
  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await remove.click();
  await expect(page).toHaveURL(/\/categories$/);
  expect(asked).toBe("Delete Syalala? This can't be undone.");
  await expect(tree.getByRole('link', { name: 'Syalala', exact: true })).toHaveCount(0);
  await expect(tree.getByRole('link', { name: 'Food and beverage', exact: true })).toBeVisible();

  // A second one, spent in: its menu holds only Archive.
  page.once('dialog', (dialog) => void dialog.accept('Syalala'));
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(tree.getByRole('link', { name: 'Syalala', exact: true })).toBeVisible();
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await addTransaction(page, { description: 'Kopi', paidWith: 'BCA Tahapan', category: 'Syalala', amount: '25000' });
  await page.goto('/categories');
  await tree.getByRole('link', { name: 'Syalala', exact: true }).click();
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem', { name: 'Archive category' })).toBeVisible();
  // Greyed, with the reason under it, rather than missing.
  const usedDelete = page.getByRole('menuitem', { name: /^Delete category/ });
  await expect(usedDelete).toBeDisabled();
  await expect(usedDelete).toContainText('Used by a transaction.');
});

test('a merchant category code is typed in the app’s own sheet, names itself as it is typed, and resets to the built-in one', async ({ page }) => {
  await openCategory(page, 'Restaurants');
  const mcc = page.getByTestId('category-mcc');
  await expect(mcc).toContainText('5812');

  await page.getByRole('button', { name: 'Merchant category code for Restaurants' }).click();
  const sheet = page.getByRole('dialog', { name: 'Merchant category code' });
  const field = sheet.getByRole('textbox', { name: 'Merchant category code for Restaurants' });
  await field.fill('58');
  // The two digits still to come show as faint 0s in the field itself, with no sentence under it.
  await expect(sheet.getByTestId('mcc-ghost')).toHaveText('5800');
  await expect(sheet).not.toContainText('Keep typing');
  await expect(sheet.getByRole('button', { name: /^5814, / })).toBeVisible();
  await field.fill('5814');
  await expect(sheet.getByTestId('mcc-meaning')).toHaveText('Fast Food Restaurants');
  await sheet.getByRole('button', { name: 'Save merchant category code' }).click();
  await expect(mcc).toContainText('5814');

  // Reopened on a code of your own: what it would be without it, and the way back.
  await page.getByRole('button', { name: 'Merchant category code for Restaurants' }).click();
  await expect(sheet).toContainText('Without it: 5812');
  await sheet.getByRole('button', { name: /^Reset to built-in/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(mcc).toContainText('5812');
});

test('a top-level category made from Select category can take a colour; one inside another cannot', async ({ page }) => {
  await page.goto('/transactions/new');
  await page.getByRole('button', { name: 'Category' }).click();
  const sheet = page.getByRole('dialog', { name: 'Select category' });
  await sheet.getByRole('button', { name: 'New category' }).click();
  const made = page.getByRole('dialog', { name: 'New expense category' });
  const circle = made.getByRole('button', { name: 'Icon and colour' });
  const look = page.getByRole('dialog', { name: 'Icon and colour' });
  // With a parent, it is drawn in a shade of the parent's colour, so its look offers icons only.
  await made.getByLabel('Parent', { exact: true }).selectOption({ label: 'Food and beverage' });
  await circle.click();
  await expect(look.getByTestId('new-category-icons')).toBeVisible();
  await expect(look.getByTestId('new-category-colours')).toHaveCount(0);
  await look.getByRole('button', { name: 'New expense category' }).click();
  // At the top it takes a colour of its own, chosen on the same step as its icon.
  await made.getByLabel('Parent', { exact: true }).selectOption('top-level');
  await made.getByLabel('Name', { exact: true }).fill('Pets');
  await circle.click();
  await look.getByTestId('new-category-colours').getByRole('button', { name: 'Teal' }).click();
  await look.getByRole('button', { name: 'Done' }).click();
  // Spending is asked here too, and kept.
  await expect(made.getByRole('combobox', { name: 'Spending for Pets' })).toHaveValue('essential');
  await made.getByRole('combobox', { name: 'Spending for Pets' }).selectOption('lifestyle');
  await made.getByRole('button', { name: 'Save' }).click();
  // Saved and chosen before the page is left.
  await expect(page.getByRole('button', { name: /Category/ }).first()).toContainText('Pets');

  await openCategory(page, 'Pets');
  await expect(page.getByTestId('category-colour-swatch')).toHaveAttribute('data-colour', '#0d9488');
  await expect(countsAs(page, 'Pets')).toHaveValue('lifestyle');
});
