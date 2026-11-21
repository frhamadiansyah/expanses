import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment, saveButton, shareWith } from './add-transaction';
import { personRow } from './people';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** An invented bill, one Vision line per row. */
const BILL = ['WARUNG LAUT', '12/10/2026 19:40', 'Nasi goreng 45.000', 'Mie ayam 38.000', 'Sate (10) 60.000', 'Es teh x3 27.000', 'Service 5% 8.500', 'PPN 10% 17.850', 'TOTAL 196.350', 'TUNAI 200.000'].map((text, i) => ({
  text,
  box: [0.1, 0.05 + i * 0.05, 0.8, 0.03] as [number, number, number, number],
  height: 0.03,
}));

test('With → By receipt: read a bill, tag who had what, and the form comes back with each person’s amount', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions/new');
  const form = addForm(page);
  await form.getByRole('button', { name: 'Payment method' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();

  const { sheet } = await shareWith(page, form, [{ name: 'Dewi' }, { name: 'Sari' }]);
  await sheet.getByRole('radio', { name: 'By receipt' }).click();
  await expect(sheet.getByRole('button', { name: 'Choose a photo of the receipt' })).toBeVisible();
  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/step-0-with-by-receipt.png` });

  // One tap goes to the system picker (the hidden input); the picture is read on the phone, here by the injected reading.
  await page.evaluate((lines) => {
    window.__statementLines = [lines];
  }, BILL);
  await sheet.getByTestId('receipt-split-input').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });

  // Step 1 of the page: the dishes and charges, the printed total, nothing differing.
  await expect(page).toHaveURL(/\/transactions\/receipt-split$/);
  await expect(page.getByRole('heading', { name: 'Who had what' })).toBeVisible();
  await expect(page.getByTestId('receipt-item')).toHaveCount(4);
  await expect(page.getByTestId('receipt-printed')).toContainText('196.350');
  await expect(page.getByTestId('receipt-mismatch')).toHaveCount(0);
  await expect(page.getByTestId('receipt-item').first()).toContainText('Everyone');

  // Tag: Nasi goreng is Dewi's, Mie ayam is Me; the other two stay with everyone.
  await page.getByRole('button', { name: /^Nasi goreng/ }).click();
  await page.getByTestId('receipt-people').getByRole('button', { name: 'Dewi', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nasi goreng, Dewi' })).toBeVisible();
  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/step-1-who-had-what.png` });
  await page.getByRole('button', { name: /^Mie ayam/ }).click();
  await page.getByTestId('receipt-people').getByRole('button', { name: 'Me', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mie ayam, Me' })).toBeVisible();

  // Step 2: totals. Charges follow each person's food; the three add up to the receipt.
  await page.getByRole('button', { name: 'Totals' }).click();
  await expect(page.getByRole('heading', { name: 'Totals' })).toBeVisible();
  const total = (name: string) => page.locator(`[data-testid="receipt-person"][data-person="${name}"]`);
  await expect(total('Me')).toContainText('77.385');
  await expect(total('Dewi')).toContainText('85.470');
  await expect(total('Sari')).toContainText('33.495');
  await expect(total('Sari')).toContainText('2 items');
  await expect(page.getByTestId('receipt-bill')).toContainText('196.350');
  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/step-2-totals.png` });
  await page.getByTestId('receipt-use').click();

  // Back on the form: With is open on By receipt, filled as custom amounts, with the receipt row to edit.
  await expect(page).toHaveURL(/\/transactions\/new/);
  const withSheet = page.getByRole('dialog', { name: 'With', exact: true });
  await expect(withSheet.getByRole('radio', { name: 'By receipt' })).toBeChecked();
  await expect(withSheet.getByTestId('with-receipt')).toContainText('196.350');
  await expect(withSheet.getByTestId('with-your-share')).toHaveText('Rp 77.385');
  await expect(withSheet.getByTestId('with-summary')).toContainText('Rp 118.965');
  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/step-3-back-on-with.png` });

  // Edit reopens the same bill with the tags as left.
  await withSheet.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: 'Nasi goreng, Dewi' })).toBeVisible();
  await page.getByRole('button', { name: 'With', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'With', exact: true }).getByTestId('with-your-share')).toHaveText('Rp 77.385');

  // Nothing was saved until the form's own Save; then each person owes exactly their share.
  await page.getByRole('dialog', { name: 'With', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(addForm(page).getByLabel('Note')).toHaveValue('WARUNG LAUT');
  await saveButton(addForm(page)).click();
  await expect(addForm(page)).toHaveCount(0);
  await page.goto('/net-worth/lend-borrow');
  await expect(personRow(page, 'Dewi')).toContainText('85.470');
  await expect(personRow(page, 'Sari')).toContainText('33.495');
});

test('a bill whose items differ from the total says by how much, and the receipt total can be used', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions/new');
  const form = addForm(page);
  const { sheet } = await shareWith(page, form, [{ name: 'Dewi' }]);
  await sheet.getByRole('radio', { name: 'By receipt' }).click();
  const short = ['KEDAI', 'Bakso 22.000', 'Teh 8.000', 'TOTAL 35.000'].map((text, i) => ({ text, box: [0.1, 0.05 + i * 0.05, 0.8, 0.03] as [number, number, number, number], height: 0.03 }));
  await page.evaluate((lines) => {
    window.__statementLines = [lines];
  }, short);
  await sheet.getByTestId('receipt-split-input').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });

  await expect(page.getByTestId('receipt-mismatch')).toContainText('Items differ from the total by Rp 5.000');
  await expect(page.getByRole('button', { name: 'Totals' })).toBeDisabled();
  await page.screenshot({ path: `${process.env.SHOTS ?? test.info().outputDir}/mismatch.png` });
  await page.getByRole('button', { name: 'Use the receipt total' }).click();
  await expect(page.getByRole('button', { name: 'Totals' })).toBeEnabled();
  await page.getByRole('button', { name: 'Totals' }).click();
  await expect(page.getByTestId('receipt-bill')).toContainText('35.000');
  // Added an item for the missed line instead, with the sheet.
});

test('a photo with nothing to read says so and stays on the With sheet', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions/new');
  const { sheet } = await shareWith(page, addForm(page), [{ name: 'Dewi' }]);
  await sheet.getByRole('radio', { name: 'By receipt' }).click();
  await page.evaluate(() => {
    window.__statementLines = [[{ text: 'Selamat datang', box: [0.1, 0.1, 0.5, 0.03], height: 0.03 }]];
  });
  await sheet.getByTestId('receipt-split-input').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });
  await expect(sheet.getByRole('alert')).toHaveText('Nothing could be read from that photo');
  await expect(page).toHaveURL(/\/transactions\/new/);
});
