import { expect, test } from '@playwright/test';
import { mockRates, openWithPockets } from './pockets';
import { fundedByTwoTaps } from './funded-by-taps';
import { addGoal, addMoneyAccount, goalCard, setAside } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/**
 * Funded by is one row per account (2026-11-14): a multicurrency account is one row at its currencies' total in the
 * goal's money, and a tap opens its currencies under it, each in its own money; a currency opens as its row did.
 * Names and figures invented.
 */
test('a multicurrency account is one Funded-by row that opens to its currencies', async ({ page }) => {
  await mockRates(page, {});
  await openWithPockets(page, {
    name: 'Kas Valas',
    pockets: [
      { currency: 'USD', balance: '900.00', rate: '15900' },
      { currency: 'IDR', balance: '6000000' },
    ],
  });
  await addMoneyAccount(page, 'Tabungan Harian', 'savings', '8000000');
  await addGoal(page, 'Hajj 2031', '150000000');

  // One currency alone stays its own row, under its own name.
  await setAside(page, 'Hajj 2031', 'Kas Valas · USD (USD)', '500.00');
  let hajj = await goalCard(page, 'Hajj 2031');
  await expect(hajj.getByTestId('goal-link').filter({ hasText: 'Kas Valas · USD' })).toBeVisible();
  await expect(hajj.getByTestId('goal-link-account')).toHaveCount(0);

  await setAside(page, 'Hajj 2031', 'Kas Valas · IDR (IDR)', '4000000');
  await setAside(page, 'Hajj 2031', 'Tabungan Harian', '3000000');
  hajj = await goalCard(page, 'Hajj 2031');

  // Shut: one row for the account, at US$500,00 × 15.900 + Rp 4.000.000, converted so drawn with ≈; nothing under it.
  const valas = hajj.getByTestId('goal-link-account');
  await expect(valas).toHaveCount(1);
  await expect(valas).toContainText('Kas Valas');
  await expect(valas).toContainText(/≈ Rp.11\.950\.000/);
  await expect(hajj.getByTestId('goal-link').filter({ hasText: 'Kas Valas' })).toHaveCount(0);
  await expect(hajj.getByTestId('goal-link-currency')).toHaveCount(0);
  await expect(hajj.getByTestId('goal-link').filter({ hasText: 'Tabungan Harian' })).toContainText(/Rp.3\.000\.000/);
  // The header carries what funds the goal altogether.
  await expect(hajj.getByRole('heading', { name: 'Funded by' }).locator('xpath=../..')).toContainText(/Rp.14\.950\.000/);

  // Opened: each currency in its own money, the dollars without a rupiah figure beside them.
  await valas.click();
  const currencies = hajj.getByTestId('goal-link-currency');
  await expect(currencies).toHaveCount(2);
  const usd = currencies.filter({ hasText: 'USD' });
  await expect(usd).toContainText('500,00');
  await expect(usd).not.toContainText('Rp');
  await expect(currencies.filter({ hasText: 'IDR' })).toContainText(/Rp.4\.000\.000/);

  // A currency's › opens that pocket's page (its body opens Set aside: funded-by-taps.ts).
  await usd.getByRole('link', { name: 'Open Kas Valas · USD', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/]+$/);
  await page.goBack();

  // Tapped again, the account shuts.
  hajj = await goalCard(page, 'Hajj 2031');
  await hajj.getByTestId('goal-link-account').click();
  await expect(hajj.getByTestId('goal-link-currency')).toHaveCount(2);
  await hajj.getByTestId('goal-link-account').click();
  await expect(hajj.getByTestId('goal-link-currency')).toHaveCount(0);
});

test('a set-aside line opens Set aside from its body and the account from its own ›; the gold row is one target', async ({ page }) => {
  await fundedByTwoTaps(page);
});
