import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { closeDetails, shareWith } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** The label the old inline form used went with it; the kind decides what the picker asks for now. */
async function addAccount(page: Page, name: string, type: string, balanceLabel: string, amount: string) {
  await openAccount(page, { subtype: type, name, balance: amount });
}

/**
 * + on the desktop asks which side, because both columns are in front of you; each side then adds on a screen
 * of its own, New receivable or New payable, and Save comes back to Lend & borrow.
 */
async function openNew(page: Page, side: 'New receivable' | 'New payable') {
  await page.getByRole('button', { name: 'Add to Lend & borrow' }).click();
  await page.getByRole('menuitem', { name: side }).click();
  await expect(page.getByRole('heading', { name: side })).toBeVisible();
}

async function lend(page: Page, person: string, amount: string, from: string) {
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill(person);
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByLabel('Paid from').selectOption({ label: from });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: person })).toBeVisible();
}

test('lending on a credit card raises the card, earns points, and is never spending', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '0');

  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel(/^Amount/).fill('4000000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA KrisFlyer (IDR)' });
  await page.getByLabel('Category for points').selectOption({ label: 'Shopping (general)' });
  await page.getByLabel('MCC').fill('5311');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();
  await expect(page.getByText(/4\.000\.000/).first()).toBeVisible();

  // The bank never moved, the card owes it, and net worth is unchanged: a loan is not spending.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('50.000.000');
  // What Andi owes is money owed to you, and the sheet draws it in the picker's own category: a section of its own as
  // Receivables, folded by the sub-category the loan files as — 0201, trade receivables. The card is a kind of debt on
  // the other side. The sheet folds twice now — a section, then the kinds inside it — so the section is opened first.
  await page.getByTestId('type-drawer-section-receivable').click();
  await expect(page.getByTestId('type-drawer-receivable:trade_receivable')).toContainText('Trade receivables');
  await expect(page.getByTestId('type-drawer-debts:credit_card')).toContainText('Credit card');

  // Spending stays empty, because no expense category was touched. `/spending` is the transactions list now, and
  // the report there says it in its own words. The assertion used to be the *absence* of the amount anywhere on the
  // page, which passed whenever the list had not finished loading and never tested the thing it claimed.
  await page.goto('/spending');
  await expect(page.getByText(/^Nothing recorded for /)).toBeVisible();
  await expect(page.getByTestId('period-total')).toHaveText(/Rp\s?0$/);
});

test('records a repayment and the balance falls', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '10000000', 'BCA Tahapan (IDR)');

  await page.getByRole('button', { name: 'Record repayment' }).click();
  await page.getByLabel(/How much came back/).fill('4000000');
  await page.getByRole('button', { name: 'Save repayment' }).click();

  await expect(page.getByText(/6\.000\.000/).first()).toBeVisible();
});

test('refuses a repayment bigger than the debt, by name', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '9000000', 'BCA Tahapan (IDR)');

  await page.getByRole('button', { name: 'Record repayment' }).click();
  await page.getByLabel(/How much came back/).fill('12000000');
  await page.getByRole('button', { name: 'Save repayment' }).click();

  await expect(page.getByText(/Andi owes Rp\s?9\.000\.000/)).toBeVisible();
});

test('forgiving the rest closes the debt and takes it off the balance sheet', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '10000000', 'BCA Tahapan (IDR)');

  await page.getByRole('button', { name: 'Forgive rest' }).click();
  await expect(page.getByRole('button', { name: /Show settled/ })).toBeVisible();

  // The money is gone from cash and no longer owed to anyone: net worth carries the loss once.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('40.000.000');
});

test('splits a bill: your share is spending, your friend owes theirs', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('900000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Dinner at Plataran');
  // With, under Add more details: the row that replaced the card's single-person checkbox.
  const { more, sheet } = await shareWith(page, form, [{ name: 'Andi', owes: '600000' }]);
  await closeDetails(more, sheet);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  await expect(page.getByText('Dinner at Plataran')).toBeVisible();

  // Andi owes his part, and only your own share reached the category.
  await page.goto('/net-worth/lend-borrow');
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();
  await expect(page.getByText(/600\.000/).first()).toBeVisible();

  await page.goto('/spending');
  await expect(page.getByText(/300\.000/).first()).toBeVisible();
});

/** The other direction: money taken from a person, which lands under "Payables". */
async function borrow(page: Page, person: string, amount: string, into: string) {
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New payable');
  await page.getByLabel('Person').fill(person);
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByLabel('Received into').selectOption({ label: into });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: person })).toBeVisible();
}

test('the desktop keeps both sides in front of you, side by side', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '1000000', 'BCA Tahapan (IDR)');
  await borrow(page, 'Dewi', '750000', 'BCA Tahapan (IDR)');

  await page.goto('/net-worth/lend-borrow');
  // Both group headers, both figures and both people at once: the phone's one-list-at-a-time control is not here,
  // so nothing the desktop could see before this is behind a tap now.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Receivables', 'Payables']);
  await expect(page.getByRole('radiogroup', { name: 'Lend & borrow' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dewi' })).toBeVisible();
  await expect(page.getByTestId('debts-total-Receivables')).toHaveText('Rp 1.000.000');
  await expect(page.getByTestId('debts-total-Payables')).toHaveText('Rp 750.000');
});

/**
 * A dollar account holding nothing yet: an empty opening asks no rate, so none is stored before the loan.
 * The rate server is cut off too, so the form can only get the dollar's rate by asking for it.
 */
async function emptyDollarAccount(page: Page) {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'Wise USD', currency: 'USD' });
}

