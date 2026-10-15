import { expect, type Page, test } from '@playwright/test';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { mockRates, openWithPockets } from './pockets';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/* Withdrawal rate §7. A travel account with a rupiah pocket and an empty lira pocket; every figure invented. */
const TRAVEL = { name: 'Travel Money', pockets: [{ currency: 'IDR', balance: '10000000' }, { currency: 'TRY', balance: '' }] };

/* The same journey with a cash pocket: the wallet's lira has no withdrawal behind it. */
const CASH = { name: 'Cash', kind: 'Cash banknotes and coins', pockets: [{ currency: 'IDR', balance: '2000000' }, { currency: 'TRY', balance: '' }] };

async function move(page: Page, account: string, from: string, to: string, leaves: string, arrives: string) {
  await page.goto('/accounts');
  await page.getByRole('link', { name: account, exact: true }).click();
  await page.getByRole('link', { name: 'Move', exact: true }).click();
  await page.getByLabel('From').selectOption(from);
  await page.getByLabel('To').selectOption(to);
  await page.getByLabel(`Leaves ${from}`).pressSequentially(leaves);
  await page.getByLabel(`Arrives ${to}`).pressSequentially(arrives);
}

async function spendLira(page: Page, account: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, `${account} · TRY`);
  await openAmount(form);
  await fillAmount(page, form, amount);
  return form;
}

async function saveAs(page: Page, form: ReturnType<typeof addForm>, note: string) {
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill(note);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

async function openLiraPocket(page: Page, account: string) {
  await page.goto('/accounts');
  await page.getByRole('link', { name: account, exact: true }).click();
  await page.getByTestId('pocket-TRY').click();
}

test('lira withdrawn at 525 is spent at 525, the receipt names the withdrawal, and changing leftovers back says what was lost', async ({ page }) => {
  await mockRates(page, { TRY: 512 });
  await openWithPockets(page, TRAVEL);

  // The withdrawal: Rp 5.250.000 for ₺10.000. The device holds no lira rate before its first save, so the Rate row
  // has no market to compare with yet; the move back below has one.
  await move(page, TRAVEL.name, 'IDR', 'TRY', '5250000', '10000');
  await expect(page.getByText(/^Rp 525 per TRY/)).toBeVisible();
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByTestId('pocket-TRY')).toContainText('10.000,00');

  // ₺450 for dinner: Rp 236.250 at the withdrawal rate, not the market's Rp 230.400.
  const form = await spendLira(page, TRAVEL.name, '450');
  await expect(form.getByTestId('withdrawal-rate')).toHaveText('≈ Rp 236.250 at the withdrawal rate (525)');
  await saveAs(page, form, 'Fish by the harbour');

  // The receipt: the same figure, and the withdrawal it came from.
  await page.getByRole('link', { name: 'Receipt for Fish by the harbour' }).click();
  await expect(page.getByText('≈ Rp 236.250 at the withdrawal rate (525)')).toBeVisible();
  await expect(page.getByText(/^From the \d{1,2} [A-Z][a-z]{2}( \d{4})? withdrawal$/)).toBeVisible();

  // The pocket: what the ₺9.550 left cost, and the withdrawal it is what is left of.
  await openLiraPocket(page, TRAVEL.name);
  await expect(page.getByTestId('fx-cost')).toContainText('5.013.750');
  await expect(page.locator('[data-testid^="lot-"]')).toContainText('₺ 9.550 of ₺ 10.000 · Rp 525');

  // ₺500 changed back for Rp 250.000 (the day's 512 is held now): they cost Rp 262.500, so Rp 12.500 is lost, recorded
  // as spending.
  await move(page, TRAVEL.name, 'TRY', 'IDR', '500', '250000');
  await expect(page.getByText('Rp 500 per TRY (market 512, −2,3 %)')).toBeVisible();
  await expect(page.getByTestId('exchange-cost')).toContainText('262.500');
  await expect(page.getByTestId('spread')).toContainText('Exchange loss');
  await expect(page.getByTestId('spread')).toContainText('12.500');
  await expect(page.getByTestId('spread')).toContainText('recorded as spending');
  await page.getByRole('button', { name: 'Move it' }).click();
  await expect(page.getByTestId('pocket-TRY')).toContainText('9.050,00');
});

test('lira spent before any withdrawal was recorded says so, on the Add screen, the receipt and the pocket', async ({ page }) => {
  await mockRates(page, { TRY: 512 });
  await openWithPockets(page, CASH);

  // Nothing came into the lira pocket, and the device holds no lira rate yet: only the uncovered amount is named.
  const form = await spendLira(page, CASH.name, '450');
  await expect(form.getByTestId('withdrawal-rate')).toHaveText('₺ 450 has no withdrawal recorded and no rate for today yet');
  await saveAs(page, form, 'Street snack');

  // Saved at the day's 512 (fetched on Save): the receipt values it there, and says no withdrawal covered it.
  await page.getByRole('link', { name: 'Receipt for Street snack' }).click();
  await expect(page.getByText('≈ Rp 230.400 · ₺ 450 at the day’s rate (no withdrawal recorded)')).toBeVisible();
  await expect(page.getByText(/^From the .* withdrawal$/)).toHaveCount(0);

  await openLiraPocket(page, CASH.name);
  await expect(page.getByTestId('fx-shortfall')).toContainText('₺ 450 spent with no withdrawal recorded, valued at the day’s rate');
});