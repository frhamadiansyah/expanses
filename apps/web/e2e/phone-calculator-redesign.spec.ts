import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { localIsoDate } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the bar over the keyboard offers last month, the 3-month average and the year so far, and a tap fills the amount', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '90000000' });
  await page.goto('/transactions');
  const now = new Date();
  const lastMonth = localIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 15));
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '1200000', date: lastMonth });

  await page.goto('/calculators/emergency');
  const bar = page.getByRole('listbox', { name: 'Spending to fill from' });
  await expect(bar).toHaveCount(0);
  await page.getByLabel('What goes out a month', { exact: true }).click();
  await expect(bar.getByRole('option', { name: 'Last month, 1.200.000' })).toBeVisible();
  await expect(bar.getByRole('option', { name: /^3-month average, 1\.200\.000/ })).toBeVisible();
  await bar.getByRole('option', { name: 'Last month, 1.200.000' }).click();
  await expect(page.getByLabel('What goes out a month', { exact: true })).toHaveValue('1.200.000');
  // The field kept its focus, so the bar stays; another field takes it away.
  await expect(bar).toBeVisible();
  await page.getByLabel('Months of outgoings').click();
  await expect(bar).toHaveCount(0);

  // Retirement: a year of spending, three ways.
  await page.goto('/calculators/retirement');
  await page.getByLabel('Yearly spending in retirement', { exact: true }).click();
  const yearly = page.getByRole('listbox', { name: 'Spending to fill from' });
  await expect(yearly.getByRole('option', { name: 'Last month × 12, 14.400.000' })).toBeVisible();
  await yearly.getByRole('option', { name: 'Last month × 12, 14.400.000' }).click();
  await expect(page.getByLabel('Yearly spending in retirement', { exact: true })).toHaveValue('14.400.000');

  // Life cover: the yearly amount the family needs takes the same bar.
  await page.goto('/calculators/life-cover');
  await page.getByLabel('Yearly amount the family needs', { exact: true }).click();
  const family = page.getByRole('listbox', { name: 'Spending to fill from' });
  await family.getByRole('option', { name: 'Last month × 12, 14.400.000' }).click();
  await expect(page.getByLabel('Yearly amount the family needs', { exact: true })).toHaveValue('14.400.000');
});

test('a cost swipes left to delete', async ({ page }) => {
  await page.goto('/calculators/education');
  await expect(page.getByLabel('Cost 1 name')).toHaveValue('Enrollment');
  const row = page.getByLabel('Cost 1 name').locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]');
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 12;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from - (160 * step) / 10, y);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Delete Enrollment', exact: true }).click();
  await expect(page.getByLabel('Cost 1 name')).toHaveValue('Academic');
});
