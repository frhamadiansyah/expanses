import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, saveButton } from './add-transaction';
import { personRow } from './people';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** An invented bill, one Vision line per row. */
const BILL = ['WARUNG LAUT', '12/10/2026 19:40', 'Nasi goreng 45.000', 'Mie ayam 38.000', 'Sate (10) 60.000', 'Es teh x3 27.000', 'Service 5% 8.500', 'PPN 10% 17.850', 'TOTAL 196.350', 'TUNAI 200.000'].map((text, i) => ({
  text,
  box: [0.1, 0.05 + i * 0.05, 0.8, 0.03] as [number, number, number, number],
  height: 0.03,
}));

test('Account → Split a receipt: people, photo, tag, totals, Record this purchase fills New transaction', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  // The Default payer.
  await page.goto('/account');
  await page.getByRole('link', { name: /^Default/ }).click();
  await page.getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/account-row.png`, fullPage: true });
  await page.getByRole('link', { name: /^Split a receipt/ }).click();
  await expect(page.getByRole('heading', { name: 'Split a receipt' })).toBeVisible();
  const people = page.getByTestId('split-start-people');
  await expect(people.getByRole('button', { name: 'Me', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Names are added with the keyboard's Done, at the end of the row, picked.
  const search = page.getByLabel('Search or add a person');
  await search.fill('Dewi');
  await search.press('Enter');
  await search.fill('Sari');
  await search.press('Enter');
  await expect(people.getByRole('button', { name: 'Dewi', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(people.getByRole('button', { name: 'Sari', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/start-page.png` });

  await page.evaluate((lines) => {
    window.__statementLines = [lines];
  }, BILL);
  await page.getByTestId('receipt-split-input').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });
  await expect(page).toHaveURL(/\/transactions\/receipt-split$/);
  await expect(page.getByTestId('receipt-item')).toHaveCount(4);

  await page.getByRole('button', { name: /^Nasi goreng/ }).click();
  await page.getByTestId('receipt-people').getByRole('button', { name: 'Dewi', exact: true }).click();
  await page.getByRole('button', { name: /^Mie ayam/ }).click();
  await page.getByTestId('receipt-people').getByRole('button', { name: 'Me', exact: true }).click();
  await page.getByRole('button', { name: 'Totals' }).click();
  const total = (name: string) => page.locator(`[data-testid="receipt-person"][data-person="${name}"]`);
  await expect(total('Me')).toContainText('77.385');
  await expect(total('Dewi')).toContainText('85.470');
  await expect(total('Sari')).toContainText('33.495');
  await expect(page.getByTestId('receipt-use')).toHaveText('Record this purchase');
  await page.getByTestId('receipt-use').click();

  // New transaction, filled in; nothing saved yet.
  await expect(page).toHaveURL(/\/transactions\/new/);
  const form = addForm(page);
  await expect(form.getByRole('button', { name: 'Payment method' })).toContainText('BCA Tahapan');
  await expect(form.getByLabel('Note')).toHaveValue('WARUNG LAUT');
  await expect(page.getByRole('dialog', { name: 'With', exact: true })).toHaveCount(0);
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/recorded-form.png` });
  await page.getByRole('button', { name: 'With', exact: true }).click();
  const withSheet = page.getByRole('dialog', { name: 'With', exact: true });
  await expect(withSheet.getByTestId('with-your-share')).toHaveText('Rp 77.385');
  await expect(withSheet.getByTestId('with-summary')).toContainText('Rp 118.965');
  await withSheet.getByRole('button', { name: 'Close', exact: true }).click();

  await saveButton(addForm(page)).click();
  await expect(addForm(page)).toHaveCount(0);
  await page.goto('/net-worth/lend-borrow');
  await expect(personRow(page, 'Dewi')).toContainText('85.470');
  await expect(personRow(page, 'Sari')).toContainText('33.495');
});

test('a photo with nothing to read says so on the start page', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions/receipt-split/start');
  await expect(page.getByTestId('split-start-photo')).toBeEnabled();
  await page.evaluate(() => {
    window.__statementLines = [[{ text: 'Selamat datang', box: [0.1, 0.1, 0.5, 0.03], height: 0.03 }]];
  });
  await page.getByTestId('receipt-split-input').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('alert')).toHaveText('Nothing could be read from that photo');
  await expect(page).toHaveURL(/receipt-split\/start/);
});
