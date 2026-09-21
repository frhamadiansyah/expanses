import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addFromTemplate(page: Page, template: string, amount?: string) {
  await page.goto('/goals');
  await page.getByRole('button', { name: template, exact: true }).click();
  if (amount) {
    const cost = page.getByLabel(/Cost in today's money/).first();
    await cost.clear();
    await cost.pressSequentially(amount);
  }
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('button', { name: `Move ${template} down` })).toBeVisible();
}

test('an emergency fund added after a holiday is listed first, and cannot be moved below it', async ({ page }) => {
  await addFromTemplate(page, 'Holiday', '15000000');
  await addFromTemplate(page, 'Emergency fund');

  await expect(page.getByTestId('goals-compulsory')).toContainText('Emergency fund');
  await expect(page.getByTestId('goals-additional')).toContainText('Holiday');

  await page.getByRole('button', { name: 'Move Emergency fund down' }).click();
  await expect(page.getByTestId('goals-compulsory')).toContainText('Emergency fund');
  await expect(page.getByTestId('goals-compulsory')).not.toContainText('Holiday');
});
