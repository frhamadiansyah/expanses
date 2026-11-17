import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard, openFace, walletCard } from './accounts';
import { addForm, addTransaction, saveButton } from './add-transaction';
import { chooseCardPayFrom } from './card-section';
import { mockRates } from './pockets';

/*
 * Wallet on a wide screen (Mac Wallet): the Balance box and where the money sits over every card Wallet holds, each its
 * own face, grouped as bank accounts, cash & e-wallets, credit cards and foreign currency with each group's total. A
 * click opens a card's side peek, a double-click its page; List shows the same cards as rows; a face dragged onto
 * another takes its place. Invented figures.
 */

const peek = (page: Page) => page.getByTestId('wallet-peek');
const group = (page: Page, key: 'bank' | 'cash' | 'credit' | 'foreign') => page.getByTestId(`wallet-group-${key}`);

/** A face's name, read from its link. */
const faceNames = async (page: Page, key: 'bank' | 'cash' | 'credit' | 'foreign') =>
  (
    await group(page, key)
      .getByTestId('wallet-card')
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('aria-label') ?? ''))
  ).map((name) => name.split(',')[0]);

test('the cards are grouped by what they are, each group adding up its faces, and the Balance, the split and the sidebar read the same money', async ({
  page,
}) => {
  await mockRates(page, { USD: 16_000 });
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'savings', name: 'Jenius', balance: '2000000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '250000' });
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay', balance: '150000' });
  await openAccount(page, { subtype: 'cash', name: 'Dollar cash', currency: 'USD', balance: '100', rate: '16000' });
  await openCard(page, { name: 'Blue Card', owed: '500000', last4: '4242' });

  await page.goto('/wallet');
  await expect(page.getByRole('heading', { name: 'Wallet', exact: true })).toBeVisible();
  // Every card a face, in its group, in Wallet's order within it.
  await expect(page.getByRole('region', { name: 'Cards' }).getByTestId('wallet-card')).toHaveCount(6);
  expect(await faceNames(page, 'bank')).toEqual(['BCA Tahapan', 'Jenius']);
  expect(await faceNames(page, 'cash')).toEqual(['Pocket cash', 'GoPay']);
  expect(await faceNames(page, 'credit')).toEqual(['Blue Card']);
  expect(await faceNames(page, 'foreign')).toEqual(['Dollar cash']);
  // Each face prints its own figure; the dollars in dollars.
  await expect(group(page, 'foreign').getByTestId('face-figure')).toContainText('100');
  await expect(group(page, 'credit').getByTestId('face-figure')).toContainText('500.000');

  // Each group's total is its faces added up, in rupiah; the cards' as owed.
  await expect(group(page, 'bank').getByTestId('wallet-group-total')).toHaveText(/7\.000\.000$/);
  await expect(group(page, 'cash').getByTestId('wallet-group-total')).toHaveText(/400\.000$/);
  await expect(group(page, 'credit').getByTestId('wallet-group-total')).toContainText('500.000');
  await expect(group(page, 'foreign').getByTestId('wallet-group-total')).toHaveText(/^≈ .*1\.600\.000$/);

  // The Balance: the money (7.000.000 + 400.000 + 1.600.000) less the card's 500.000; an estimate, dollars being in it.
  const box = page.getByTestId('wallet-balance');
  await expect(box.getByTestId('wallet-balance-figure')).toHaveText(/^≈ .*8\.500\.000$/);
  await expect(box.getByTestId('wallet-spending-row')).toContainText('9.000.000');
  await expect(box.getByTestId('wallet-cards-row')).toContainText('500.000');
  // The line's change over 30 days is the money that came in: every opening balance, within the month.
  await expect(box.getByTestId('wallet-balance-change')).toContainText('in 30 days');

  // Where the money sits: the two largest named, the other three folded together; whole percents adding to 100.
  const split = page.getByTestId('wallet-split').getByTestId('wallet-split-row');
  await expect(split).toHaveCount(3);
  await expect(split.nth(0)).toContainText('BCA Tahapan');
  await expect(split.nth(0)).toContainText('56%');
  await expect(split.nth(1)).toContainText('Jenius');
  await expect(split.nth(1)).toContainText('22%');
  await expect(split.nth(2)).toContainText('Others · 3 accounts');
  await expect(split.nth(2)).toContainText('22%');

  // The sidebar's Accounts read the same figures: the bank's 5 jt, the card's 500.000 owed.
  await page.getByRole('button', { name: 'Show accounts' }).click();
  const sections = page.getByRole('navigation', { name: 'Sections' });
  await expect(sections.getByRole('link', { name: /^BCA Tahapan/ })).toContainText('5 jt');
  await expect(sections.getByRole('link', { name: /^Blue Card/ })).toContainText('500.000');
});

