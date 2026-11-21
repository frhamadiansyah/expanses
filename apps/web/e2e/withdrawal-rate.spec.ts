import { expect, type Page, test } from '@playwright/test';
import { walletCard, openFace } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { mockRates, openWithPockets, pickPocket } from './pockets';
import { openRowPeek } from './receipt-peek';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/* Withdrawal rate §7. A travel account with a rupiah pocket and an empty lira pocket; every figure invented. */
const TRAVEL = { name: 'Travel Money', pockets: [{ currency: 'IDR', balance: '10000000' }, { currency: 'TRY', balance: '' }] };

/* The same journey with a cash pocket: the wallet's lira has no withdrawal behind it. */
const CASH = { name: 'Cash', kind: 'Cash banknotes and coins', pockets: [{ currency: 'IDR', balance: '2000000' }, { currency: 'TRY', balance: '' }] };

async function move(page: Page, account: string, from: string, to: string, leaves: string, arrives: string) {
  await page.goto('/wallet');
  await openFace(walletCard(page, account));
  await page.getByRole('link', { name: 'Move', exact: true }).click();
  await pickPocket(page, 'From', from);
  await pickPocket(page, 'To', to);
  await page.getByLabel(`Leaves ${from}`).pressSequentially(leaves);
  await page.getByLabel(`Arrives ${to}`).pressSequentially(arrives);
}

async function spendLira(page: Page, account: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Payment method/ }).click();
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
  await page.goto('/wallet');
  await openFace(walletCard(page, account));
  await page.getByTestId('pocket-TRY').click();
}

test('lira withdrawn at 525 is spent at 525, the receipt names the withdrawal, and changing leftovers back says what was lost', async ({ page }) => {
  await mockRates(page, { TRY: 512 });
  await openWithPockets(page, TRAVEL);

  // The withdrawal: Rp 5.250.000 for ₺10.000. Nothing is shown under the figures (owner, 17 Nov 2026); the Rate row
  // reads as the receipt does (layout B, 17 Nov 2026).
  await move(page, TRAVEL.name, 'IDR', 'TRY', '5250000', '10000');
  await expect(page.getByText(/per TRY/)).toHaveText(['Rp 525 per TRY']);
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByTestId('pocket-TRY')).toContainText('10.000,00');

  // ₺450 for dinner: Rp 236.250 at the withdrawal rate, not the market's Rp 230.400.
  const form = await spendLira(page, TRAVEL.name, '450');
  await expect(form.getByTestId('withdrawal-rate')).toHaveText('≈ Rp 236.250 at the withdrawal rate (525)');
  await saveAs(page, form, 'Fish by the harbour');

  // The receipt: the same figure, and the withdrawal it came from.
  const fish = await openRowPeek(page, 'Fish by the harbour');
  await expect(fish.getByText('≈ Rp 236.250 at the withdrawal rate (525)')).toBeVisible();
  await expect(fish.getByText(/^From the \d{1,2} [A-Z][a-z]{2}( \d{4})? withdrawal$/)).toBeVisible();

  // The pocket: what the ₺9.550 left cost, and the withdrawal it is what is left of.
  await openLiraPocket(page, TRAVEL.name);
  await expect(page.getByTestId('fx-cost')).toContainText('5.013.750');
  await expect(page.locator('[data-testid^="lot-"]')).toContainText('₺ 9.550 of ₺ 10.000 · Rp 525');

  // ₺500 changed back for Rp 250.000 (the day's 512 is held now). They cost Rp 262.500, but the difference counts nowhere
  // (owner, 17 Nov 2026): no Cost, no Exchange loss, no Rate under the figures while typing.
  await move(page, TRAVEL.name, 'TRY', 'IDR', '500', '250000');
  await expect(page.getByText(/per TRY/)).toHaveText(['Rp 500 per TRY']);
  await expect(page.getByText(/Exchange (loss|gain)|recorded as/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByTestId('pocket-TRY')).toContainText('9.050,00');

  // Its receipt: one Rate row, the market under it — no Cost, no Withdrawn, nothing that says it counts.
  await page.getByTestId('account-recent-row').filter({ hasText: /TRY → IDR/ }).first().click();
  await expect(page.getByText('Rp 500 per TRY', { exact: true })).toBeVisible();
  await expect(page.getByText('market 512 · −2,3 %', { exact: true })).toBeVisible();
  await expect(page.getByText(/at the withdrawal rate|withdrawal$|Exchange (loss|gain)|recorded as/)).toHaveCount(0);

  // November's spending is the dinner alone: the change back is no row and no figure on Cashflow.
  await page.goto('/transactions');
  await expect(page.getByText(/TRY → IDR/)).toHaveCount(0);
  await expect(page.getByText(/Exchange (loss|gain)/)).toHaveCount(0);
});

test('lira spent before any withdrawal was recorded says so, on the Add screen, the receipt and the pocket', async ({ page }) => {
  await mockRates(page, { TRY: 512 });
  await openWithPockets(page, CASH);

  // Nothing came into the lira pocket, and the device holds no lira rate yet: only the uncovered amount is named.
  const form = await spendLira(page, CASH.name, '450');
  await expect(form.getByTestId('withdrawal-rate')).toHaveText('₺ 450 has no withdrawal recorded and no rate for today yet');
  await saveAs(page, form, 'Street snack');

  // Saved at the day's 512 (fetched on Save): the receipt values it there, and says no withdrawal covered it.
  const snack = await openRowPeek(page, 'Street snack');
  await expect(snack.getByText('≈ Rp 230.400 · ₺ 450 at the day’s rate (no withdrawal recorded)')).toBeVisible();
  await expect(snack.getByText(/^From the .* withdrawal$/)).toHaveCount(0);

  await openLiraPocket(page, CASH.name);
  await expect(page.getByTestId('fx-shortfall')).toContainText('₺ 450 spent with no withdrawal recorded, valued at the day’s rate');
});