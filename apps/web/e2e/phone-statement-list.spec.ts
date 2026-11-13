import { expect, test } from '@playwright/test';
import { expectWalletFigure, openAccount, openWalletAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { screenshotFiles, setStatementImages, walletListLines } from './statement';

/*
 * A wallet's transaction list, checked from screenshots: any account, not only a card. Today is pinned to 20 September
 * 2026. Every name, reference and figure is invented.
 */
const TODAY = new Date('2026-09-20T12:00:00');

const LIST = [
  ['Noodle Stall', 'TRX20260919A1B2C3', '19 Sep 2026 12:31', '−Rp41.000', 'Wallet balance'],
  ['Top up from bank', 'TRX20260918D4E5F6', '18 Sep 2026 09:05', '+Rp1.000.000', 'Bank transfer'],
  ['Cashback ride', 'TRX20260917G7H8J9', '17 Sep 2026 18:20', '41', 'Coins'],
  ['Transfer to Person A', 'TRX20260916K1L2M3', '16 Sep 2026 15:00', '−Rp10.500', 'Wallet balance'],
  ['Tea Shop', 'TRX20260915N4P5Q6', '15 Sep 2026 08:10', '−Rp9.000', 'Wallet balance'],
] as const;

test('a wallet list travels from screenshots to recorded rows, and a second run finds them all recorded', async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet Satu', balance: '500000', opened: '2026-09-01' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Noodle Stall', paidWith: 'Dompet Satu', category: 'Cafe & dessert', amount: '41000', date: '2026-09-19' });
  await addTransaction(page, { description: 'Tea Shop', paidWith: 'Dompet Satu', category: 'Cafe & dessert', amount: '8000', date: '2026-09-15' });
  await addTransaction(page, { description: 'Bus fare', paidWith: 'Dompet Satu', category: 'Cafe & dessert', amount: '5000', date: '2026-09-18' });

  const check = async () => {
    await openWalletAccount(page, 'Dompet Satu');
    await page.getByTestId('check-statement').click();
    await expect(page.getByRole('heading', { name: 'Check statement' })).toBeVisible();
    await setStatementImages(page, [walletListLines(LIST)]);
    await page.getByTestId('statement-files').setInputFiles(screenshotFiles(1));
    await expect(page.getByTestId('statement-shot')).toHaveCount(1);
    await page.getByTestId('list-read').click();
    await expect(page.getByRole('heading', { name: 'Dompet Satu statement' })).toBeVisible();
  };

  await check();
  // The coins cashback is left out entirely: not read as a row, not counted, not listed.
  await expect(page.getByTestId('list-headline')).toContainText('4 rows read');
  await expect(page.getByTestId('count-recorded')).toHaveText(/^Already recorded1›?$/);
  await expect(page.getByTestId('count-new')).toHaveText(/^New — record here2›?$/);
  await expect(page.getByTestId('count-differs')).toHaveText(/^Amount differs1›?$/);
  await expect(page.getByTestId('count-skipped')).toHaveCount(0);
  await expect(page.getByTestId('count-not-listed')).toHaveText(/^Recorded, not on this list1›?$/);
  await page.screenshot({ path: 'test-results/list-summary.png' });

  await page.getByTestId('count-not-listed').click();
  await expect(page.getByTestId('not-listed-row')).toContainText('Bus fare');
  await page.getByRole('button', { name: 'Dompet Satu statement' }).click();

  await page.getByTestId('count-new').click();
  await expect(page.getByTestId('new-row')).toHaveCount(2);
  await expect(page.getByTestId('new-row').first()).toContainText('+Rp');
  await page.screenshot({ path: 'test-results/list-new.png' });
  // The icon fixes the category in two taps, as on a Cashflow row; No category takes it back.
  const transfer = page.getByTestId('new-row').filter({ hasText: 'Transfer to Person A' });
  await page.getByRole('button', { name: 'Category for Transfer to Person A' }).click();
  await page.getByRole('dialog', { name: 'Transfer to Person A' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await expect(transfer).toContainText('Restaurants');
  await page.getByRole('button', { name: 'Category for Transfer to Person A' }).click();
  await page.getByRole('dialog', { name: 'Transfer to Person A' }).getByTestId('category-none').click();
  await expect(transfer).toContainText('Choose a category');

  // The rest of the row opens the full Add screen on it; its ✓ writes the row back and posts nothing.
  await transfer.click();
  const form = page.getByRole('form', { name: 'Edit Transfer to Person A' });
  await expect(form.getByLabel('Note')).toHaveValue('Transfer to Person A');
  // Only what a row carries: no Add more details, no receipt camera, no split, no online or offline on the Note.
  await expect(page.getByRole('button', { name: /Add more details/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'More details' })).toHaveCount(0);
  await expect(form.getByTestId('amount-photos')).toHaveCount(0);
  await form.getByRole('button', { name: /^Category/ }).click();
  await expect(page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Split between categories' })).toHaveCount(0);
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Close' }).click();
  // A transfer offers no fee row either.
  await form.getByRole('tab', { name: 'Transfer' }).or(form.getByRole('radio', { name: 'Transfer' })).click();
  await expect(form.getByText('Fee', { exact: true })).toHaveCount(0);
  await form.getByRole('tab', { name: 'Expense' }).or(form.getByRole('radio', { name: 'Expense' })).click();
  await page.screenshot({ path: 'test-results/list-sheet.png' });
  await form.getByLabel('Note').fill('Transfer to Person A, lunch');
  await page.getByRole('button', { name: 'Save row' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('new-row').filter({ hasText: 'Transfer to Person A, lunch' })).toContainText('Choose a category');
  await expect(page.getByTestId('record-new')).toHaveText('Record 2');
  await page.getByTestId('record-new').click();

  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByText('Added 2', { exact: true })).toBeVisible();
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Dompet Satu', '1.435.500');

  // The same screenshots again: what was recorded is now recorded.
  await check();
  await expect(page.getByTestId('count-recorded')).toHaveText(/^Already recorded3›?$/);
  await expect(page.getByTestId('count-new')).toHaveText(/^New — record here0›?$/);
  await expect(page.getByTestId('count-differs')).toHaveText(/^Amount differs1›?$/);
});

test('screenshots picked from Photos reach the account choice and then the list check', async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet Satu', balance: '500000', opened: '2026-09-01' });
  await page.goto('/review');
  await page.waitForFunction(() => typeof window.__captureInject === 'function');
  const captures = ['one', 'two'].map((id) => ({
    id: `list-${id}`,
    kind: 'shared-image' as const,
    capturedAt: '2026-09-20T10:00:00+07:00',
    app: null,
    title: null,
    body: null,
    lines: walletListLines(LIST.slice(id === 'one' ? 0 : 2)),
    imageFile: `captures/list-${id}.png`,
  }));
  await page.evaluate((pick) => {
    (window.__photoPicks ??= []).push(pick);
  }, { captures, images: {} });
  await page.getByRole('button', { name: 'Scan a receipt' }).first().click();
  await page.getByRole('menu', { name: 'Scan a receipt' }).getByRole('menuitem', { name: 'Choose from Photos' }).click();
  await expect(page.getByRole('heading', { name: 'Which account?' })).toBeVisible();
  await page.getByTestId('statement-account').filter({ hasText: 'Dompet Satu' }).click();
  await expect(page.getByRole('heading', { name: 'Dompet Satu statement' })).toBeVisible();
  // Three entries overlap between the two pictures and count once.
  await expect(page.getByTestId('list-headline')).toContainText('4 rows read');
  await expect(page.getByTestId('count-new')).toHaveText(/^New — record here4›?$/);
  await expect(page.getByTestId('count-skipped')).toHaveCount(0);
});

test('rows older than the day the account is counted from are recorded as past, and the balance stays', async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  // Opened on the 18th: the 15th row is past; the 18th and 19th are not.
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet Satu', balance: '500000', opened: '2026-09-18' });
  await page.clock.setSystemTime(TODAY);
  await openWalletAccount(page, 'Dompet Satu');
  await page.getByTestId('check-statement').click();
  await setStatementImages(page, [walletListLines(LIST)]);
  await page.getByTestId('statement-files').setInputFiles(screenshotFiles(1));
  await page.getByTestId('list-read').click();
  await page.getByTestId('count-new').click();
  await page.getByTestId('record-new').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await page.goto('/wallet');
  await page.screenshot({ path: 'test-results/past-statement.png' });
  await expectWalletFigure(page, 'Dompet Satu', '1.459.000');
});
