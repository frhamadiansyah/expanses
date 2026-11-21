import { expect, type Page } from '@playwright/test';
import { openCard } from './accounts';
import { addForm } from './add-transaction';
import { walletCard } from './card-section';

/**
 * A credit card's "For spending" switch, walked once and run at both widths (`card-for-spending.spec.ts`,
 * `phone-card-for-spending.spec.ts`). Off, the card leaves Wallet and Paid with, and stays on Debts and its own page.
 */
export async function cardForSpending(page: Page) {
  await openCard(page, { name: 'Rare Card', owed: '1000000' });
  await openCard(page, { name: 'Daily Card' });

  await page.goto('/wallet');
  await expect(walletCard(page, /^Rare Card/)).toBeVisible();
  await walletCard(page, /^Rare Card/).click();
  await expect(page).toHaveURL(/\/cards\/([^/]+)$/);
  const cardUrl = page.url();
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).first().click();
  const forSpending = page.getByRole('checkbox', { name: 'For spending' });
  await expect(forSpending).toBeChecked();
  await forSpending.click();
  await expect(forSpending).not.toBeChecked();

  // Gone from Wallet; the other card stays.
  await page.goto('/wallet');
  await expect(walletCard(page, /^Daily Card/)).toBeVisible();
  await expect(walletCard(page, /^Rare Card/)).toHaveCount(0);

  // Not offered under Paid with.
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = await addForm(page);
  await form.getByRole('button', { name: /^Payment method/ }).click();
  const paidWith = page.getByRole('dialog', { name: 'Payment method' });
  await paidWith.getByRole('radiogroup', { name: 'Payment method: which kind' }).getByRole('radio', { name: 'Credit cards' }).click();
  await expect(paidWith.getByText('Daily Card').first()).toBeVisible();
  await expect(paidWith.getByText('Rare Card')).toHaveCount(0);

  // Still listed under Debts, and its page still opens.
  await page.goto('/net-worth');
  await page.getByTestId('type-drawer-debts:credit_card').click();
  await page.getByRole('link', { name: /^Rare Card/ }).first().click();
  await expect(page).toHaveURL(cardUrl);

  // Switched back on, it is back in Wallet.
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).first().click();
  await page.getByRole('checkbox', { name: 'For spending' }).click();
  await expect(page.getByRole('checkbox', { name: 'For spending' })).toBeChecked();
  await page.goto('/wallet');
  await expect(walletCard(page, /^Rare Card/)).toBeVisible();
}
