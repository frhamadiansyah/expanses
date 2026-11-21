import { expect, type Page, test } from '@playwright/test';
import { addPlastic, openAccount, openAccountHistory, openCard } from './accounts';
import { addForm, addTransaction, choosePayment, fillAmount, saveButton } from './add-transaction';
import { cardPage, chooseCardPayFrom, openCardPay, openStatementPay, payCard, payStatementPurchases, saveCardTerms, showCardBack } from './card-section';

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = local(now);
/** The 15th of last month: with a statement on the last day, always on the previous statement. */
const LAST_MONTH = local(new Date(now.getFullYear(), now.getMonth() - 1, 15));
/** The 10th of last month: on the same statement, five days before. */
const LAST_MONTH_EARLY = local(new Date(now.getFullYear(), now.getMonth() - 1, 10));

async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await openCard(page, { name: 'BCA Visa' });

  await page.goto('/wallet');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Settings');
  // The 31st is clamped to each month's last day, so today is always inside the current statement.
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);
  // Saving terms moves setup on to rewards; the statement is a page of its own, from the card.
  await page.getByRole('button', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Statement');
  await expect(page.getByTestId('statement-range')).toBeVisible();
}

async function buy(page: Page, description: string, amount: string, on: string) {
  await page.goto('/transactions');
  await addTransaction(page, { description, paidWith: 'BCA Visa', category: 'Groceries', amount, date: on });
}

async function openCardPage(page: Page) {
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
}

/** The card's statement, a page of its own opened from its round Statement button. */
async function openStatement(page: Page) {
  await openCardPage(page);
  await cardPage(page, 'Statement');
}

test('a purchase the bank billed a statement late moves to the next one', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await openCardPage(page);

  await showCardBack(page);
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('2.000.000');
  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  const hotel = page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' });
  await hotel.getByRole('button', { name: 'Billed next statement' }).click();
  await expect(page.getByTestId('statement-line')).toHaveCount(0);

  await page.getByRole('button', { name: 'Later statement' }).click();
  // It sits on the later statement now, with the way back beside it.
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' }).getByRole('button', { name: 'Use purchase date' })).toBeVisible();
  // And the card's summary has nothing billed on the statement it left.
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await showCardBack(page);
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Nothing billed');
});

test('chosen purchases are paid before the statement, and show as paid', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Superindo', '450000', TODAY);
  await buy(page, 'Ranch Market', '80000', TODAY);
  await openStatement(page);

  await page.getByLabel('Pay Superindo').check();
  await page.getByLabel('Pay Ranch Market').check();
  // The select bar on top counts them; ✕ clears every tick and the bar goes.
  const bar = page.getByTestId('statement-select-bar');
  await expect(bar).toContainText('2 selected');
  await bar.getByRole('button', { name: 'Clear' }).click();
  await expect(bar).toHaveCount(0);
  await expect(page.getByLabel('Pay Superindo')).not.toBeChecked();
  await page.getByLabel('Pay Superindo').check();
  await page.getByLabel('Pay Ranch Market').check();
  await expect(bar).toContainText('2 selected');
  // Pay opens the card's own "Pay credit card" screen, the two purchases listed under it and the amount their total.
  const form = await openStatementPay(page);
  await expect(page.getByText('Paying 2 purchases', { exact: true })).toBeVisible();
  await expect(form).toContainText('Superindo');
  await expect(form).toContainText('Ranch Market');
  await expect(form.getByLabel('Amount', { exact: true })).toHaveValue(/^530\.?000$/);
  // The total is fixed, and payCardPurchases records no fee, so neither is offered.
  await expect(form.getByLabel('Amount', { exact: true })).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Clear amount' })).toHaveCount(0);
  await expect(form.getByLabel(/^Fee in /)).toHaveCount(0);
  await expect(form.getByLabel('Note')).toHaveValue('Credit card payment');
  await expect(form.getByRole('radio')).toHaveCount(0);
  await expect(saveButton(form)).toBeDisabled();
  await chooseCardPayFrom(form, 'BCA Tahapan');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(/\/cards\/[^/]+\/statement$/);
  await expect(bar).toHaveCount(0);

  // Paid purchases stay ticked, and can no longer be unticked.
  const lines = page.getByTestId('statement-line');
  const superindo = page.getByLabel(/^Superindo, paid on/);
  await expect(superindo).toBeChecked();
  await expect(superindo).toBeDisabled();
  await expect(page.getByLabel(/^Ranch Market, paid on/)).toBeChecked();
  await expect(lines.filter({ hasText: 'payment' })).toContainText('530.000');

  // Deleting the payment frees them to be paid again. Cashflow lists no card payment (owner 2026-11-16): the bank's
  // history and the statement do.
  await openAccountHistory(page, 'BCA Tahapan');
  await page.locator('li', { hasText: /Credit card payment/ }).first().click();
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  // Wait for the delete to land: the open form hides the row's text before anything is saved.
  await expect(page.getByRole('button', { name: 'Click again to delete' })).toHaveCount(0);
  await expect(page.locator('li', { hasText: /Credit card payment/ })).toHaveCount(0);
  await openStatement(page);
  await expect(page.getByLabel('Pay Superindo')).toBeEnabled();
  await expect(page.getByLabel('Pay Superindo')).not.toBeChecked();
});

