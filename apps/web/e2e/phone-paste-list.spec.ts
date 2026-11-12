import { expect, type Page, test } from '@playwright/test';
import { expectWalletFigure, openAccount } from './accounts';
import { addTransaction, choosePayment } from './add-transaction';
import { todayIn } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Two accounts, so the list has to be told which one pays; past purchases give the notes a category to be guessed from. */
async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '10000000' });
  await openAccount(page, { subtype: 'bank', name: 'Jago', balance: '2000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'gocar', paidWith: 'Jago', category: 'Ride hailing', amount: '10000' });
  await addTransaction(page, { description: 'yoshinoya pondok', paidWith: 'Jago', category: 'Restaurants', amount: '10000' });
  await addTransaction(page, { description: 'taxi bluebird', paidWith: 'Jago', category: 'Ride hailing', amount: '10000' });
}

async function openPaste(page: Page) {
  await page.goto('/transactions/new');
  await page.getByRole('button', { name: 'Paste a list', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/paste/);
  await expect(page.getByLabel('Purchases')).toBeFocused();
}

const row = (page: Page, note: string) => page.getByTestId('review-row').filter({ hasText: note });

test('a pasted list is read, fixed on the review, and saved as purchases paid from the chosen account', async ({ page }) => {
  await setUp(page);
  await openPaste(page);

  // The box starts empty and Review waits for a line.
  const box = page.getByLabel('Purchases');
  await expect(box).toHaveAttribute('placeholder', 'One purchase per line');
  await expect(page.getByRole('button', { name: 'Review 0' })).toBeDisabled();

  await box.fill('gocar 18000\nyoshinoya 249000\ntaxi bluebird 25000\ncaterng 90000\nparkir');
  await expect(page.getByRole('button', { name: 'Review 5' })).toBeEnabled();
  await page.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Tahapan');
  await expect(page.getByRole('button', { name: 'Paid with' })).toContainText('BCA Tahapan');
  await page.screenshot({ path: test.info().outputPath('page-1-paste.png') });
  await page.getByRole('button', { name: 'Review 5' }).click();

  // Four read, one not; categories come from the notes' history.
  await expect(page.getByTestId('review-header')).toHaveText('4 of 5 lines ready');
  await expect(row(page, 'gocar')).toContainText('Ride hailing');
  await expect(row(page, 'gocar')).toContainText('18.000');
  await expect(row(page, 'yoshinoya')).toContainText('Restaurants');
  await expect(row(page, 'taxi bluebird')).toContainText('Ride hailing');
  await expect(row(page, 'caterng')).toContainText('Choose a category');
  await expect(row(page, 'parkir')).toContainText('No amount');
  await expect(page.getByRole('button', { name: 'Save list' })).toBeDisabled();
  await expect(page.getByTestId('review-save')).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('page-2-review-fix.png') });

  // The typo gets a category.
  await row(page, 'caterng').click();
  const sheet = page.getByRole('dialog', { name: 'Purchase' });
  await expect(sheet.getByLabel('Note')).toHaveValue('caterng');
  await sheet.getByLabel('Note').fill('catering');
  await sheet.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Home catering', exact: true }).click();
  await expect(sheet.getByRole('button', { name: /^Category/ })).toContainText('Home catering');
  await page.screenshot({ path: test.info().outputPath('page-2b-edit-sheet.png') });
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(row(page, 'catering')).toContainText('Home catering');

  // The line with no amount is typed one, grouped as it goes.
  await row(page, 'parkir').click();
  const unread = page.getByRole('dialog', { name: 'Not read' });
  await unread.getByLabel('Amount').fill('5000');
  await expect(unread.getByLabel('Amount')).toHaveValue('5.000');
  await unread.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('review-header')).toHaveText('5 lines');
  await expect(page.getByTestId('review-total')).toContainText('387.000');
  await expect(page.getByTestId('review-save')).toHaveText('Save 5');
  await page.screenshot({ path: test.info().outputPath('page-3-review-ready.png') });

  await page.getByTestId('review-save').click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByTestId('toast')).toHaveText('Added 5 purchases');

  const today = await todayIn(page);
  for (const [note, figure] of [['gocar', '18.000'], ['yoshinoya', '249.000'], ['taxi bluebird', '25.000'], ['catering', '90.000'], ['parkir', '5.000']] as const) {
    const saved = page.getByTestId('transaction-row').filter({ hasText: note }).first();
    await expect(saved).toContainText(figure);
  }
  void today;

  // The payer lost the total; the other account did not move for the list.
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '9.613.000');
  await expectWalletFigure(page, 'Jago', '1.970.000');
});

