import { expect, type Page, test } from '@playwright/test';
import { addTransaction } from './add-transaction';

const TODAY = new Date().toISOString().slice(0, 10);

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addAccount(page: Page, name: string, type: string, extra?: (page: Page) => Promise<void>) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption(type);
  if (extra) await extra(page);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

test('an expense goes in through the card and comes out in the list', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions');

  // The workspace row opens on the workspace that is open, so nothing has to be chosen to record here.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Workspace' })).toContainText('Personal');
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Cancel' }).click();

  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '500000' });

  const row = page.getByTestId('transaction-row').filter({ hasText: 'Superindo' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Groceries');
  await expect(row).toContainText('500.000');
});

test('income lands in the account it was received into', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions');
  await addTransaction(page, { mode: 'Income', description: 'Freelance', paidWith: 'BCA Tahapan', category: 'Salary', amount: '7500000' });

  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Freelance' })).toContainText('7.500.000');
  // Received, not spent: the account is 7.500.000 richer, which is what tells income from an expense.
  await page.goto('/accounts');
  await expect(page.getByRole('listitem').filter({ hasText: 'BCA Tahapan' }).first()).toContainText('7.500.000');
});

test('Paid with names each card by its digits, and choosing one sets the account and the card together', async ({ page }) => {
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', async () => {
    await page.getByLabel('Bank', { exact: true }).selectOption('BCA');
    await page.getByLabel('Last 4 digits').fill('1467');
  });
  // A second card on the same account: one statement, two sets of digits.
  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA KrisFlyer', exact: true }).click();
  await page.getByLabel('Last 4 digits').fill('8802');
  await page.getByLabel('Whose card').fill('Spouse');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Paid with' }).click();
  const sheet = page.getByRole('dialog', { name: 'Paid with' });
  await expect(sheet.getByRole('button', { name: 'BCA KrisFlyer ···· 1467', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'BCA KrisFlyer ···· 8802', exact: true })).toBeVisible();
  // The account alone is not offered: it would answer the question by leaving half of it unanswered.
  await expect(sheet.getByRole('button', { name: 'BCA KrisFlyer', exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Cancel' }).click();

  await addTransaction(page, { description: 'Ranch Market', paidWith: 'BCA KrisFlyer ···· 8802', category: 'Groceries', amount: '450000' });

  // The card, not only the account: the row prints the digits it was charged on.
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Ranch Market' });
  await expect(row).toContainText('8802');
  await expect(row).not.toContainText('1467');
});

test('/transactions/new opens the empty card rather than a receipt for a transaction called "new"', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions/new');

  await expect(page.getByRole('heading', { name: 'Add a transaction' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Category' })).toBeVisible();
  // A receipt draws a hero; the card never does. If `$transactionId` had swallowed "new" this is what would show.
  await expect(page.getByTestId('receipt-hero')).toHaveCount(0);
  await expect(page.getByText('That transaction is not on this device.')).toHaveCount(0);
});

test('a desktop types the amount into a real input, and the keyboard does what the keypad does', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank');
  await page.goto('/transactions/new');

  // §3.4: the keypad is the phone's. A desktop is not a phone with its keyboard taken away.
  await expect(page.getByTestId('keypad')).toHaveCount(0);
  const amount = page.getByLabel('Amount', { exact: true });
  await expect(amount).toHaveRole('textbox');

  // Leaving the field evaluates it, as DONE does on the dock.
  await amount.fill('85000+15000');
  await page.getByLabel('Note').click();
  await expect(amount).toHaveValue('100000');

  // And so does Enter, without saving on the same press.
  await amount.fill('272400+5000');
  await amount.press('Enter');
  await expect(amount).toHaveValue('277400');
  await expect(page.getByRole('heading', { name: 'Add a transaction' })).toBeVisible();
});

test('"Charged in" opens filled in at the rate this device stored for the day', async ({ page }) => {
  // No rate server: what is known is what this device has stored, which is the whole point of the estimate.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await addAccount(page, 'BCA Tahapan', 'bank');

  const typeForeign = async (amount: string) => {
    await page.goto('/transactions/new');
    await page.getByRole('button', { name: 'Paid with' }).click();
    await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
    await page.getByRole('button', { name: 'Currency' }).click();
    // The sheet lists CNY under Recent once it has been chosen, and under All currencies always.
    await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: 'CNY Chinese Yuan' }).first().click();
    await page.getByLabel('Amount', { exact: true }).fill(amount);
    await page.getByLabel('Note').click();
  };

  // Nothing is stored for CNY yet, so nothing is guessed: an estimate built on a rate nobody has is worse
  // than no estimate, and the row says so instead of inventing one.
  await typeForeign('100');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('');
  await expect(page.getByText(/No CNY→IDR rate is known/)).toBeVisible();

  // A CNY account opened today stores today's CNY→IDR rate.
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('Alipay');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Currency').selectOption('CNY');
  // The rate is stored as the balance's own conversion, so there has to be a balance to convert.
  await page.getByLabel('Current balance').fill('1000');
  await page.getByLabel('Balance as of').fill(TODAY);
  await page.getByLabel('Rate: IDR per 1 CNY').fill('2200');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Alipay', exact: true })).toBeVisible();

  // Now the day has a rate, so the row opens with the estimate already in it — and it is a figure worked out
  // from the rate, not the figure typed: CNY 100 at 2.200 is Rp 220.000, and CNY 250 is Rp 550.000.
  await typeForeign('100');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('220000');
  await expect(page.getByText(`\u2248 2.200 per 1 CNY \u00b7 suggested from ${TODAY}`)).toBeVisible();

  await typeForeign('250');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('550000');
});
