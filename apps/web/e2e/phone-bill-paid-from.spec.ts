import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { pickBillCategory } from './bill-form';

const SHOT = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/bill-paid-from.png';

test('on a phone: two accounts of one name are told apart in the Paid from sheet, for a new bill and an edit', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '12500000', extra: (p) => p.getByLabel('Account number', { exact: true }).fill('7788') });
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay', balance: '1200000' });
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay', balance: '85000' });

  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Netflix');
  await page.getByLabel('Amount', { exact: true }).fill('186000');
  await pickBillCategory(page);
  await page.getByLabel('Bill date').selectOption('1');

  await page.getByRole('button', { name: /^Paid from/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Paid from', exact: true });
  const goPays = sheet.getByRole('button', { name: /^GoPay/ });
  await expect(goPays).toHaveCount(2);
  // The digits lead where the account has them; the balance tells the namesakes apart.
  await expect(sheet.getByRole('button', { name: /^BCA Tahapan, ···· 7788 · Rp/ })).toBeVisible();
  const first = await goPays.nth(0).getAttribute('aria-label');
  const second = await goPays.nth(1).getAttribute('aria-label');
  expect(first).not.toBe(second);
  await page.screenshot({ path: SHOT });
  await goPays.filter({ hasText: /85\.000/ }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);

  // The bill's page reads the account it was saved with.
  await page.getByTestId('bill-row').filter({ hasText: 'Netflix' }).click();
  await expect(page.getByText('Paid from')).toBeVisible();

  // Editing: the sheet marks the chosen one, and another can be chosen.
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Edit' }).click();
  await page.getByRole('button', { name: /^Paid from/ }).click();
  await expect(sheet.getByRole('button', { name: /^GoPay.*85\.000/ })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: /^GoPay.*1\.200\.000/ }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);

  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Edit' }).click();
  await page.getByRole('button', { name: /^Paid from/ }).click();
  await expect(sheet.getByRole('button', { name: /^GoPay.*1\.200\.000/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: /^GoPay.*85\.000/ })).toHaveAttribute('aria-pressed', 'false');
});
