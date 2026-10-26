import { expect, type Page, test } from '@playwright/test';

function answerPrompts(page: Page, answers: string[]) {
  const queue = [...answers];
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => void dialog.accept(dialog.type() === 'prompt' ? (queue.shift() ?? '') : ''));
}

const workspaceButton = (page: Page) => page.getByRole('button', { name: 'Workspace', exact: true });
const chooseWorkspace = async (page: Page, name: string) => {
  await workspaceButton(page).click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: name }).click();
  await expect(workspaceButton(page)).toContainText(name);
};

test('a set made in Personal moves to another workspace with its categories, and leaves Personal', async ({ page }) => {
  await page.goto('/categories/sets');
  await expect(page.getByTestId('set-Holiday')).toBeVisible();
  // With one workspace there is nowhere to move to, so the menu does not offer it.
  await page.getByRole('button', { name: 'More for Holiday' }).click();
  await expect(page.getByRole('menuitem', { name: 'Rename Holiday' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Move .* to another workspace$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto('/');
  await workspaceButton(page).click();
  await page.getByRole('button', { name: 'New workspace' }).click();
  const made = page.getByRole('dialog', { name: 'New workspace' });
  await made.getByLabel('Name', { exact: true }).fill('Business');
  await made.getByLabel('Starts with').selectOption({ label: 'Copy from Personal' });
  await made.getByRole('button', { name: 'Create workspace' }).click();
  await expect(workspaceButton(page)).toContainText('Business');
  await chooseWorkspace(page, 'Personal');

  await page.goto('/categories/sets');
  answerPrompts(page, ['Wedding', 'Catering', 'Venue']);
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByTestId('set-Wedding')).toBeVisible();
  await page.getByRole('button', { name: 'Add a category to Wedding' }).click();
  await page.getByRole('button', { name: 'Add a category to Wedding' }).click();
  await expect(page.getByTestId('set-Wedding')).toContainText('Venue');

  await page.getByRole('button', { name: 'More for Wedding' }).click();
  await page.getByRole('menuitem', { name: 'Move Wedding to another workspace' }).click();
  const sheet = page.getByRole('dialog', { name: 'Move Wedding' });
  await expect(sheet.getByTestId('move-set-target')).toHaveCount(1);
  await sheet.getByTestId('move-set-target').filter({ hasText: 'Business' }).click();

  // Asked first; Not now leaves it where it is.
  const ask = page.getByRole('alertdialog', { name: 'Move set' });
  await expect(ask).toContainText('Its categories, and the events using it, move with it.');
  await ask.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByTestId('set-Wedding')).toBeVisible();

  await page.getByRole('button', { name: 'More for Wedding' }).click();
  await page.getByRole('menuitem', { name: 'Move Wedding to another workspace' }).click();
  await page.getByRole('dialog', { name: 'Move Wedding' }).getByTestId('move-set-target').filter({ hasText: 'Business' }).click();
  await page.getByRole('alertdialog', { name: 'Move set' }).getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByTestId('set-copied')).toHaveText('Moved to Business');
  // Gone from Personal.
  await expect(page.getByTestId('set-Wedding')).toHaveCount(0);

  await chooseWorkspace(page, 'Business');
  await page.goto('/categories/sets');
  await expect(page.getByTestId('set-Wedding')).toContainText('Catering');
  await expect(page.getByTestId('set-Wedding')).toContainText('Venue');
});