test('the totals band splits the previous bill from what is unbilled, and names the day the batch was paid', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await buy(page, 'Superindo', '450000', TODAY);
  await openStatement(page);

  // Nothing paid yet: the previous bill stands whole beside what this cycle has gathered.
  const band = page.getByTestId('statement-band');
  await expect(band).toContainText('Previous bill');
  await expect(band).toContainText('2.000.000');
  await expect(band).toContainText('Unbilled');
  await expect(band).toContainText('450.000');
  await expect(page.getByTestId('statement-total')).toContainText('Upcoming bill');
  await expect(page.getByTestId('statement-total')).toContainText('2.450.000');

  // Tick this cycle's purchase and pay it: the bank clears the older bill first, so that is where it lands.
  await page.getByLabel('Pay Superindo').check();
  await payStatementPurchases(page, 'BCA Tahapan');
  // Paid one by one: the one paid ✓, and the pay day in green words at the start of its subtitle.
  const superindo = page.getByTestId('statement-line').filter({ hasText: 'Superindo' });
  await expect(superindo.getByTestId('statement-paid-how')).toHaveText(/^Paid \d+ \w+$/);
  await expect(page.getByLabel(/^Superindo, paid on/)).toBeChecked();
  await expect(page.getByTestId('statement-line').filter({ hasText: 'payment' })).toContainText('for 1 purchase');
  // Rp 450.000 of the Rp 2.000.000 previous bill is settled, and the upcoming bill drops by the same.
  await expect(band).toContainText('1.550.000');
  await expect(page.getByTestId('statement-total')).toContainText('2.000.000');

  // The closed statement it paid down says what is left of that bill, not what is unbilled.
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(band).toContainText('Paid');
  await expect(band).toContainText('Still to pay');
  await expect(band).toContainText('1.550.000');
  await expect(page.getByTestId('statement-total')).toContainText('Total bill');
});

test('the last statement is paid from the card’s Current bill tile', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await openCardPage(page);

  await showCardBack(page);
  const tile = page.getByTestId('tile-left-to-pay');
  await expect(tile).toContainText('2.000.000');
  await expect(tile.getByTestId('due-date')).toContainText(/^Due \d+ \w+ · /);
  // Pay opens the Add screen locked to paying the card, the bill filled in; From is chosen, then Save.
  const form = await openCardPay(page);
  await expect(form.getByLabel('Amount', { exact: true })).toHaveValue(/^2\.?000\.?000$/);
  await chooseCardPayFrom(form, 'BCA Tahapan');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await showCardBack(page);
  await expect(tile).toContainText('Paid in full');
  await expect(tile.getByTestId('due-date')).toHaveCount(0);
});

test('Pay opens the Add screen locked to the card with the amount filled in; a smaller amount records a part payment', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await openCardPage(page);

  await showCardBack(page);
  const tile = page.getByTestId('tile-left-to-pay');
  const form = await openCardPay(page);
  await expect(form.getByLabel('Amount', { exact: true })).toHaveValue(/^2\.?000\.?000$/);
  await expect(form.getByText('IDR', { exact: true }).first()).toBeVisible();
  await expect(form.getByRole('button', { name: 'From' })).toBeVisible();
  await expect(form.getByLabel('Date')).toBeVisible();
  await page.goBack();
  await expect(form).toHaveCount(0);

  await payCard(page, { from: 'BCA Tahapan', amount: '500000' });
  await showCardBack(page);
  await expect(tile.getByTestId('tile-unpaid-balance')).toContainText('1.500.000');
});