test('Back from the review keeps the text and the fixes, and a removed line is gone', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '1000000' });
  await openPaste(page);
  await page.getByLabel('Purchases').fill('kopi susu 12000\nparkir\nbakso 2');
  await page.getByRole('button', { name: 'Review 3' }).click();
  await expect(page.getByTestId('review-header')).toHaveText('2 of 3 lines ready');

  // A figure that looks like a slip is drawn outlined until it is retyped.
  await expect(row(page, 'bakso').locator('[data-flagged="true"]')).toHaveCount(1);
  await row(page, 'parkir').click();
  await page.getByRole('dialog', { name: 'Not read' }).getByRole('button', { name: 'Remove' }).click();
  await expect(row(page, 'parkir')).toHaveCount(0);
  await expect(page.getByTestId('review-header')).toHaveText('2 lines');

  await row(page, 'bakso').click();
  await page.getByRole('dialog', { name: 'Purchase' }).getByLabel('Amount').fill('20000');
  await page.getByRole('dialog', { name: 'Purchase' }).getByRole('button', { name: 'Done' }).click();
  await expect(row(page, 'bakso').locator('[data-flagged="true"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Paste a list', exact: true }).click();
  await expect(page.getByLabel('Purchases')).toHaveValue('kopi susu 12000\nparkir\nbakso 2');
  await page.getByRole('button', { name: 'Review 3' }).click();
  await expect(page.getByTestId('review-header')).toHaveText('2 lines');
  await expect(row(page, 'bakso')).toContainText('20.000');
  // Uncategorised is where a row with no category lands.
  await page.getByTestId('review-save').click();
  await expect(page.getByTestId('toast')).toHaveText('Added 2 purchases');
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '968.000');
});

test('a line that is only a date sets the day of the lines below it', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '1000000' });
  await openPaste(page);
  const first = await todayIn(page, 3);
  const second = await todayIn(page, 5);
  const dayMonth = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  // The page's own date applies to what comes before the first date line.
  const pageDate = await todayIn(page, 1);
  await page.getByLabel('Date').fill(pageDate);
  await page.getByLabel('Purchases').fill(`kopi 11000\n${dayMonth(first)}\nnasi 22000\nteh 3000\n# not a purchase\n\n${dayMonth(second)}\nsate 44000`);
  await page.getByRole('button', { name: 'Review 4' }).click();
  await expect(page.getByTestId('review-header')).toHaveText('4 lines');

  // Each row's own sheet names its day.
  const dayOf = async (note: string) => {
    await row(page, note).click();
    const sheet = page.getByRole('dialog', { name: 'Purchase' });
    const day = await sheet.getByLabel('Date').inputValue();
    await sheet.getByRole('button', { name: 'Done' }).click();
    return day;
  };
  expect(await dayOf('kopi')).toBe(pageDate);
  expect(await dayOf('nasi')).toBe(first);
  expect(await dayOf('teh')).toBe(first);
  expect(await dayOf('sate')).toBe(second);

  await page.getByTestId('review-save').click();
  await expect(page.getByTestId('toast')).toHaveText('Added 4 purchases');
  // Four purchases on three days.
  await expect(page.getByTestId('transaction-row')).toHaveCount(4);
});

test('lines dated before the account opened are posted as past purchases by themselves, and the balance stays', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '1000000' });
  await openPaste(page);
  // The page's own date is ten days back: before the day the account's balance is counted from.
  await page.getByLabel('Date').fill(await todayIn(page, 10));
  await page.getByLabel('Purchases').fill('kopi susu 12000\nparkir 5000');
  await page.getByRole('button', { name: 'Review 2' }).click();
  await page.getByTestId('review-save').click();
  await expect(page.getByTestId('toast')).toHaveText('Added 2 purchases');
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '1.000.000');
});

test('the Date row says what the dates are for: Date, Lines without a date, or Dates from the list', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '1000000' });
  await openPaste(page);
  const box = page.getByLabel('Purchases');
  await expect(page.getByLabel('Date', { exact: true })).toBeVisible();

  await box.fill('kopi 11000\n21okt\nteh 3000');
  await expect(page.getByLabel('Lines without a date')).toBeVisible();

  await box.fill('21okt\nkopi 11000\nteh 3000');
  await expect(page.getByText('From the list')).toBeVisible();
  await expect(page.getByText('Every line has a date in the list.')).toBeVisible();
  await expect(page.getByLabel('Lines without a date')).toHaveCount(0);
  await expect(page.getByLabel('Date', { exact: true })).toHaveCount(0);
});
