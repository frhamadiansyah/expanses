import { expect, test } from '@playwright/test';
import { openAccount, openFace, walletCard } from './accounts';
import { addForm, saveButton } from './add-transaction';
import { chooseCardPayFrom } from './card-section';
import { bankMonth, cardStatements, openBankPage, openCardPage } from './mac-account-pages';

/*
 * The Mac account pages (owner 2026-11-20), on a wide screen: an account's and a credit card's own page, full width,
 * with boxes on top and a table below. Invented data (`mac-account-pages.ts`).
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('a bank account’s page: its balance as Wallet prints it, the month’s figures, every row with the balance after it, the receipt peek and the settings peek', async ({ page }) => {
  await bankMonth(page);

  // Wallet's figure for the account, and the sidebar's, before the page is opened.
  await page.goto('/wallet');
  await expect(walletCard(page, 'Tahapan Kita')).toHaveAccessibleName(/45\.461\.500/);
  const side = page.locator('aside').getByRole('navigation', { name: 'Sections' });
  await side.getByRole('button', { name: 'Show accounts' }).click();
  await expect(side.getByRole('link', { name: /^Tahapan Kita/ })).toContainText('45,5 jt');

  await openBankPage(page);
  await expect(page.getByRole('heading', { name: 'Tahapan Kita', exact: true })).toBeVisible();
  await expect(page.getByTestId('desk-title-line')).toHaveText('Saving account · IDR');
  // The title bar: the account's own actions as the phone's round buttons, the ⚙ and the black Record.
  const actions = page.getByRole('group', { name: 'Actions' });
  await expect(actions.getByRole('button', { name: 'Transfer', exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: 'Adjust', exact: true })).toBeVisible();
  await expect(actions.getByRole('link', { name: 'Statement', exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: /Record$/ })).toBeVisible();

  // Balance: the face Wallet draws, and the figure Wallet and the sidebar print.
  const balance = page.getByTestId('balance-card');
  await expect(balance.getByTestId('desk-face')).toBeVisible();
  await expect(page.getByTestId('account-balance')).toHaveText('Rp 45.461.500');

  // This month: what came in, went out and moved, adding up to the change.
  await expect(page.getByTestId('month-in')).toContainText('Rp 21.400.000');
  await expect(page.getByTestId('month-out')).toContainText('Rp 38.500');
  await expect(page.getByTestId('month-transfers-out')).toContainText('Rp 900.000');
  await expect(page.getByTestId('month-change')).toContainText('+Rp 20.461.500');
  await expect(page.getByTestId('month-opening')).toHaveCount(0);
  // The line ends on today's balance.
  await expect(page.getByTestId('balance-months').getByRole('img')).toHaveAccessibleName(/Rp.45\.461\.500$/);

  // Every row of the month, newest first, with the balance after it; the newest ends on today's balance.
  const rows = page.getByTestId('account-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('GoPay top-up');
  await expect(rows.nth(0)).toContainText('→ GoPay');
  await expect(rows.nth(0)).toContainText('−Rp 900.000');
  await expect(rows.nth(0).getByTestId('balance-after')).toHaveText('Rp 45.461.500');
  await expect(rows.nth(1).getByTestId('balance-after')).toHaveText('Rp 46.361.500');
  await expect(rows.nth(2)).toContainText('+Rp 21.400.000');
  await expect(rows.nth(2).getByTestId('balance-after')).toHaveText('Rp 46.400.000');
  // Each row's category is the app's own mark.
  await expect(rows.nth(1).getByTestId('category-mark')).toBeVisible();

  // A click opens the Mac receipt in the side peek; the page makes room for it, so no figure sits under it.
  await rows.nth(1).click();
  const peek = page.getByTestId('receipt-peek');
  await expect(peek.getByTestId('peek-title')).toHaveText('Alfamart Senopati');
  const peekLeft = (await peek.boundingBox())!.x;
  const after = (await rows.nth(1).getByTestId('balance-after').boundingBox())!;
  expect(after.x + after.width).toBeLessThanOrEqual(peekLeft);
  // ⌄ steps to the row under it.
  await peek.getByRole('button', { name: 'Next transaction' }).click();
  await expect(peek.getByTestId('peek-title')).toHaveText('Gaji Sinar Kreatif');
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);

  // ⚙ opens the account's settings in the side peek; Save puts them away, still on the page.
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  const settings = page.getByTestId('settings-peek');
  await expect(settings.getByLabel('For spending')).toBeChecked();
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.getByTestId('account-desk')).toBeVisible();

  // A double-click opens today's edit screen.
  await rows.filter({ hasText: 'Alfamart Senopati' }).dblclick();
  await expect(page).toHaveURL(/\/transactions\/[^/]+\/edit$/);
  await page.goBack();

  // An earlier month: the opening balance is named in the box, and the table starts afresh.
  await page.getByRole('button', { name: 'Earlier month' }).click();
  await expect(page.getByTestId('month-opening')).toContainText('Rp 25.000.000');
  await expect(page.getByTestId('month-change')).toContainText('+Rp 25.000.000');
  await expect(rows).toHaveCount(0);
  // See all is the account's whole history, the list.
  await page.getByRole('link', { name: 'See all' }).click();
  await expect(page).toHaveURL(/\/transactions\?account=/);
});

test('a credit card’s page: Outstanding as Wallet prints it, the bill, the statements switch, and ⌘-picked purchases paid on their own', async ({ page }) => {
  await cardStatements(page);

  // Wallet's figure for the card (what is due now), before the page is opened.
  await page.goto('/wallet');
  await expect(walletCard(page, 'Visa Kita')).toHaveAccessibleName(/1\.793\.500/);

  await openCardPage(page);
  await expect(page.getByTestId('desk-title-line')).toHaveText('Credit card · ···· 4417');
  await expect(page.getByTestId('tile-figure-label')).toHaveText('Outstanding');
  await expect(page.getByTestId('tile-unpaid-balance')).toHaveText('Rp 1.793.500');
  // The bill: last month's statement, nothing paid on it yet.
  await expect(page.getByTestId('bill-to-pay')).toContainText('Rp 1.562.000');
  await expect(page.getByTestId('bill-paid')).toContainText('Rp 0');

  // This statement: newest first, with a Card column since a supplementary card is on the account.
  const table = page.getByTestId('card-table');
  const rows = page.getByTestId('card-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Bluebird');
  await expect(table.getByRole('columnheader', { name: 'Card' })).toBeVisible();
  await expect(rows.nth(0)).toContainText('•4417');
  // No rewards set up: no points column.
  await expect(page.getByTestId('card-row-points')).toHaveCount(0);

  // A click opens the receipt in the side peek.
  await rows.nth(1).click();
  await expect(page.getByTestId('receipt-peek').getByTestId('peek-title')).toHaveText('Kopi Tuku');
  await page.keyboard.press('Escape');

  // All: every statement's lines.
  await page.getByRole('radio', { name: 'All' }).click();
  await expect(rows).toHaveCount(4);

  // Last: the bill's purchases. ⌘-click two, and Pay pays just those.
  await page.getByRole('radio', { name: 'Last' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('•8802');
  await rows.nth(0).click({ modifiers: ['ControlOrMeta'] });
  await rows.nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.getByTestId('card-picked')).toContainText('2 picked · Rp 1.562.000');
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pay 2 purchases' }).click();
  await expect(page.getByRole('heading', { name: 'Pay credit card', exact: true })).toBeVisible();
  const form = addForm(page);
  await expect(form.getByTestId('paying-purchases')).toContainText('Paying 2 purchases');
  await expect(form.getByTestId('paying-purchases')).toContainText('Superindo');
  await expect(form.getByTestId('paying-purchases')).toContainText('Hotel Santika');
  await expect(form.getByLabel('Amount', { exact: true })).toHaveValue(/^1\.?562\.?000$/);
  await chooseCardPayFrom(form, 'Tahapan Kita');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Paid: the bill says so, and Outstanding is what is left on this statement, as Wallet prints it.
  await openCardPage(page);
  await expect(page.getByTestId('bill-due')).toContainText('Paid in full');
  await expect(page.getByTestId('tile-unpaid-balance')).toHaveText('Rp 231.500');
  await page.goto('/wallet');
  await expect(walletCard(page, 'Visa Kita')).toHaveAccessibleName(/231\.500/);
});

test('the card’s Pay with nothing picked opens Pay credit card for the bill', async ({ page }) => {
  await cardStatements(page);
  await openCardPage(page);
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pay credit card', exact: true })).toBeVisible();
  await expect(addForm(page).getByLabel('Amount', { exact: true })).toHaveValue(/^1\.?562\.?000$/);
});

test('a cash account’s page keeps the phone’s own actions: Record saves back onto the page, Withdraw and Adjust open their sheets', async ({ page }) => {
  await openAccount(page, { subtype: 'cash', name: 'Dompet', balance: '300000' });
  await page.goto('/wallet');
  await openFace(walletCard(page, 'Dompet'));
  await expect(page.getByTestId('account-desk')).toBeVisible();
  const actions = page.getByRole('group', { name: 'Actions' });
  // Spend and Receive are the one Record; Withdraw and Adjust are the cash account's own.
  await expect(actions.locator('button, a')).toHaveText(['Withdraw', 'Adjust', '', '＋Record']);

  await actions.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Cash withdrawal' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Cash withdrawal' }).getByRole('button', { name: 'Close' }).first().click();
  await actions.getByRole('button', { name: 'Adjust', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Adjust balance' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Adjust balance' }).getByRole('button', { name: 'Close' }).first().click();

  await actions.getByRole('button', { name: /Record$/ }).click();
  const form = addForm(page);
  await form.getByLabel('Amount', { exact: true }).fill('45000');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Pasar pagi');
  await saveButton(form).click();
  // Saved, the app is back on the account's page, where the new row leads the month.
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByTestId('account-row').first()).toContainText('Pasar pagi');
  await expect(page.getByTestId('account-row').first().getByTestId('balance-after')).toHaveText('Rp 255.000');
  await expect(page.getByTestId('account-balance')).toHaveText('Rp 255.000');
});
