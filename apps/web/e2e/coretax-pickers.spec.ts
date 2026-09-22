import { expect, test } from '@playwright/test';

/**
 * The three ways in, by mouse: an account, an asset, a debt — each chosen in words, each filed under a code
 * nobody was shown while choosing. What every one of these proves is that the code arrives anyway, and that it
 * can be put right afterwards on the thing's own page.
 *
 * Every save is waited on where it lands before the next `goto`. A form here writes to the database and then
 * navigates itself; reloading the page on top of that write is a race, and one that loses silently.
 */

test('a time deposit holds money that cannot be spent until it is moved', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Current account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Balance now').fill('20000000');
  // The balance is optional here, and the form says what happens to it.
  await expect(page.getByText('Optional. Posted as an opening balance.')).toBeVisible();
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Time deposit' }).click();
  await expect(page.getByText('When it matures, move the money to an account with a transfer.')).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Deposito BCA 6 bulan');
  await page.getByLabel('Balance now').fill('100000000');
  // Every money account is asked which currency it holds, a deposit included: money abroad is ordinary.
  await expect(page.getByLabel('Currency')).toBeVisible();
  await page.getByLabel('Matures on').fill('2027-03-01');
  await page.getByLabel('Interest rate').fill('6,25');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Deposito BCA 6 bulan', exact: true })).toBeVisible();

  // What was typed on the way in is said back: the day the money comes back, and what it pays for waiting.
  const deposito = page.getByRole('row').filter({ has: page.getByRole('link', { name: 'Deposito BCA 6 bulan', exact: true }) });
  await expect(deposito).toContainText('Matures 1 Mar 2027 · 6,25%');

  // And it can be put right, because a date typed off a certificate is a date that can be mistyped.
  await deposito.getByRole('link', { name: /^0104/ }).click();
  await expect(page.getByText('Matures 1 Mar 2027 · 6,25%')).toBeVisible();
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByLabel('Matures on').fill('2027-12-01');
  await page.getByLabel('Interest rate').fill('6,75');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Matures 1 Dec 2027 · 6,75%')).toBeVisible();
  await page.goto('/accounts');
  await expect(deposito).toContainText('Matures 1 Dec 2027 · 6,75%');

  // Money you hold: net worth counts it, and the balance sheet calls it cash.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('120.000.000');

  // But nothing will let it pay for lunch.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  const payer = page.getByRole('dialog', { name: 'Paid with' });
  await expect(payer).toContainText('BCA Tahapan');
  await expect(payer).not.toContainText('Deposito BCA 6 bulan');
  await payer.getByRole('button', { name: 'Close' }).click();

  // It comes back with a transfer, which is the only honest way out. A transfer may move money between any two
  // money accounts, so the deposit that cannot pay for lunch is offered here.
  await form.getByRole('radio', { name: 'Transfer' }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await page.getByRole('dialog', { name: 'From' }).getByRole('button', { name: 'Deposito BCA 6 bulan', exact: true }).click();
  // Exact, as every other transfer spec asks: rows now end in a "Receipt for …" ⓘ, and a loose "To" matches
  // any description with "to" in it — "Deposito BCA 6 bulan", here.
  await form.getByLabel('To', { exact: true }).selectOption({ label: 'BCA Tahapan (IDR)' });
  await form.getByLabel('Amount', { exact: true }).fill('100000000');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await page.goto('/accounts');
  await expect(
    page.getByRole('row').filter({ has: page.getByRole('link', { name: 'BCA Tahapan', exact: true }) }),
  ).toContainText('120.000.000');
});

