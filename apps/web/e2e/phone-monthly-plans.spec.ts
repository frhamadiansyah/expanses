import { expect, test } from '@playwright/test';
import { FUND, fundByMoney } from './fund-trade';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.clock.setSystemTime(new Date('2026-10-12T12:00:00+07:00'));
});

test('phone: a plan set on the holding is due on Recurring, recorded there, and reads bought', async ({ page }) => {
  await fundByMoney(page);
  await page.getByTestId('monthly-plan').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Amount (IDR)').fill('500000');
  await sheet.getByLabel('Every month on').selectOption('5');
  await sheet.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByTestId('monthly-plan')).toContainText('Rp 500.000 · 5th');

  await page.goto('/bills');
  const row = page.getByTestId('plan-row');
  await expect(row.getByTestId('plan-status')).toHaveText('Due on the 5th · from BCA');
  await page.getByRole('button', { name: `Record ${FUND}` }).click();
  await expect(sheet.getByLabel('What it cost, before fees (IDR)')).toHaveValue(/500\.000/);
  await sheet.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(row.getByTestId('plan-status')).toHaveText('Bought · 12 Oct');
  await expect(row).toContainText('Rp 500.000');
});
