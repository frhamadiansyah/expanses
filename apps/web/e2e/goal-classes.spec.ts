import { expect, type Page, test } from '@playwright/test';
import { openGoalForm } from './goals';
import { goalRow } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Adds a goal from a template; the save lands as a row on the list, and the goal keeps to its own section. */
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
}

test('an emergency fund added after a holiday is listed under compulsory, and the holiday under additional', async ({ page }) => {
  await addFromTemplate(page, 'Holiday', '15000000');
  await addFromTemplate(page, 'Emergency fund');

  // The sections are the ranking now: the move rows that once sat on a goal's page are gone.
  await page.goto('/goals');
  await expect(page.getByTestId('goals-compulsory')).toContainText('Emergency fund');
  await expect(page.getByTestId('goals-compulsory')).not.toContainText('Holiday');
  await expect(page.getByTestId('goals-additional')).toContainText('Holiday');
});
