import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { pickBillCategory, showRepeating } from './bill-form';
import { todayIn } from './today';

/** A yearly bill about five months ahead, saving up in BCA Savings; `saved` is its Already saved. */
async function addFundedBill(page: Page, name: string, saved: string, amount = '600000') {
  const [y, m, d] = (await todayIn(page)).split('-').map(Number) as [number, number, number];
  const at = new Date(y, m - 1, d + 150);
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await pickBillCategory(page);
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Repeats').selectOption('yearly');
  await page.getByLabel('Month', { exact: true }).selectOption(String(at.getMonth() + 1));
  await page.getByLabel('Due by').selectOption(String(at.getDate()));
  await page.getByRole('checkbox', { name: 'Save up for it' }).check();
  await page.getByLabel('Set aside in').selectOption({ label: 'BCA Savings' });
  if (saved) await page.getByRole('textbox', { name: 'Already saved' }).fill(saved);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await openAccount(page, { subtype: 'savings', name: 'BCA Savings', balance: '1000000' });
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
});

test('on a phone, a fund set up with Already saved shows Saved and History, an extra recalculates, a month can be skipped', async ({ page }) => {
  await addFundedBill(page, 'Land tax', '120000');
  await expect(page).toHaveURL(/\/bills$/);
  await showRepeating(page);
  await page.getByTestId('yearly-bill-row').filter({ hasText: 'Land tax' }).click();

  // Saved counts Already saved plus this month; History lists both.
  await expect(page.getByTestId('sinking-saved')).toContainText('of Rp');
  await expect(page.getByTestId('sinking-monthly')).toContainText('Rp');
  await expect(page.getByTestId('sinking-month')).toHaveCount(0);
  await expect(page.getByTestId('sinking-history')).toContainText('2 entries');
  const monthlyBefore = await page.getByTestId('sinking-monthly').innerText();

  // Put in extra: the sheet shows what it leaves, and the monthly figure falls.
  await page.getByRole('button', { name: 'Put in extra' }).click();
  const extra = page.getByRole('dialog', { name: 'Put in extra' });
  await extra.getByLabel(/^Amount/).fill('100000');
  await expect(extra.getByTestId('extra-after-monthly')).toContainText('was');
  await extra.getByRole('button', { name: 'Put in', exact: true }).click();
  await expect(extra).toHaveCount(0);
  await expect(page.getByTestId('sinking-history')).toContainText('3 entries');
  await expect(page.getByTestId('sinking-monthly')).not.toHaveText(monthlyBefore);

  // History: newest first, the running month marked, and the month can be skipped.
  await page.getByTestId('sinking-history').click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByTestId('history-extra')).toContainText('Put in extra');
  await expect(page.getByTestId('history-opening')).toContainText('Already saved, when set up');
  const month = page.locator('[data-testid^=history-month-]').first();
  await expect(month).toContainText('now');
  await expect(month).toContainText('Month 1 of');
  await month.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Skip this month' }).click();
  await expect(month).toContainText('Skipped');
  // And added again.
  await month.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Add this month again' }).click();
  await expect(month).toContainText('Month 1 of');
});

test('on a phone, a fund the account cannot hold is refused when saved, and so is an extra', async ({ page }) => {
  await addFundedBill(page, 'Land tax', '950000', '3000000');
  // 1.000.000 is held; 950.000 already saved and the first month's share is more than the free money.
  await expect(page.getByRole('alert')).toContainText(/BCA Savings has Rp\s.* free\. This fund needs Rp\s.* now\./);
  await expect(page).toHaveURL(/\/bills\/new/);

  await page.getByRole('textbox', { name: 'Already saved' }).fill('100000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await showRepeating(page);
  await page.getByTestId('yearly-bill-row').filter({ hasText: 'Land tax' }).click();

  await page.getByRole('button', { name: 'Put in extra' }).click();
  const extra = page.getByRole('dialog', { name: 'Put in extra' });
  await extra.getByLabel(/^Amount/).fill('900000');
  await expect(extra.getByTestId('extra-short')).toContainText(/BCA Savings has Rp\s.* free\. This fund needs Rp\s900\.000 now\./);
  await expect(extra.getByRole('button', { name: 'Put in', exact: true })).toBeDisabled();
});
