import { expect, test } from '@playwright/test';
import { openCard } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { todayIn } from './today';

test('an old card purchase already paid off is spending, and the card still owes what it owed', async ({ page }) => {
  await openCard(page, { name: 'BCA Visa', owed: '2000000' });
  const cardPage = page.url();
  await expect(page.getByRole('main')).toContainText('2.000.000');

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await fillAmount(page, form, '850000');
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'BCA Visa');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Anniversary dinner');
  // Today: still owed on the card, the card's icon unticked.
  const paidOff = form.getByRole('button', { name: 'Already paid off' });
  await expect(paidOff).toHaveAttribute('aria-pressed', 'false');
  await expect(form.getByTestId('paid-off-tick')).toHaveCount(0);
  // Before the card started in the app: ticked by itself.
  const day = await todayIn(page, 90);
  await form.getByLabel('Date').fill(day);
  await expect(paidOff).toHaveAttribute('aria-pressed', 'true');
  await expect(form.getByTestId('paid-off-tick')).toBeVisible();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await page.goto(cardPage);
  await expect(page.getByRole('main')).toContainText('Rp 2.000.000');
  // In its own month it is the spending it was; the settlement beside it is an opening entry, out of the list.
  await page.goto(`/transactions?month=${day.slice(0, 7)}`);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Anniversary dinner' })).toHaveCount(1);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Settled before the app' })).toHaveCount(0);
});

test('a recent card purchase can be ticked paid off by hand, and the card still owes what it owed', async ({ page }) => {
  await openCard(page, { name: 'BCA Visa', owed: '2000000' });
  const cardPage = page.url();

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await fillAmount(page, form, '120000');
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'BCA Visa');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Lunch paid off already');
  const paidOff = form.getByRole('button', { name: 'Already paid off' });
  await paidOff.click();
  await expect(paidOff).toHaveAttribute('aria-pressed', 'true');
  // A tap again takes the tick back off; and on once more for the save.
  await paidOff.click();
  await expect(form.getByTestId('paid-off-tick')).toHaveCount(0);
  await paidOff.click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await page.goto(cardPage);
  await expect(page.getByRole('main')).toContainText('Rp 2.000.000');
});