test('a family, then the thing: an apartment and gold jewellery file under their own codes', async ({ page }) => {
  await page.goto('/net-worth/assets/new');
  await page.getByRole('button', { name: 'Immovable property' }).click();
  await page.getByRole('button', { name: 'Apartment' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Apartemen Taman Anggrek');
  await page.getByLabel('Bought on').fill('2021-06-01');
  await page.getByLabel('What it cost (IDR)').fill('1150000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Apartemen Taman Anggrek/ })).toBeVisible();

  await page.goto('/net-worth/assets/new');
  await page.getByPlaceholder('Search everything you can own').fill('gold jewellery');
  await page.getByRole('button', { name: 'Gold jewellery' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Kalung emas');
  await page.getByLabel('Bought on').fill('2025-01-01');
  await page.getByLabel('How much').fill('25');
  await page.getByLabel('Total cost (IDR)').fill('35000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Kalung emas/ })).toBeVisible();

  // Never a code while choosing; both codes afterwards, each in its own table.
  await page.goto('/net-worth/assets');
  await expect(page.getByText('0503 · Harta Tidak Bergerak')).toBeVisible();
  await expect(page.getByText('0702 · Harta Lainnya')).toBeVisible();
});

test('something else reaches a code the five families do not list', async ({ page }) => {
  await page.goto('/net-worth/assets/new');
  await page.getByRole('button', { name: /^Movable property/ }).click();
  await page.getByRole('button', { name: 'Something else' }).click();
  await page.getByRole('button', { name: 'Ship' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Kapal nelayan');
  await page.getByLabel('Bought on').fill('2025-05-05');
  await page.getByLabel('What it cost (IDR)').fill('80000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Kapal nelayan/ })).toBeVisible();
  await page.goto('/net-worth/assets');
  await expect(page.getByText('0409 · Harta Bergerak')).toBeVisible();
});

test('a mortgage, a wallet and a deposit reach the tax report under the right kode', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Digital wallet' }).click();
  await page.getByLabel('Name', { exact: true }).fill('GoPay');
  await page.getByLabel('Balance now').fill('500000');
  await page.getByLabel('Balance as of').fill('2026-01-05');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'GoPay', exact: true })).toBeVisible();

  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Home mortgage' }).click();
  await page.getByLabel('Owed now').fill('650000000');
  await page.getByLabel('Lender').fill('Bank BTN');
  await page.getByLabel('Interest rate').fill('9');
  await page.getByLabel('Months left').fill('168');
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page.getByRole('heading', { name: 'Debts', exact: true })).toBeVisible();

  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption('2026');
  await page.getByRole('button', { name: /Start the 2026 report/ }).click();
  await expect(page.getByText('0105')).toBeVisible();
  await expect(page.getByText('Uang elektronik')).toBeVisible();
  const utang = page.locator('table', { has: page.getByText('Kartu kredit').or(page.getByText('Utang bank')) });
  await expect(utang).toContainText('101');
  await expect(utang).toContainText('Bank BTN');
});

test('the asset picker never offers money, whatever is typed into its search', async ({ page }) => {
  await page.goto('/net-worth/assets/new');
  const search = page.getByPlaceholder('Search everything you can own');
  for (const query of ['bank', 'cash', 'deposit', 'account']) {
    await search.fill(query);
    await expect(page.getByRole('button', { name: 'Bank, cash or deposit' })).toHaveCount(0);
  }
  // Money has a door of its own, and the picker says where it is.
  await search.fill('');
  await expect(page.getByRole('link', { name: /Add an account instead/ })).toBeVisible();
});

test('a code can be changed afterwards, in the words the form uses', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Fund account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('RDN Mandiri Sekuritas');
  await page.getByLabel('Balance now').fill('8000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'RDN Mandiri Sekuritas', exact: true })).toBeVisible();

  await page.goto('/accounts');
  await expect(page.getByText(/0109 · Setara kas lainnya/)).toBeVisible();
  await page.getByRole('link', { name: /Setara kas lainnya/ }).click();
  // The code boxes live on the asset's settings page, behind its gear.
  await page.getByRole('main').getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('What it is').selectOption({ label: 'Saving account' });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.goto('/accounts');
  await expect(page.getByText(/0102 · Tabungan/)).toBeVisible();
});

test('a thing sharing its code with another reads back as itself', async ({ page }) => {
  await page.goto('/accounts/new');
  await page.getByRole('button', { name: 'Saving account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan Berjangka');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan Berjangka', exact: true })).toBeVisible();

  // 0102 is both a current account and a saving account. The account itself says which, and the list opens on it.
  await page.getByRole('link', { name: /0102 · Tabungan/ }).click();
  await page.getByRole('main').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByLabel('What it is')).toHaveValue('savings');

  // Typing a code the list does not name is the way out, and choosing it puts the cursor in the box.
  await page.getByLabel('What it is').selectOption({ label: 'Type a code instead' });
  await expect(page.getByLabel('Tax report code')).toBeFocused();
});
