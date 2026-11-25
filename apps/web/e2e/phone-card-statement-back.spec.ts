import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard, walletCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, saveCardTerms } from './card-section';

/*
 * The way out of a card's statement (owner, 25 Nov 2026): ‹ on the statement always lands on the card, and ✕ on the
 * card always lands on the page that opened the card (Wallet, the Debts list), in one tap — never on the statement
 * again, whatever was opened from the statement in between (a receipt, the Pay screen) and however it was reached.
 */

const statementTitle = (page: Page) => page.getByRole('heading', { name: 'Statement', exact: true });
const raised = (page: Page) => page.getByRole('region', { name: 'Cards' }).locator('[data-place="raised"]');
const closeCard = (page: Page) => page.locator('header').getByRole('button', { name: 'Close', exact: true });
const backToCard = (page: Page) => page.locator('header').getByRole('link', { name: 'BCA Visa', exact: true });
const seeAll = (page: Page) => page.getByTestId('latest-transactions').getByRole('link', { name: 'See all' });

/** A bank, and a card with a billing date and a purchase on this statement. */
async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await openCard(page, { name: 'BCA Visa' });
  await page.goto('/wallet');
  await walletCard(page, 'BCA Visa').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('28');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Visa', category: 'Groceries', amount: '450000' });
}

async function openFromWallet(page: Page) {
  await page.goto('/wallet');
  await walletCard(page, 'BCA Visa').click();
  await expect(raised(page)).toHaveCount(1);
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
}

/** ‹ on the statement, then ✕ on the card: lands where `landing` says, with no statement on the way. */
async function backThenClose(page: Page, landing: RegExp) {
  await expect(statementTitle(page)).toBeVisible();
  await backToCard(page).click();
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
  await expect(statementTitle(page)).toHaveCount(0);
  await closeCard(page).click();
  await expect(page).toHaveURL(landing);
  await expect(statementTitle(page)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await setUp(page);
});

test('Statement circle, ‹, ✕: Wallet', async ({ page }) => {
  await openFromWallet(page);
  await cardPage(page, 'Statement');
  await backThenClose(page, /\/wallet$/);
});

test('See all, ‹, ✕: Wallet', async ({ page }) => {
  await openFromWallet(page);
  await seeAll(page).click();
  await backThenClose(page, /\/wallet$/);
});

test('the statement opened twice over, then ✕: Wallet in one tap', async ({ page }) => {
  await openFromWallet(page);
  await cardPage(page, 'Statement');
  await backToCard(page).click();
  await seeAll(page).click();
  await backThenClose(page, /\/wallet$/);
});

test('a receipt opened from the statement and back, then ‹ and ✕: Wallet', async ({ page }) => {
  await openFromWallet(page);
  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: /^Actions for .*Superindo/ }).first().click();
  await page.getByRole('button', { name: 'Open receipt' }).click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await page.goBack();
  await backThenClose(page, /\/wallet$/);
});

test('the statement’s Pay and back, then ‹ and ✕: Wallet', async ({ page }) => {
  await openFromWallet(page);
  await cardPage(page, 'Statement');
  await page.getByLabel('Pay Superindo').check();
  await page.getByTestId('statement-select-bar').getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pay credit card', exact: true })).toBeVisible();
  await page.goBack();
  await backThenClose(page, /\/wallet$/);
});

test('a card opened from the Debts list: ‹ and ✕ go back to Debts', async ({ page }) => {
  await page.goto('/net-worth/loans');
  await page.getByRole('button', { name: /^Credit card \d+ debt/ }).click();
  await page.getByRole('link', { name: /BCA Visa/ }).first().click();
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
  await cardPage(page, 'Statement');
  await backThenClose(page, /\/net-worth\/loans$/);
});

test('a statement opened by its address: ‹ to the card, ✕ to Wallet', async ({ page }) => {
  await openFromWallet(page);
  const card = page.url();
  await page.goto(`${card}/statement`);
  await backThenClose(page, /\/wallet$/);
});
