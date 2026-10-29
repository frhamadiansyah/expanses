import { expect, test } from '@playwright/test';
import { twoLevelsWalk } from './education-walk';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('two levels, a once fee and a yearly one, and a level added later raises the target', async ({ page }) => {
  await twoLevelsWalk(page);
});

test('a cost name wears a pencil, and a blank start says nothing until it is touched or Set a goal is tried', async ({ page }) => {
  await page.goto('/calculators/education');
  // The pencil says the name can be edited: one on each of the three costs, and one more on an added cost.
  for (const index of [1, 2, 3]) await expect(page.getByTestId(`cost-${index}-pencil`)).toBeVisible();
  await page.getByRole('button', { name: /^Add a cost/ }).click();
  await expect(page.getByTestId('cost-4-pencil')).toBeVisible();

  // Nothing typed yet: no start or end sentence anywhere.
  await expect(page.getByText(/needs (a|an) (start|end)|must be a whole number/)).toHaveCount(0);

  // A year typed and emptied again is named, in the level's own words.
  await page.getByLabel('Years from').fill('2');
  await page.getByLabel('Years from').fill('');
  await expect(page.getByText('Preschool needs a start year')).toBeVisible();
  await page.getByLabel('Years from').fill('2032,5');
  await expect(page.getByText('Preschool start must be a whole number')).toBeVisible();
  await page.getByLabel('Years from').fill('2032');
  await expect(page.getByText(/Preschool (needs|start)/)).toHaveCount(0);

  // The end, untouched, is named once Set a goal is tried.
  await page.getByRole('button', { name: 'Set a goal' }).click();
  await expect(page.getByText('Preschool needs an end year')).toBeVisible();
});
