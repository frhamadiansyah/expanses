import { expect, type Page, test } from '@playwright/test';
import { at, expectBalance, openDeposit, setUp } from './deposit-maturity';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Types into a box of the sheet one key at a time, as `typeInto` does on a page. */
async function typeInSheet(page: Page, label: string, text: string) {
  const box = page.getByRole('dialog').getByLabel(label, { exact: true });
  await box.click();
  await box.selectText();
  await box.press('Backspace');
  await box.pressSequentially(text, { delay: 20 });
}

test('breaks a deposit early with a penalty: the rest lands and the deposit closes', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await page.clock.setSystemTime(at('2026-09-01'));
  await openDeposit(page, s.depositName);
  await expect(page.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Break early' }).click();

  const sheet = page.getByRole('dialog', { name: 'Break early' });
  await expect(sheet.getByLabel('Into')).toHaveValue(/.+/);
  await expect(sheet).toContainText(s.payoutName);
  await expect(sheet.getByLabel('Date')).toHaveValue('2026-09-01');
  await expect(sheet.getByLabel('Principal')).toHaveValue('50000000');
  await expect(sheet.getByLabel('Interest', { exact: true })).toHaveValue('0');
  await expect(sheet.getByLabel('Tax withheld')).toHaveCount(0);
  await expect(sheet).toContainText('The penalty is posted as an expense under Fees & charges. The deposit is closed.');

  await typeInSheet(page, 'Penalty fee', '250.000');
  await expect(sheet.getByTestId('money-out-lands')).toContainText(`Lands in ${s.payoutName}`);
  await expect(sheet.getByTestId('money-out-lands')).toContainText('49.750.000');
  await sheet.getByRole('button', { name: 'Break early' }).click();

  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await expect(page.getByRole('link', { name: new RegExp(`^${s.depositName}`) })).toHaveCount(0);
  await expectBalance(page, s.payoutName, '50.750.000');
});

test('withdraws a matured deposit with its interest, less the tax withheld', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  // The deposit's term, so the interest is the whole term's.
  await page.getByLabel('Term', { exact: true }).selectOption('3');
  await expect(page.getByTestId('deposit-term')).toHaveAttribute('aria-busy', 'false');

  await page.clock.setSystemTime(at('2026-10-20'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Break early' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Withdraw' }).click();

  const sheet = page.getByRole('dialog', { name: 'Withdraw' });
  await expect(sheet.getByLabel('Principal')).toHaveValue('50000000');
  await expect(sheet.getByLabel('Interest', { exact: true })).toHaveValue('535616');
  await expect(sheet.getByLabel('Tax withheld')).toHaveValue('107123');
  await expect(sheet.getByLabel('Penalty fee')).toHaveCount(0);
  await expect(sheet).toContainText('Interest is income; the tax goes to the tax report. The deposit is closed.');
  await expect(sheet.getByTestId('money-out-lands')).toContainText('50.428.493');
  await sheet.getByRole('button', { name: 'Withdraw' }).click();

  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await expectBalance(page, s.payoutName, '51.428.493');
});

test('refuses a figure that does not add up, and posts nothing', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await page.clock.setSystemTime(at('2026-09-01'));
  await openDeposit(page, s.depositName);
  await page.getByRole('button', { name: 'Break early' }).click();
  const sheet = page.getByRole('dialog', { name: 'Break early' });
  await typeInSheet(page, 'Principal', '60.000.000');
  await sheet.getByRole('button', { name: 'Break early' }).click();
  await expect(sheet).toContainText('The deposit holds less than that');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expectBalance(page, s.payoutName, '1.000.000');
});
