import { expect, type Page, test } from '@playwright/test';

function answerPrompts(page: Page, answers: string[]) {
  const queue = [...answers];
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => void dialog.accept(dialog.type() === 'prompt' ? (queue.shift() ?? '') : ''));
}

test('a set made in Personal can be copied to another workspace, where it shows with its categories', async ({ page }) => {
  await page.goto('/categories/sets');
  // With one workspace there is nowhere to copy to, so the menu does not offer it.
  await expect(page.getByTestId('set-Holiday')).toBeVisible();
  await page.getByRole('button', { name: 'More for Holiday' }).click();
  await expect(page.getByRole('menuitem', { name: 'Rename Holiday' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^Copy .* to another workspace$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.goto('/');
  await page.getByRole('link', { name: 'App settings', exact: true }).click();
  await page.getByTestId('add-workspace').click();
  await page.getByTestId('new-workspace').click();
  const made = page.getByRole('dialog', { name: 'New workspace' });
  await made.getByLabel('Name', { exact: true }).fill('Business');
  await made.getByLabel('Starts with').selectOption({ label: 'Copy from Personal' });
  await made.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Business');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: 'Personal' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Personal');

  await page.goto('/categories/sets');
  answerPrompts(page, ['Wedding', 'Catering', 'Venue']);
  await page.getByRole('button', { name: 'Add set' }).click();
  await expect(page.getByTestId('set-Wedding')).toBeVisible();
  await page.getByRole('button', { name: 'Add a category to Wedding' }).click();
  await page.getByRole('button', { name: 'Add a category to Wedding' }).click();
  await expect(page.getByTestId('set-Wedding')).toContainText('Venue');

  await page.getByRole('button', { name: 'More for Wedding' }).click();
  await page.getByRole('menuitem', { name: 'Copy Wedding to another workspace' }).click();
  const sheet = page.getByRole('dialog', { name: 'Copy Wedding' });
  await expect(sheet.getByTestId('copy-set-target')).toHaveCount(1);
  await sheet.getByTestId('copy-set-target').filter({ hasText: 'Business' }).click();
  await expect(page.getByTestId('set-copied')).toHaveText('Copied to Business');

  // Switch to Business: the copy is there with its categories, and Personal keeps its own.
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: 'Business' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Business');
  await page.goto('/categories/sets');
  await expect(page.getByTestId('set-Wedding')).toContainText('Catering');
  await expect(page.getByTestId('set-Wedding')).toContainText('Venue');
});
