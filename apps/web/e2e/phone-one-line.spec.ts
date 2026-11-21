import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { todayIn } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** One bank account, and one past purchase so a shop has a category to be guessed from. Invented names and figures. */
async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'Bank Nusa', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'warung sate', paidWith: 'Bank Nusa', category: 'Restaurants', amount: '10000' });
  await page.goto('/transactions/line');
}

const field = (page: Page) => page.getByLabel('One line', { exact: true });
const preview = (page: Page) => page.getByTestId('line-preview');
const part = (page: Page, name: 'Category' | 'Payment method' | 'Day' | 'Amount') => preview(page).getByRole('button', { name, exact: true });

test('One line reads a typed purchase into the preview row and saves it with Return', async ({ page }) => {
  await setUp(page);

  await test.step('a line is read into the preview and saved with Return, and the field stays for the next', async () => {
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('placeholder', 'Shop, amount, card');
    await field(page).fill('warung sate 45rb nusa');
    await expect(preview(page)).toContainText('Restaurants');
    await expect(preview(page)).toContainText('Warung Sate');
    await expect(preview(page)).toContainText('Bank Nusa');
    await expect(preview(page)).toContainText('45.000');
    await expect(preview(page).locator('[data-unsure="true"]')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('one-line-1-preview.png') });
    await field(page).press('Enter');
    await expect(page.getByTestId('line-saved')).toContainText('1 saved');
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
  });

  await test.step('note and amount are enough: paid-with falls back to the last one, shown unsure', async () => {
    await field(page).fill('parkir 10rb');
    await expect(part(page, 'Payment method')).toHaveAttribute('data-unsure', 'true');
    await expect(part(page, 'Payment method')).toHaveText('Bank Nusa?');
    await expect(part(page, 'Category')).toHaveText('Uncategorised');
    await page.screenshot({ path: test.info().outputPath('one-line-2-unsure.png') });
    await field(page).press('Enter');
    await expect(page.getByTestId('line-saved')).toContainText('2 saved');
  });

  await test.step('the day and the card are kept for the next line', async () => {
    await field(page).fill('kemarin kopi 20rb nusa');
    await expect(part(page, 'Day')).toHaveText('Yesterday');
    await field(page).press('Enter');
    await expect(page.getByTestId('line-saved')).toContainText('3 saved');
    await field(page).fill('roti 15rb');
    await expect(part(page, 'Day')).toHaveText('Yesterday');
    await expect(part(page, 'Payment method')).toHaveText('Bank Nusa?');
  });

  await test.step('a line with no amount does not save', async () => {
    await field(page).fill('parkir');
    await expect(part(page, 'Amount')).toHaveText('Amount?');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await field(page).press('Enter');
    await expect(page.getByTestId('line-saved')).toContainText('3 saved');
    await expect(field(page)).toHaveValue('parkir');
  });

  await test.step('a part is fixed from the preview', async () => {
    await field(page).fill('toko buku 85rb nusa');
    await part(page, 'Category').click();
    await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Books', exact: true }).click();
    await expect(part(page, 'Category')).toHaveText('Books');
    await expect(part(page, 'Category')).not.toHaveAttribute('data-unsure', 'true');
    await page.screenshot({ path: test.info().outputPath('one-line-3-fixed.png') });
    await field(page).press('Enter');
    await expect(page.getByTestId('line-saved')).toContainText('4 saved');
  });

  await test.step('two quick presses save one row (Review Focus)', async () => {
    await field(page).fill('teh 5rb nusa');
    await field(page).focus();
    // Both presses go out back to back: the second lands while the first save is still being written.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('line-saved')).toContainText('5 saved');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('line-saved')).toContainText('5 saved');
    await expect(page.getByTestId('line-saved-row').filter({ hasText: 'Teh' })).toHaveCount(1);
  });

  await test.step('Done leaves, and the saved rows are on Cashflow; a saved row opens its edit screen', async () => {
    await page.getByTestId('line-saved-row').first().click();
    await expect(page).toHaveURL(/\/transactions\/[^/]+\/edit$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/transactions\/line$/);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    const rows = page.getByTestId('transaction-row');
    await expect(rows.filter({ hasText: 'Warung Sate' }).first()).toBeVisible();
    await expect(rows.filter({ hasText: 'Parkir' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Teh' })).toHaveCount(1);
  });
});

test('a foreign line with no rate for the day stops with the missing pair named and keeps the text (Review Focus)', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Nusa', balance: '5000000' });
  // Offline: no rate can be fetched, and none is stored.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await page.goto('/transactions/line');
  const today = await todayIn(page);
  await field(page).fill('tteokbokki 95000 krw nusa');
  await expect(part(page, 'Amount')).toContainText('95');
  await field(page).press('Enter');
  await expect(page.getByRole('alert')).toHaveText(`No KRW→IDR rate for ${today}. Record it from the Add screen.`);
  await expect(field(page)).toHaveValue('tteokbokki 95000 krw nusa');
  await expect(page.getByTestId('line-saved')).toHaveCount(0);
});
