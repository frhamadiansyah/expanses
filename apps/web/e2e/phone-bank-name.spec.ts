import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard, openSettings, openWalletAccount, walletCard } from './accounts';
import { addForm } from './add-transaction';

/** The drawn face of a card on Wallet, by the name the card is shown by. */
const faceOf = (page: Page, name: string) =>
  page
    .getByTestId('wallet-card')
    .filter({ has: page.getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).or(page.getByRole('button', { name: new RegExp(`^${name}(,|$)`) })) })
    .getByTestId('card-face');

test('an account at a bank is called by its bank and its name, while Settings keep both as typed', async ({ page }) => {
  // The bank picked from the list is stored by its full name; the account is shown by the short one, once.
  await openAccount(page, {
    subtype: 'savings',
    name: 'Xpresi',
    balance: '2750000',
    shown: 'Mandiri Xpresi',
    extra: async (p) => {
      await p.getByLabel('Bank', { exact: true }).fill('mandiri');
      await p.getByRole('listbox', { name: 'Banks' }).getByRole('option', { name: /Bank Mandiri/ }).click();
    },
  });
  // Typed with its bank already in front, it is not said twice.
  await openAccount(page, { subtype: 'bank', name: 'Mandiri Giro', balance: '400000', extra: (p) => p.getByLabel('Bank', { exact: true }).pressSequentially('Mandiri') });
  await expect(walletCard(page, 'Mandiri Xpresi')).toBeVisible();
  await expect(walletCard(page, 'Mandiri Giro')).toBeVisible();
  await expect(page.getByText('Mandiri Mandiri', { exact: false })).toHaveCount(0);

  // Paid with lists it by both, and the chosen row says the same.
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: 'Paid with' }).click();
  const sheet = page.getByRole('dialog', { name: 'Paid with' });
  await expect(sheet.getByRole('button', { name: 'Mandiri Xpresi', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Mandiri Giro', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Mandiri Xpresi', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Paid with' })).toContainText('Mandiri Xpresi');

  // Its page is titled the same; its Settings keep the name as typed and the bank as picked.
  await openWalletAccount(page, 'Mandiri Xpresi');
  await expect(page.getByRole('heading', { name: 'Mandiri Xpresi' })).toBeVisible();
  await openSettings(page);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Xpresi');
  await expect(page.getByLabel('Bank or institution', { exact: true })).toHaveValue('Bank Mandiri');
});

test('a credit card is called by its issuer and its name, kept apart in its Settings', async ({ page }) => {
  await openCard(page, { name: 'UnionPay', bank: 'BCA' });
  await expect(page.getByRole('heading', { name: 'BCA UnionPay' })).toBeVisible();
  await page.goto('/wallet');
  await expect(walletCard(page, 'BCA UnionPay')).toBeVisible();
  await expect(page.getByText('BCA BCA')).toHaveCount(0);
  await walletCard(page, 'BCA UnionPay').click();
  await openSettings(page);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('UnionPay');
});

test('electronic money is a kind of its own, with no phone number, drawn in Wallet as its card', async ({ page }) => {
  await openAccount(page, {
    subtype: 'emoney',
    name: 'Flazz',
    balance: '185000',
    // A chip card has no phone number to ask for: that is a digital wallet's.
    extra: (p) => expect(p.getByLabel('Phone number')).toHaveCount(0),
  });
  await openAccount(page, { subtype: 'emoney', name: 'Commuter card', balance: '60000' });

  await page.goto('/wallet');
  // Flazz is drawn as Flazz, a prepaid card: the contactless mark and no chip.
  const flazz = faceOf(page, 'Flazz');
  await expect(flazz).toHaveAttribute('data-face', 'flazz');
  await expect(faceOf(page, 'Commuter card')).not.toHaveAttribute('data-face', /./);

  // Raised, Flazz reads as electronic money and carries no chip; its page tops it up as a wallet's does.
  await walletCard(page, 'Flazz').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(faceOf(page, 'Flazz')).toContainText('E-MONEY');
  await expect(faceOf(page, 'Flazz').getByTestId('card-chip')).toHaveCount(0);
  await expect(page.getByText('Electronic money', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Top up' })).toBeVisible();

  // A card whose name names none keeps the plain face, chipped as what it is.
  await page.goto('/wallet');
  await walletCard(page, 'Commuter card').click();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await expect(faceOf(page, 'Commuter card').getByTestId('card-kind')).toHaveText('E-money');
});