test('a payment made with Pay covers the statement’s purchases oldest first, and the rest is paid for what is left', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Ride to airport', '300000', LAST_MONTH_EARLY);
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await openCardPage(page);

  // A part payment from the card page: it covers the older purchase whole and some of the newer one.
  await showCardBack(page);
  await payCard(page, { from: 'BCA Tahapan', amount: '500000' });

  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  const ride = page.getByTestId('statement-line').filter({ hasText: 'Ride to airport' });
  const hotel = page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' });
  await expect(ride.getByTestId('statement-covered')).toBeVisible();
  await expect(ride.getByTestId('statement-paid-how')).toHaveText(/^Paid with the \d+ \w+ payment$/);
  await expect(page.getByLabel('Pay Ride to airport')).toHaveCount(0);
  await expect(hotel).toContainText(/200\.000 covered, Rp\s1\.800\.000 left/);
  await expect(page.getByTestId('statement-group')).toContainText(/1 of 2 paid/i);
  // The words on each row say how it was paid: no legend under the statement.
  await expect(page.getByTestId('statement-legend')).toHaveCount(0);
  await expect(hotel.getByTestId('statement-paid-how')).toHaveCount(0);

  // The covered ✓ says which payment covered it, and is not a switch.
  await ride.getByTestId('statement-covered').click();
  const why = page.getByRole('dialog', { name: 'Ride to airport' });
  await expect(why).toContainText('Covered by');
  await expect(why).toContainText(/Paid with the card’s payment of Rp\s500\.000\. Deleting that payment makes it owed again\./);
  await why.getByRole('button', { name: 'Close' }).click();
  await expect(why).toHaveCount(0);

  // Ticked and paid, the part-covered purchase pays only what is left: the statement ends at exactly nothing.
  await page.getByLabel('Pay Hotel Mulia').check();
  const form = await openStatementPay(page);
  await expect(page.getByText('Paying 1 purchase', { exact: true })).toBeVisible();
  await expect(form).toContainText('Hotel Mulia');
  await expect(form.getByLabel('Amount', { exact: true })).toHaveValue(/^1\.?800\.?000$/);
  await chooseCardPayFrom(form, 'BCA Tahapan');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  // Back on the statement it was paid from, the earlier one, not today's.
  await expect(page).toHaveURL(/\/statement\?back=1$/);
  // Paid for what was left, it is covered by the two payments together, not settled on its own.
  await expect(hotel.getByTestId('statement-covered')).toBeVisible();
  await expect(hotel.getByTestId('statement-paid-how')).toHaveText('Paid with 2 payments');
  await expect(page.getByTestId('statement-group')).toContainText(/All paid/i);
  await expect(ride.getByTestId('statement-covered')).toBeVisible();
  await expect(page.getByTestId('statement-band')).toContainText(/Still to pay\s*Rp\s0\s*Total bill/);
});

test('a card page survives a reload, and a link to an old tab lands on its page', async ({ page }) => {
  await setUp(page);
  await openCardPage(page);
  const cardUrl = page.url();
  await cardPage(page, 'Settings');
  await expect(page.getByLabel('Billing date')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Billing date')).toBeVisible();

  // The tabs became pages: each old `?tab=` link is sent to the page holding what the tab did.
  for (const [tab, path, title] of [
    ['statement', '/statement', 'Statement'],
    ['points', '/points', "This statement's points"],
    ['rules', '/settings', 'Settings'],
    ['card', '/settings', 'Settings'],
  ] as const) {
    await page.goto(`${cardUrl}?tab=${tab}`);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible();
  }
});

test('searching finds a purchase on an earlier statement and opens that statement', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await buy(page, 'Superindo', '450000', TODAY);
  await openStatement(page);

  await page.getByRole('button', { name: 'Search statements' }).click();
  await page.getByRole('searchbox', { name: 'Search statements' }).fill('mulia');
  const results = page.getByTestId('statement-search-results');
  await expect(results.getByRole('button')).toHaveCount(1);
  await results.getByRole('button', { name: /Hotel Mulia/ }).click();

  await expect(page.getByRole('searchbox', { name: 'Search statements' })).toHaveCount(0);
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' })).toBeVisible();
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Superindo' })).toHaveCount(0);
});

