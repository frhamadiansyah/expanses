import { expect, type Page } from '@playwright/test';
import { openAccount, walletCard } from './accounts';

/**
 * The drawn faces on Wallet, walked once and run at both widths (`wallet-card-art.spec.ts`, `phone-wallet-card-art.spec.ts`).
 *
 * An account at a bank with a drawn face is that bank's debit card — chip, contactless mark, digits — and its Settings
 * offer the bank's card tiers, which change the face; a wallet is drawn as its app, with neither chip nor mark; an
 * account at a bank nothing is drawn for keeps the plain face.
 */

/**
 * The face drawn for a card on Wallet, by the card's name: the card's art, under the control that is the card — a link
 * in the stack, a button once it is raised.
 */
const faceOf = (page: Page, name: string) => {
  const named = new RegExp(`^${name}(,|$)`);
  return page
    .getByTestId('wallet-card')
    .filter({ has: page.getByRole('link', { name: named }).or(page.getByRole('button', { name: named })) })
    .getByTestId('card-face');
};

export async function drawnFaces(page: Page) {
  const atBank = (bank: string) => (p: Page) => p.getByLabel('Bank', { exact: true }).pressSequentially(bank);
  await openAccount(page, { subtype: 'bank', name: 'Payroll', balance: '3000000', extra: atBank('Bank Mandiri') });
  await openAccount(page, { subtype: 'bank', name: 'Everyday', balance: '1000000', extra: atBank('Bank One') });
  await openAccount(page, { subtype: 'ewallet', name: 'OVO', balance: '250000' });

  // Mandiri's debit card, a plain face, and OVO's wallet: each card says which it is, covered or not.
  await page.goto('/wallet');
  await expect(faceOf(page, 'Payroll')).toHaveAttribute('data-face', 'mandiri');
  await expect(faceOf(page, 'Everyday')).not.toHaveAttribute('data-face', /./);
  await expect(faceOf(page, 'OVO')).toHaveAttribute('data-face', 'ovo');

  // The wallet is the front card, whole: no chip and no contactless mark on it, and it is a wallet, not a holder.
  const ovo = faceOf(page, 'OVO');
  await expect(ovo).toContainText('E-WALLET');
  await expect(ovo.getByTestId('card-chip')).toHaveCount(0);
  await expect(ovo.getByTestId('card-contactless')).toHaveCount(0);

  // Raised, the Mandiri card shows its chip and contactless mark, and nothing top-right: its bank's mark alone.
  await walletCard(page, 'Payroll').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  const payroll = faceOf(page, 'Payroll');
  await expect(payroll.getByTestId('card-chip')).toBeVisible();
  await expect(payroll.getByTestId('card-contactless')).toBeVisible();
  await expect(payroll).toContainText('mandiri');
  await expect(payroll).not.toContainText('Debit');

  // Its Settings offer Mandiri's tiers; Gold changes the face, and the choice holds across a reload.
  await page.locator('header').getByRole('link', { name: 'Settings', exact: true }).click();
  const tier = page.getByLabel('Card tier');
  await expect(tier).toHaveValue('standard');
  await tier.selectOption('gold');
  // Back inside the app, as a person would: a navigation straight after the choice could cut the save short. The
  // raised card wears the new face once the save has landed, and only then is the stack opened afresh.
  await page.goBack();
  await expect(faceOf(page, 'Payroll')).toHaveAttribute('data-face', 'mandiri-gold');
  await page.goto('/wallet');
  await expect(faceOf(page, 'Payroll')).toHaveAttribute('data-face', 'mandiri-gold');
  await page.reload();
  await expect(faceOf(page, 'Payroll')).toHaveAttribute('data-face', 'mandiri-gold');

  // An account at a bank with no tiers is offered none.
  await walletCard(page, 'Everyday').click();
  await page.locator('header').getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Last 4 digits', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Card tier')).toHaveCount(0);
}
