import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { addForm, addTransaction, choosePayment, openAmount, saveButton } from './add-transaction';
import { cardPage, openPaidBubble, paidTick } from './card-section';

/*
 * The paid-off mark, found without the swipe: a switch on the purchase's receipt, and a ⋯ at the end of each statement
 * line. The card bills on the 31st (clamped to each month's last day), so a purchase made today is always on the
 * statement on show.
 */
async function setUp(page: Page) {
  await openCard(page, { name: 'BCA Visa', statementDay: '31', dueDay: '15' });
}

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });
/** The row's own face, told apart from the category circle beside it — which also names the purchase. */
const face = (page: Page, what: string, category: string) => row(page, what).getByRole('button', { name: new RegExp(`^${category}`) });

/** Tap the row on Cashflow: the receipt. */
async function openReceipt(page: Page, description: string, category: string) {
  await page.goto('/transactions');
  await face(page, description, category).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
  await expect(page.getByRole('heading', { name: description })).toBeVisible();
}

/** The card's statement, a page of its own opened from its round Statement button. */
async function openStatement(page: Page) {
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Statement');
}

/** The ⋯ at the end of a statement line, and the sheet it opens, titled with the line. */
async function openActions(page: Page, description: string) {
  await page.getByTestId('statement-line').filter({ hasText: description }).getByRole('button', { name: `Actions for ${description}` }).click();
  const sheet = page.getByRole('dialog', { name: description });
  await expect(sheet).toBeVisible();
  return sheet;
}

test('a card purchase is marked paid off from its receipt, and from the ⋯ on its statement line', async ({ page }) => {
  await setUp(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Hotel Mulia', paidWith: 'BCA Visa', category: 'Groceries', amount: '2000000' });

  // The receipt carries the switch, off, and nothing written under it (owner, 24 Oct).
  await openReceipt(page, 'Hotel Mulia', 'Groceries');
  const receiptUrl = page.url();
  const paidOff = page.getByRole('checkbox', { name: 'Paid off', exact: true });
  await expect(paidOff).not.toBeChecked();
  await expect(page.getByText(/Nothing to pay for this one on the statement/)).toHaveCount(0);
  await paidOff.click();
  await expect(paidOff).toBeChecked();

  // The statement shows the ✓ in the Pay box's place.
  await openStatement(page);
  const hotel = page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' });
  await expect(hotel.getByTestId('statement-paid-off')).toBeVisible();
  // The row keeps its date; how it was paid is in the ✓'s name and in the bubble a tap opens.
  await expect(hotel).not.toContainText('Paid before cicis');
  await expect(paidTick(hotel)).toHaveAccessibleName('Hotel Mulia, Paid before cicis');
  const bubble = await openPaidBubble(page, hotel);
  await expect(bubble.getByTestId('statement-paid-how')).toHaveText('Paid before cicis');
  await expect(bubble.getByTestId('statement-paid-detail')).toHaveCount(0);
  await expect(bubble.getByRole('button', { name: 'Not paid off' })).toBeVisible();
  // A tap anywhere shuts it.
  await hotel.getByText('Hotel Mulia', { exact: true }).click();
  await expect(bubble).toHaveCount(0);
  await expect(page.getByLabel('Pay Hotel Mulia')).toHaveCount(0);

  // Off again from the receipt, and the ✓ goes.
  await page.goto(receiptUrl);
  await expect(paidOff).toBeChecked();
  await paidOff.click();
  await expect(paidOff).not.toBeChecked();
  await openStatement(page);
  await expect(page.getByTestId('statement-paid-off')).toHaveCount(0);
  await expect(page.getByLabel('Pay Hotel Mulia')).toBeEnabled();

  // The ⋯ lists what applies: the mark, the fix, the receipt — and not Assign card, with one card on the account.
  let sheet = await openActions(page, 'Hotel Mulia');
  await expect(sheet.getByRole('button', { name: 'Paid off', exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Billed next statement' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Open receipt' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Assign card' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Paid off', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(hotel.getByTestId('statement-paid-off')).toBeVisible();

  // The ✓'s bubble takes it back too, asking first in the sheet the ✓ used to open.
  await (await openPaidBubble(page, hotel)).getByRole('button', { name: 'Not paid off' }).click();
  await expect(page.getByTestId('statement-paid-bubble')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Already paid off' })).toContainText('Hotel Mulia');
  await page.getByTestId('statement-not-paid-off').click();
  await expect(page.getByTestId('statement-paid-off')).toHaveCount(0);
  await (await openActions(page, 'Hotel Mulia')).getByRole('button', { name: 'Paid off', exact: true }).click();
  await expect(hotel.getByTestId('statement-paid-off')).toBeVisible();

  // Marked, the ⋯ offers to take it back instead.
  sheet = await openActions(page, 'Hotel Mulia');
  await expect(sheet.getByRole('button', { name: 'Paid off', exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Not paid off', exact: true }).click();
  await expect(page.getByTestId('statement-paid-off')).toHaveCount(0);

  // And it opens the receipt.
  sheet = await openActions(page, 'Hotel Mulia');
  await sheet.getByRole('button', { name: 'Open receipt' }).click();
  await expect(page).toHaveURL(receiptUrl);
  await expect(page.getByRole('heading', { name: 'Hotel Mulia' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Paid off', exact: true })).not.toBeChecked();
});

test('money back on the card reads Settled on its receipt and in its ⋯', async ({ page }) => {
  await setUp(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Hotel Mulia', paidWith: 'BCA Visa', category: 'Groceries', amount: '2000000' });

  // A refund of part of it, typed minus-first on the keypad, lands back on the card.
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  const keypad = page.getByTestId('keypad');
  for (const key of ['−', ...'500000']) await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: /^Into/ }).click();
  await choosePayment(page, 'BCA Visa', 'Into');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Hotel Mulia refund');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // Money back is settled rather than paid off, with no footer under the switch either.
  await openReceipt(page, 'Hotel Mulia refund', 'Groceries');
  const settled = page.getByRole('checkbox', { name: 'Settled', exact: true });
  await expect(settled).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Paid off', exact: true })).toHaveCount(0);
  await expect(page.getByText(/No credit to take off the statement/)).toHaveCount(0);

  await openStatement(page);
  const refund = page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia refund' });
  await expect(refund).toBeVisible();
  let sheet = await openActions(page, 'Hotel Mulia refund');
  await expect(sheet.getByRole('button', { name: 'Paid off', exact: true })).toHaveCount(0);
  // Nothing to move to a later statement on money back.
  await expect(sheet.getByRole('button', { name: 'Billed next statement' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Settled', exact: true }).click();
  await expect(refund.getByTestId('statement-paid-off')).toBeVisible();
  const bubble = await openPaidBubble(page, refund);
  await expect(bubble.getByTestId('statement-paid-how')).toHaveText('Settled');
  await expect(bubble.getByRole('button', { name: 'Not settled' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);
  // The purchase and the refund: no balancing line is drawn.
  await expect(page.getByTestId('statement-line')).toHaveCount(2);

  sheet = await openActions(page, 'Hotel Mulia refund');
  await sheet.getByRole('button', { name: 'Not settled', exact: true }).click();
  await expect(page.getByTestId('statement-paid-off')).toHaveCount(0);
});