test('on a desktop the settings lay their groups out in one column across the page', async ({ page }) => {
  await setUp(page);
  await openCardPage(page);
  await cardPage(page, 'Settings');
  const terms = await page.locator('section', { has: page.getByRole('heading', { name: 'Card terms' }) }).first().boundingBox();
  const cards = await page.locator('section', { has: page.getByRole('heading', { name: 'Cardholders' }) }).first().boundingBox();
  expect(terms && cards).toBeTruthy();
  expect(Math.round(terms!.x)).toBe(Math.round(cards!.x));
  expect(Math.round(terms!.width)).toBe(Math.round(cards!.width));
  // A desktop is not a phone held sideways: the terms' fields sit side by side across that width.
  expect(terms!.width).toBeGreaterThan(600);
});

test('a purchase on a closed statement is marked paid off from the statement, and taken back with its ✓', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await openStatement(page);
  await page.getByRole('button', { name: 'Earlier statement' }).click();

  const hotel = page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' });
  await hotel.getByRole('button', { name: 'Mark Hotel Mulia already paid off' }).click();
  // One line, no balancing settlement drawn, and the Pay box gives way to the ✓.
  await expect(page.getByTestId('statement-line')).toHaveCount(1);
  await expect(hotel.getByTestId('statement-paid-off')).toBeVisible();
  await expect(hotel.getByTestId('statement-paid-how')).toHaveText('Paid before cicis');
  await expect(page.getByLabel('Pay Hotel Mulia')).toHaveCount(0);

  await hotel.getByTestId('statement-paid-off').click();
  await page.getByTestId('statement-not-paid-off').click();
  await expect(page.getByLabel('Pay Hotel Mulia')).toBeEnabled();
  await expect(page.getByTestId('statement-paid-off')).toHaveCount(0);
});

test('purchases under Card not recorded are set to one card at once with Assign card', async ({ page }) => {
  await setUp(page);
  // Bought before any card was recorded on the account: no purchase knows which card it was.
  await buy(page, 'Superindo', '450000', TODAY);
  await buy(page, 'Ranch Market', '80000', TODAY);
  await openCardPage(page);
  await cardPage(page, 'Settings');
  await addPlastic(page, '1467');
  await expect(page.getByTestId('card-on-account')).toHaveCount(1);
  await addPlastic(page, '8820');
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);
  await page.getByRole('button', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Statement');

  // Two cards: the statement is split by card, and both purchases sit under Card not recorded.
  const unrecorded = page.getByRole('region', { name: 'Card not recorded' });
  await expect(unrecorded.getByTestId('statement-line')).toHaveCount(2);
  await unrecorded.getByRole('button', { name: 'Assign card' }).click();
  const sheet = page.getByRole('dialog', { name: 'Assign card' });
  await expect(sheet.getByRole('button', { name: 'Primary ···· 1467' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Supplementary ···· 8820' }).click();

  await expect(sheet).toHaveCount(0);
  await expect(unrecorded).toHaveCount(0);
  const supplementary = page.getByRole('region', { name: 'Supplementary ···· 8820' });
  await expect(supplementary.getByTestId('statement-line')).toHaveCount(2);
  await expect(supplementary).toContainText('Superindo');
  await expect(supplementary).toContainText('Ranch Market');
});

test('money back on the card can be marked settled before the app, so it does not sit as a credit', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Hotel Mulia', '2000000', TODAY);
  // A refund of part of it, typed minus-first, lands back on the card.
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await fillAmount(page, form, '-500000');
  await form.getByRole('button', { name: /^Into/ }).click();
  await choosePayment(page, 'BCA Visa', 'Into');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Hotel Mulia refund');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await openStatement(page);
  const refund = page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia refund' });
  await expect(refund).toBeVisible();
  // Money back is not something to pay, so it has no Pay box; it can be marked settled the way a purchase is paid off.
  await expect(page.getByLabel('Pay Hotel Mulia refund')).toBeHidden();
  await refund.getByRole('button', { name: 'Mark Hotel Mulia refund already settled' }).click();
  await expect(refund.getByTestId('statement-paid-off')).toBeVisible();
  await expect(refund.getByTestId('statement-paid-how')).toHaveText('Settled');
  // No balancing line is drawn: the two lines are the purchase and the refund.
  await expect(page.getByTestId('statement-line')).toHaveCount(2);

  // Taken back from its ✓.
  await refund.getByTestId('statement-paid-off').click();
  await expect(page.getByRole('dialog', { name: 'Already settled' })).toBeVisible();
  await page.getByTestId('statement-not-paid-off').click();
  await expect(page.getByTestId('statement-paid-off')).toHaveCount(0);
  await expect(refund.getByRole('button', { name: 'Mark Hotel Mulia refund already settled' })).toBeVisible();
});
