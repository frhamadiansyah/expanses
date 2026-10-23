import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage } from './card-section';

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = local(now);
/** The 15th of last month: with a statement on the last day, always on the previous statement. */
const LAST_MONTH = local(new Date(now.getFullYear(), now.getMonth() - 1, 15));

async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await openCard(page, { name: 'BCA Visa' });

  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Settings');
  // The 31st is clamped to each month's last day, so today is always inside the current statement.
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await page.getByRole('button', { name: 'Save terms' }).click();
  // Saving terms moves setup on to rewards; the statement is a page of its own, from the card.
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Statement');
  await expect(page.getByText('Statements')).toBeVisible();
}

async function buy(page: Page, description: string, amount: string, on: string) {
  await page.goto('/transactions');
  await addTransaction(page, { description, paidWith: 'BCA Visa', category: 'Groceries', amount, date: on });
}

async function openCardPage(page: Page) {
  await page.goto('/cards');
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
  await page.getByRole('button', { name: 'BCA Visa' }).click();
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Nothing billed');
});

test('chosen purchases are paid before the statement, and show as paid', async ({ page }) => {
  await setUp(page);
  await buy(page, 'Superindo', '450000', TODAY);
  await buy(page, 'Ranch Market', '80000', TODAY);
  await openStatement(page);

  await page.getByLabel('Pay Superindo').check();
  await page.getByLabel('Pay Ranch Market').check();
  await page.getByRole('button', { name: /^Pay Rp/ }).click();

  // Paid purchases stay ticked, and can no longer be unticked.
  const lines = page.getByTestId('statement-line');
  const superindo = page.getByLabel(/^Superindo, paid on/);
  await expect(superindo).toBeChecked();
  await expect(superindo).toBeDisabled();
  await expect(page.getByLabel(/^Ranch Market, paid on/)).toBeChecked();
  await expect(lines.filter({ hasText: 'payment' })).toContainText('530.000');

  // Deleting the payment frees them to be paid again.
  await page.goto('/transactions');
  await page.locator('li', { hasText: /BCA Visa payment/ }).first().click();
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  // Wait for the delete to land: the open form hides the row's text before anything is saved.
  await expect(page.getByRole('button', { name: 'Click again to delete' })).toHaveCount(0);
  await expect(page.locator('li', { hasText: /BCA Visa payment/ })).toHaveCount(0);
  await openStatement(page);
  await expect(page.getByLabel('Pay Superindo')).toBeEnabled();
  await expect(page.getByLabel('Pay Superindo')).not.toBeChecked();
});

test('the totals band splits the previous bill from what is unbilled, and names the batch paid ahead', async ({ page }) => {
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
  await page.getByRole('button', { name: /^Pay Rp/ }).click();
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Superindo' })).toContainText(/paid ahead \d+ \w+/);
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

  const tile = page.getByTestId('tile-left-to-pay');
  await expect(tile).toContainText('2.000.000');
  await expect(tile.getByTestId('due-date')).toContainText(/^Due \d+ \w+ · /);
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(tile.getByLabel('Amount (IDR)')).toHaveValue('2000000');
  await tile.getByRole('button', { name: 'Record payment' }).click();

  await expect(tile).toContainText('Paid in full');
  await expect(tile.getByTestId('due-date')).toHaveCount(0);
});

test('a card page survives a reload, and a link to an old tab lands on its page', async ({ page }) => {
  await setUp(page);
  await openCardPage(page);
  const cardUrl = page.url();
  await cardPage(page, 'Settings');
  await expect(page.getByRole('button', { name: 'Save terms' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save terms' })).toBeVisible();

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

  await page.getByLabel('Search statements').fill('mulia');
  const results = page.getByTestId('statement-search-results');
  await expect(results.getByRole('button')).toHaveCount(1);
  await results.getByRole('button', { name: /Hotel Mulia/ }).click();

  await expect(page.getByLabel('Search statements')).toHaveValue('');
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Hotel Mulia' })).toBeVisible();
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Superindo' })).toHaveCount(0);
});

test('on a desktop the settings lay their groups out in one column across the page', async ({ page }) => {
  await setUp(page);
  await openCardPage(page);
  await cardPage(page, 'Settings');
  const terms = await page.locator('section', { has: page.getByRole('heading', { name: 'Card terms' }) }).first().boundingBox();
  const cards = await page.locator('section', { has: page.getByRole('heading', { name: 'Cards on this account' }) }).first().boundingBox();
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
  await page.getByLabel('Last 4 digits').fill('1467');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByTestId('card-on-account')).toHaveCount(1);
  await page.getByLabel('Last 4 digits').fill('8820');
  await page.getByRole('button', { name: 'Add card' }).click();
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