test('a click opens a card’s side peek — its figure, what it is, Transfer and Edit, its last rows — ⌃ ⌄ and the arrows step, Esc closes, a double-click opens its page', async ({
  page,
}) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '250000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Noodle House', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '50000' });

  await page.goto('/wallet');
  const bca = walletCard(page, 'BCA Tahapan');
  await bca.click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(peek(page)).toBeVisible();
  await expect(peek(page).getByTestId('peek-title')).toHaveText('BCA Tahapan');
  await expect(peek(page).getByTestId('peek-figure')).toContainText('4.950.000');
  await expect(peek(page).getByTestId('peek-line')).toHaveText('Current account · IDR');
  await expect(bca).toHaveAttribute('aria-current', 'true');
  for (const name of ['Transfer', 'Edit', 'Open']) await expect(peek(page).getByRole('button', { name, exact: true })).toBeVisible();
  await expect(peek(page).getByRole('button', { name: 'Pay', exact: true })).toHaveCount(0);
  await expect(peek(page).getByRole('button', { name: 'Move', exact: true })).toHaveCount(0);
  // Its last rows, the purchase among them; the opening balance is not.
  await expect(peek(page).getByTestId('peek-recent-row')).toHaveCount(1);
  await expect(peek(page).getByTestId('peek-recent-row')).toContainText('Noodle House');
  await expect(peek(page).getByTestId('peek-recent-row')).toContainText(/-Rp\s?50\.000/);
  await expect(peek(page).getByRole('link', { name: 'All transactions' })).toHaveAttribute('href', /\/transactions\?account=/);

  // The page makes room: the peek covers no face.
  await expect
    .poll(async () => (await walletCard(page, 'Pocket cash').boundingBox())!.x + (await walletCard(page, 'Pocket cash').boundingBox())!.width)
    .toBeLessThan((await peek(page).boundingBox())!.x);

  // ⌄ steps to the next card in the page's order, ↑ back; Esc closes.
  await peek(page).getByRole('button', { name: 'Next account' }).click();
  await expect(peek(page).getByTestId('peek-title')).toHaveText('Pocket cash');
  await expect(peek(page).getByTestId('peek-line')).toHaveText('Cash · IDR');
  await page.keyboard.press('ArrowUp');
  await expect(peek(page).getByTestId('peek-title')).toHaveText('BCA Tahapan');
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);

  // Transfer opens a transfer from it.
  await bca.click();
  await peek(page).getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?.*mode=transfer/);

  // A double-click opens its page, under the raised card; ✕ comes back to Mac Wallet.
  await page.goto('/wallet');
  await openFace(walletCard(page, 'BCA Tahapan'));
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(page.getByRole('region', { name: 'Cards' }).locator('[data-place="raised"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByTestId('wallet-accounts')).toBeVisible();
});

