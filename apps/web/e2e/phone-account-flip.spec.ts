import { expect, test } from '@playwright/test';
import { openAccount, openWalletAccount } from './accounts';

test('by thumb: tap the card for the balance, tap again for the card', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '12500000' });
  await openWalletAccount(page, 'Everyday');
  const raised = page.getByRole('region', { name: 'Cards' }).locator('[data-place="raised"]');
  const back = page.getByTestId('balance-card');
  await expect(back).toBeHidden();
  const face = (await raised.boundingBox())!;

  await page.getByRole('button', { name: /, show balance$/ }).tap();
  await expect(back).toBeVisible();
  await expect(back.getByTestId('card-figure')).toContainText('12.500.000');
  await expect(back).toContainText('30 days ago');
  // Measured once the turn has landed: mid-turn the card is edge-on.
  await expect.poll(async () => { const now = (await back.boundingBox())!; return Math.max(Math.abs(now.width - face.width), Math.abs(now.height - face.height)); }).toBeLessThanOrEqual(1);
  const box = (await back.boundingBox())!;
  expect(Math.abs(box.height - face.height)).toBeLessThanOrEqual(1);
  // The whole card inside the screen, and the page does not scroll sideways.
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // The balance is drawn once on the page.
  await expect(page.getByTestId('card-figure')).toHaveCount(1);

  await page.getByRole('button', { name: /, show card$/ }).tap();
  await expect(back).toBeHidden();
  await expect(raised.getByTestId('card-face')).toBeVisible();
});