test('lends US$100 with no dollar rate stored: the form asks for it and the loan records', async ({ page }) => {
  await emptyDollarAccount(page);

  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel('Paid from').selectOption({ label: 'Wise USD (USD)' });
  await page.getByLabel('Amount (USD)').fill('100');
  await page.getByLabel('Rate: IDR per 1 USD').fill('16250');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();
  await expect(page.getByText(/No USD.IDR rate/)).toHaveCount(0);
  // Printed in dollars on their card, and converted at the typed rate in the side's total.
  await expect(page.getByText(/US\$\s?100/).first()).toBeVisible();
  await expect(page.getByTestId('debts-total-Receivables')).toContainText('1.625.000');
});

test('borrows US$50 with no dollar rate stored: the form asks for it and the debt records', async ({ page }) => {
  await emptyDollarAccount(page);

  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New payable');
  await page.getByLabel('Person').fill('Budi');
  await page.getByLabel('Received into').selectOption({ label: 'Wise USD (USD)' });
  await page.getByLabel('Amount (USD)').fill('50');
  // Saved blank first: with no rate stored and none to fetch, it says so and waits for one — nothing is lost.
  await page.getByLabel('Rate: IDR per 1 USD').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/No USD.IDR rate/)).toBeVisible();
  await page.getByLabel('Rate: IDR per 1 USD').fill('16000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Budi' })).toBeVisible();
  await expect(page.getByText(/US\$\s?50/).first()).toBeVisible();
  await expect(page.getByTestId('debts-total-Payables')).toContainText('800.000');
});

test('+ asks which side, each opens on a screen of its own, and back and Save both return to Lend & borrow', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await page.goto('/net-worth/lend-borrow');

  // Both choices are under the one +, because the desktop shows both sides at once.
  await page.getByRole('button', { name: 'Add to Lend & borrow' }).click();
  await expect(page.getByRole('menuitem', { name: 'New receivable' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'New payable' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'New payable' }).click();

  // A screen of its own, not a form above the lists, and it asks no direction: the title already said it.
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\/new-payable/);
  await expect(page.getByRole('heading', { name: 'New payable' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /I (lent|borrowed) money/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(page.getByLabel('Received into')).toBeVisible();

  // Back goes to Lend & borrow and records nothing.
  await page.getByRole('link', { name: /Lend & borrow/ }).first().click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow(\?|$)/);
  await expect(page.getByText('Nothing lent or borrowed yet.', { exact: false })).toBeVisible();

  // Save does too, with the new person on the side they were added to.
  await openNew(page, 'New payable');
  await page.getByLabel('Person').fill('Dewi');
  await page.getByLabel(/^Amount/).fill('750000');
  await page.getByLabel('Received into').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\?.*side=owe/);
  await expect(page.getByRole('heading', { name: 'Dewi' })).toBeVisible();
  await expect(page.getByTestId('debts-total-Payables')).toContainText('750.000');
});

test('a second loan to the same person is a loan of its own, with its own reason', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel(/^Amount/).fill('1500000');
  await page.getByRole('button', { name: 'Add more details' }).click();
  await page.getByRole('textbox', { name: 'What it is for' }).fill('Motorcycle repair');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();

  // The same name again: New loan is the default, and the reason typed is kept — it used to be thrown away.
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  await expect(page.getByLabel('Loan', { exact: true })).toHaveValue('');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel(/^Amount/).fill('8000000');
  await page.getByRole('button', { name: 'Add more details' }).click();
  await page.getByRole('textbox', { name: 'What it is for' }).fill('Laptop purchase');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // One card for Andi, two loans on it, each by its own reason.
  await expect(page.getByRole('heading', { name: 'Andi' })).toHaveCount(1);
  await expect(page.getByText('Motorcycle repair')).toBeVisible();
  await expect(page.getByText('Laptop purchase')).toBeVisible();
  await expect(page.getByTestId('debts-total-Receivables')).toContainText('9.500.000');

  // A third amount picked onto the laptop loan adds to it, and asks no reason of its own.
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  const loan = page.getByLabel('Loan', { exact: true });
  const laptop = await loan.locator('option', { hasText: /^Laptop purchase/ }).getAttribute('value');
  await loan.selectOption(laptop!);
  // Even with the details open, a picked loan's reason is that loan's and is not asked for.
  await page.getByRole('button', { name: 'Add more details' }).click();
  await expect(page.getByRole('textbox', { name: 'What it is for' })).toHaveCount(0);
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel(/^Amount/).fill('500000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('debts-total-Receivables')).toContainText('10.000.000');
  // Still two loans: the half million went onto the laptop, not into a third.
  await expect(page.getByText(/Laptop purchase/)).toHaveCount(1);
});

test('the rest of it folds into the same box behind Add more details, and opens by itself over anything filled in', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');

  // Folded: the box ends at the fee, and the toggle under it says what it does.
  await expect(page.getByLabel('Sub category')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'What it is for' })).toHaveCount(0);
  await expect(page.getByText('The rest of it')).toHaveCount(0);
  const toggle = page.getByRole('button', { name: 'Add more details' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Open: the four rows join the same box, and the toggle reads the way New transaction's does.
  await toggle.click();
  await expect(page.getByLabel('Sub category')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'What it is for' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'About Due by' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Tax ID', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'What it is for' }).fill('Laptop purchase');
  await page.getByRole('button', { name: 'Fewer details' }).click();
  await expect(page.getByRole('textbox', { name: 'What it is for' })).toHaveCount(0);

  // Folding again keeps what was typed: it is saved with the loan.
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel(/^Amount/).fill('8000000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Laptop purchase')).toBeVisible();
});
