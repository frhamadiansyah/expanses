import { expect, type Page, test } from '@playwright/test';
import { openGoalForm } from './goals';
import { goalCard, goalRow } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Adds a goal from a template and leaves the browser on the goal's own page, where its move rows are. */
async function addFromTemplate(page: Page, template: string, amount?: string) {
  await page.goto('/goals');
  await openGoalForm(page, template);
  if (amount) {
    const cost = page.getByLabel(/Cost in today's money/).first();
    await cost.clear();
    await cost.pressSequentially(amount);
  }
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(goalRow(page, template)).toBeVisible();
  await expect((await goalCard(page, template)).getByRole('button', { name: `Move ${template} down` })).toBeVisible();
}

test('an emergency fund added after a holiday is listed first, and cannot be moved below it', async ({ page }) => {
  await addFromTemplate(page, 'Holiday', '15000000');
  await addFromTemplate(page, 'Emergency fund');

  await page.goto('/goals');
  await expect(page.getByTestId('goals-compulsory')).toContainText('Emergency fund');
  await expect(page.getByTestId('goals-additional')).toContainText('Holiday');

  await (await goalCard(page, 'Emergency fund')).getByRole('button', { name: 'Move Emergency fund down' }).click();
  await page.goto('/goals');
  await expect(page.getByTestId('goals-compulsory')).toContainText('Emergency fund');
  await expect(page.getByTestId('goals-compulsory')).not.toContainText('Holiday');
});
