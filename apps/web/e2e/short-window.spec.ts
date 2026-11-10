import { expect, test } from '@playwright/test';

/*
 * A short desktop window (landscape, under 500px tall) is not a phone held sideways: the sidebar stays, Cashflow stays
 * on screen and the full-screen table does not take over. Only a phone-sized width turns sideways.
 */
test('a short wide window keeps the sidebar and Cashflow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto('/transactions');
  // A fresh database runs its updates first, which takes a while on a busy machine.
  await expect(page.getByRole('heading', { name: 'Cashflow' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('aside')).toBeVisible();
  await expect(page.getByTestId('sideways-bar')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});
