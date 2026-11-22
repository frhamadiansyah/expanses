import { expect, test } from '@playwright/test';
import { expectWalletFigure, openAccount } from './accounts';
import { choosePayment, saveButton } from './add-transaction';
import { corner, newEvent, openTrip, recordSharedSpend, sharedCard, spendingRow } from './shared-events';

/*
 * Owner, 22 Nov 2026: a shared event's expense Rina paid herself takes another Payment method on edit, like any other
 * field — recorded on the wrong account, it is fixed without deleting it. The payment moves off the first account onto
 * the second, once; the event shows the same expense and the same total. Written once for both shapes (desktop and
 * phone). Invented figures; one phone, a trip shared in rupiah with Budi, who has no app.
 */

test.describe.configure({ timeout: 240_000 });

test('an expense Rina paid moves to another account on edit: the first is back, the second charged, the event unchanged', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'Rina Daily', balance: '10000000' });
  await openAccount(page, { subtype: 'bank', name: 'Rina Savings', balance: '5000000' });

  await newEvent(page, 'Hill weekend');
  await corner(page, 'Share this event');
  const share = page.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 60_000 });

  // Rp 300.000 for the villa, from the wrong account.
  await openTrip(page, 'Hill weekend');
  await corner(page, 'Add spending');
  await recordSharedSpend(page, { note: 'Villa', amount: '300000', paidWith: 'Rina Daily' });
  await expect(spendingRow(page, 'Villa')).toBeVisible();
  const total = (await page.getByTestId('shared-event-total').textContent())!;
  expect(total).toMatch(/300\.000/);
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Rina Daily', '9.700.000');

  // Opened again, its Payment method is a control like any other row: Savings, saved.
  await openTrip(page, 'Hill weekend');
  await spendingRow(page, 'Villa').click();
  const card = sharedCard(page);
  await expect(card).toBeVisible();
  const method = card.getByRole('button', { name: /^Payment method/ });
  await expect(method).toBeEnabled();
  await expect(method).toContainText('Rina Daily');
  await method.click();
  await choosePayment(page, 'Rina Savings', 'Payment method');
  await expect(method).toContainText('Rina Savings');
  await saveButton(card).click();
  await expect(card).toHaveCount(0, { timeout: 30_000 });

  // The event: the same one expense, the same total.
  await expect(page.getByTestId('shared-expense-row')).toHaveCount(1);
  await expect(spendingRow(page, 'Villa')).toContainText('Rina paid');
  await expect(page.getByTestId('shared-event-total')).toHaveText(total);

  // Daily is whole again; Savings paid it, once.
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Rina Daily', '10.000.000');
  await expectWalletFigure(page, 'Rina Savings', '4.700.000');

  // Reopened, it reads the account it moved to.
  await openTrip(page, 'Hill weekend');
  await spendingRow(page, 'Villa').click();
  await expect(sharedCard(page).getByRole('button', { name: /^Payment method/ })).toContainText('Rina Savings');
});
