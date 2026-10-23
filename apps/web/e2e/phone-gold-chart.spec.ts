import { expect, test } from '@playwright/test';
import { fakeWorldGold, goldBoughtLately, openChart } from './gold-chart';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('phone: Chart sits between Sell and Price and draws the buy on the world price', async ({ page }) => {
  await fakeWorldGold(page);
  await goldBoughtLately(page);
  const sheet = await openChart(page);
  await expect(sheet.getByRole('radiogroup', { name: 'Range' }).getByRole('radio', { name: '1Y' })).toHaveAttribute('aria-checked', 'true');
  await expect(sheet.getByTestId('gold-dot')).toHaveCount(1);
  await expect(sheet.getByLabel('Average bought at')).toHaveText(/Rp\s2\.000\.000\/g/);
  await page.screenshot({ path: test.info().outputPath('gold-chart-phone.png') });
  // Drawn in the kit's tokens, so dark mode is the same sheet in its own colours.
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(sheet.getByTestId('gold-dot')).toHaveCount(1);
  await page.screenshot({ path: test.info().outputPath('gold-chart-phone-dark.png') });
});