test('Pay in a credit card’s peek opens “Pay credit card” filled with what it owes, and paying it clears Outstanding on cards', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openCard(page, { name: 'Blue Card', owed: '500000', last4: '4242' });

  await page.goto('/wallet');
  await walletCard(page, 'Blue Card').click();
  await expect(peek(page).getByTestId('peek-title')).toHaveText('Blue Card');
  await expect(peek(page)).toContainText('Outstanding');
  await expect(peek(page).getByTestId('peek-figure')).toContainText('500.000');
  await expect(peek(page).getByTestId('peek-line')).toHaveText('Credit card · IDR · ···· 4242');
  for (const name of ['Pay', 'Statement', 'Edit', 'Open']) await expect(peek(page).getByRole('button', { name, exact: true })).toBeVisible();
  await expect(peek(page).getByRole('button', { name: 'Transfer', exact: true })).toHaveCount(0);

  await peek(page).getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pay credit card', exact: true })).toBeVisible();
  const form = addForm(page);
  await expect(form.getByTestId('pay-card-to')).toContainText('Blue Card');
  await expect(form.getByRole('textbox', { name: 'Amount' })).toHaveValue('500000');
  await chooseCardPayFrom(form, 'BCA Tahapan');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await page.goto('/wallet');
  await expect(page.getByTestId('wallet-cards-row')).toContainText('0');
  await expect(page.getByTestId('wallet-cards-row')).not.toContainText('500.000');
  await expect(page.getByTestId('wallet-spending-row')).toContainText('4.500.000');
});

test('List shows the same cards as rows in the same groups, a row opens the peek and a double-click the page, and the choice is kept', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay', balance: '150000' });
  await openCard(page, { name: 'Blue Card', owed: '500000', last4: '4242' });

  await page.goto('/wallet');
  await page.getByRole('radiogroup', { name: 'Wallet view' }).getByRole('radio', { name: 'List' }).click();
  const list = page.getByRole('region', { name: 'Accounts list' });
  await expect(list).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cards' })).toHaveCount(0);
  const rows = list.getByTestId('wallet-list-row');
  await expect(rows).toHaveCount(3);
  await expect(list.getByTestId('wallet-list-bank')).toContainText('BCA Tahapan');
  await expect(list.getByTestId('wallet-list-bank')).toContainText('Current account · IDR');
  await expect(list.getByTestId('wallet-list-bank')).toContainText('5.000.000');
  await expect(list.getByTestId('wallet-list-cash')).toContainText('GoPay');
  await expect(list.getByTestId('wallet-list-credit')).toContainText('Blue Card');
  await expect(list.getByTestId('wallet-list-credit').getByTestId('wallet-group-total')).toContainText('500.000');

  // A row opens the peek; a double-click the card's page.
  await rows.filter({ hasText: 'GoPay' }).click();
  await expect(peek(page).getByTestId('peek-title')).toHaveText('GoPay');
  await expect(rows.filter({ hasText: 'GoPay' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');

  // Kept on this device.
  await page.reload();
  await expect(page.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  await expect(rows).toHaveCount(3);
  await rows.filter({ hasText: 'Blue Card' }).dblclick();
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
  await page.goto('/wallet');
  await page.getByRole('radio', { name: 'Cards' }).click();
  await expect(page.getByRole('region', { name: 'Cards' }).getByTestId('wallet-card')).toHaveCount(3);
});

test('a face dragged onto another in its group takes its place, kept as Reorder cards keeps it; Reorder opens the same order', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'First Bank', balance: '1000000' });
  await openAccount(page, { subtype: 'bank', name: 'Second Bank', balance: '2000000' });
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '250000' });

  await page.goto('/wallet');
  await expect.poll(() => faceNames(page, 'bank')).toEqual(['First Bank', 'Second Bank']);
  const faces = group(page, 'bank').getByTestId('wallet-card');
  await faces.nth(1).dragTo(faces.nth(0));
  await expect.poll(() => faceNames(page, 'bank')).toEqual(['Second Bank', 'First Bank']);

  // Kept: a reload, and the Reorder page, read the new order.
  await page.reload();
  await expect.poll(() => faceNames(page, 'bank')).toEqual(['Second Bank', 'First Bank']);
  await page.getByRole('link', { name: 'Reorder', exact: true }).click();
  await expect(page).toHaveURL(/\/wallet\/reorder$/);
  const rows = page.getByTestId('reorder-row');
  await expect(rows.nth(0)).toContainText('Second Bank');
  await expect(rows.nth(1)).toContainText('First Bank');
  await expect(rows.nth(2)).toContainText('Pocket cash');
});
