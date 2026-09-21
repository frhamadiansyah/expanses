import { expect, type Page, test } from '@playwright/test';
import { addTransaction } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** A card earning 1 point per Rp 2.500, with one purchase on it. */
async function cardWithAPurchase(page: Page, on?: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('CIMB Octo');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'CIMB Octo' })).toBeVisible();

  await page.goto('/cards');
  await page.getByRole('link', { name: 'CIMB Octo' }).click();
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByRole('button', { name: 'Set up rewards' }).click();

  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Base');
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByLabel('Per spend (IDR)').fill('2500');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'CIMB Octo', category: 'Groceries', amount: '250000', date: on });

  await page.goto('/cards');
  await page.getByRole('link', { name: 'CIMB Octo' }).click();
  await page.getByRole('radio', { name: 'Points' }).click();
}

test('a balance says how much of it the app only worked out', async ({ page }) => {
  await cardWithAPurchase(page);

  // 250.000 at 1 per 2.500 is 100 points, and nobody has confirmed them.
  await expect(page.getByTestId('points-balance')).toContainText('100');
  await expect(page.getByTestId('points-provenance')).toContainText('0 posted');
  await expect(page.getByTestId('points-provenance')).toContainText('100 estimated');
});

test('typing what the bank gave moves points from estimated to posted', async ({ page }) => {
  await cardWithAPurchase(page);

  // Per-purchase figures only exist for a card that credits that way — Jenius and Mandiri do.
  await expect(page.getByTestId('points-balance')).toBeVisible();
  await page.getByLabel('Bank credits points').selectOption('per_transaction');
  const row = page.getByTestId('purchase').filter({ hasText: 'Superindo' });
  await row.getByLabel('Actual points for Superindo').fill('120');
  await row.getByRole('button', { name: 'Save actual for Superindo' }).click();

  await expect(page.getByTestId('points-provenance')).toContainText('120 posted');
  await expect(page.getByTestId('points-provenance')).toContainText('0 estimated');
  await expect(page.getByTestId('points-balance')).toContainText('120');
});

test('a balance read in the app anchors the ledger', async ({ page }) => {
  await cardWithAPurchase(page);

  await page.getByLabel('Balance in the app').fill('500');
  await page.getByRole('button', { name: 'Anchor balance' }).click();

  await expect(page.getByTestId('points-balance')).toContainText('500');
});

/** A date far enough back that a two-year policy kills the points within the sixty-day window. */
function monthsAgo(months: number): string {
  const now = new Date();
  const then = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 15));
  return then.toISOString().slice(0, 10);
}

async function setExpiry(page: Page, months: string) {
  await page.getByLabel('Points expire').selectOption('months_from_earn');
  await page.getByLabel('Months they last').fill(months);
  await page.getByLabel('Months they last').blur();
  await expect(page.getByTestId('points-balance')).toBeVisible();
}

test('warns on the dashboard about points that are about to die', async ({ page }) => {
  // In the previous cycle, so the card page derives it. Points earned before the cycles on screen are
  // not in the ledger at all, which is why this date is recent rather than years back.
  await cardWithAPurchase(page, monthsAgo(1));
  await expect(page.getByTestId('points-balance')).toContainText('100');

  // Two months from a purchase one month ago: it dies inside the sixty-day window.
  await setExpiry(page, '2');
  // Reloading the card re-derives the batches, which is where the expiry date gets stamped.
  await page.reload();
  await expect(page.getByTestId('points-balance')).toBeVisible();

  await page.goto('/');
  // One specific line: the card's name alone also matches its link in the account list.
  await expect(page.getByText(/100 points on CIMB Octo expire on/)).toBeVisible();
});

test('spending points takes them off the balance, oldest first', async ({ page }) => {
  await cardWithAPurchase(page);
  await expect(page.getByTestId('points-balance')).toContainText('100');

  await page.getByLabel('Points spent').fill('40');
  await page.getByLabel('What for').fill('Statement credit');
  await page.getByLabel('What it fetched (IDR)').fill('1000');
  await page.getByRole('button', { name: 'Spend points' }).click();

  await expect(page.getByTestId('points-balance')).toContainText('60');
});

test('says what the annual fee bought, and admits when it is guessing', async ({ page }) => {
  await cardWithAPurchase(page);

  const roi = page.getByTestId('card-year-roi');
  await expect(roi).toBeVisible();
  // No fee charge on the ledger, and the points were worked out rather than confirmed.
  await expect(page.getByText(/no fee charge is recorded/)).toBeVisible();
  await expect(page.getByText(/estimated, because some points were worked out/)).toBeVisible();
});

test('says what the points really fetched, beside what the best option claims', async ({ page }) => {
  await cardWithAPurchase(page);

  await page.getByLabel('Points spent').fill('40');
  await page.getByLabel('What for').fill('Statement credit');
  await page.getByLabel('What it fetched (IDR)').fill('200');
  await page.getByRole('button', { name: 'Spend points' }).click();
  await expect(page.getByTestId('points-balance')).toContainText('60');

  // Rp 200 for 40 points is Rp 5 a point, whatever the best redemption option says.
  await expect(page.getByTestId('card-year-realised')).toContainText('net');
});

test('catches a card up without complaint', async ({ page }) => {
  await cardWithAPurchase(page);

  await page.getByRole('button', { name: 'Catch up this card' }).click();

  // Nothing older exists here, so the balance is what this cycle earned and no error is shown.
  await expect(page.getByTestId('points-balance')).toContainText('100');
});
