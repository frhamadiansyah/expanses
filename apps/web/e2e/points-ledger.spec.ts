import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, cardPointsPage, walletCard, saveCardTerms } from './card-section';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** A card earning 1 point per Rp 2.500, with one purchase on it. Ends on the card's Settings, by its points. */
async function cardWithAPurchase(page: Page, on?: string, minimum?: string) {
  await openCard(page, { name: 'CIMB Octo' });

  await page.goto('/wallet');
  await walletCard(page, 'CIMB Octo').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  await page.getByRole('button', { name: 'Set up rewards' }).click();

  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule name').fill('Base');
  await page.getByLabel('Points', { exact: true }).fill('1');
  await page.getByLabel('Per spend').fill('2500');
  if (minimum) await page.getByLabel('Minimum transaction').fill(minimum);
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'CIMB Octo', category: 'Groceries', amount: '250000', date: on });

  await page.goto('/wallet');
  await walletCard(page, 'CIMB Octo').click();
  await cardPage(page, 'Settings');
}

/** From the card's Settings back to its summary, and on to this statement's points. */
async function toPoints(page: Page) {
  await page.getByRole('button', { name: 'CIMB Octo', exact: true }).click();
  await cardPage(page, 'Points');
}

/** From the card's Settings to the programme it earns into, where its balance is worked with: summary, Points, the programme row. */
async function openProgramme(page: Page) {
  await toPoints(page);
  await openProgrammeFromPoints(page);
}

/** From this statement's points to the programme row at its top. */
async function openProgrammeFromPoints(page: Page) {
  await page.getByTestId('statement-points-programme').click();
  await expect(page.getByTestId('programme-balance')).toBeVisible();
}

test('a balance says how much of it the app only worked out', async ({ page }) => {
  await cardWithAPurchase(page);
  await openProgramme(page);

  // 250.000 at 1 per 2.500 is 100 points, and nobody has confirmed them.
  await expect(page.getByTestId('programme-balance')).toContainText('100');
  await expect(page.getByTestId('programme-provenance')).toContainText('0 posted');
  await expect(page.getByTestId('programme-provenance')).toContainText('100 estimated');
});

test('typing what the bank gave moves points from estimated to posted', async ({ page }) => {
  await cardWithAPurchase(page);

  // Per-purchase figures only exist for a card that credits that way — Jenius and Mandiri do.
  await expect(page.getByLabel('Bank credits points')).toBeVisible();
  await page.getByLabel('Bank credits points').selectOption('per_transaction');
  await expect(page.getByLabel('Bank credits points')).toHaveValue('per_transaction');
  await toPoints(page);
  await cardPointsPage(page, 'Purchases');
  const row = page.getByTestId('purchase').filter({ hasText: 'Superindo' });
  await row.getByLabel('Actual points for Superindo').fill('120');
  await row.getByRole('button', { name: 'Save actual for Superindo' }).click();
  await expect(row).toContainText('Bank credited 120 points');
  // The row's own figure is now the bank's, not the estimate, and the gap note does not read as a failed save.
  await expect(row.getByTestId(/^estimate-/)).toHaveText('120 points');
  await expect(row).toContainText('Saved. The bank\'s figure differs from the estimate.');

  // Away and back: the field still holds what was saved, and the row still reads it.
  await page.getByRole('button', { name: 'Points' }).click();
  await cardPointsPage(page, 'Purchases');
  const again = page.getByTestId('purchase').filter({ hasText: 'Superindo' });
  await expect(again.getByLabel('Actual points for Superindo')).toHaveValue('120');
  await expect(again.getByTestId(/^estimate-/)).toHaveText('120 points');
  // Typing the estimate itself reads as matching the bank.
  await again.getByLabel('Actual points for Superindo').fill('100');
  await again.getByRole('button', { name: 'Save actual for Superindo' }).click();
  await expect(again).toContainText('Matches the bank');
  await again.getByLabel('Actual points for Superindo').fill('120');
  await again.getByRole('button', { name: 'Save actual for Superindo' }).click();
  await expect(again).toContainText('Bank credited 120 points');

  // Back to this statement's points and into the programme, where the balance the card earns into is read.
  await page.getByRole('button', { name: 'Points' }).click();
  await openProgrammeFromPoints(page);
  await expect(page.getByTestId('programme-provenance')).toContainText('120 posted');
  await expect(page.getByTestId('programme-provenance')).toContainText('0 estimated');
  await expect(page.getByTestId('programme-balance')).toContainText('120');
});

test('a balance read in the app anchors the ledger', async ({ page }) => {
  await cardWithAPurchase(page);
  await openProgramme(page);

  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Adjust' }).click();
  await page.getByLabel('Actual balance').fill('500');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByTestId('programme-balance')).toHaveText('500 points');
  // The card's points page reads the same balance: the programme's it earns into.
  await page.goBack();
  await expect(page.getByTestId('statement-points-balance')).toContainText('500');
});

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

/** A date far enough back that a two-year policy kills the points within the sixty-day window. */
function monthsAgo(months: number): string {
  const now = new Date();
  const then = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 15));
  return then.toISOString().slice(0, 10);
}

/** How the points die is the programme's, set in its settings. */
async function setExpiry(page: Page, months: string) {
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Expiry' }).click();
  await page.getByLabel('Points expire').selectOption('months_from_earn');
  await page.getByLabel('Months they last').fill(months);
  await page.getByRole('button', { name: 'Save expiry' }).click();
  await expect(page.getByTestId('programme-expiry-summary')).toBeVisible();
  await page.goBack();
}

test('warns on the dashboard about points that are about to die', async ({ page }) => {
  // In the previous cycle, so the card page derives it. Points earned before the cycles on screen are
  // not in the ledger at all, which is why this date is recent rather than years back.
  await cardWithAPurchase(page, monthsAgo(1));
  await openProgramme(page);

  // Two months from a purchase one month ago: it dies inside the sixty-day window.
  await setExpiry(page, '2');
  // Opening the programme again re-derives the batches, which is where the expiry date gets stamped.
  await page.reload();
  await expect(page.getByTestId('programme-expiry')).toContainText('100 expire');

  // What waits is a screen of its own since the net-worth pages were merged: the dashboard carries the count in its
  // corner, and the lines are read where they are drawn.
  await page.goto('/net-worth/attention');
  // One specific line: the card's name alone also matches its link in the account list.
  await expect(page.getByText(/100 points on CIMB Octo expire on/)).toBeVisible();
});

/** Redeems points on the programme's page. */
async function redeem(page: Page, points: string, fetched: string) {
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Convert' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Something else…' }).click();
  await page.getByRole('dialog').getByLabel('Points used').fill(points);
  await page.getByLabel('What for').fill('Statement credit');
  await page.getByLabel('What it fetched').fill(fetched);
  await page.getByRole('button', { name: 'Save redemption' }).click();
}

test('spending points takes them off the balance, oldest first', async ({ page }) => {
  await cardWithAPurchase(page);
  await openProgramme(page);
  await expect(page.getByTestId('programme-balance')).toContainText('100');

  await redeem(page, '40', '1000');

  await expect(page.getByTestId('programme-balance')).toHaveText('60 points');
  await expect(page.getByTestId('programme-history')).toContainText('Statement credit');
});

test('catches a card up from its programme page, without complaint; the card page has no Catch up', async ({ page }) => {
  await cardWithAPurchase(page);
  await toPoints(page);
  await expect(page.getByRole('button', { name: /^Catch up/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'CIMB Octo', exact: true }).click();
  await cardPage(page, 'Settings');
  await openProgramme(page);

  // Catch up is on the card's own page, behind the card's row in Settings.
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').getByRole('link', { name: /CIMB Octo/ }).click();
  // Nothing older than this statement: the one month is listed, there is no Catch up row, and no error.
  await expect(page.getByTestId('programme-card-statement')).toHaveCount(1);
  await expect(page.getByText('Catch up earlier cycles')).toHaveCount(0);
  await expect(page.getByTestId('programme-show-earlier')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('the card page already lists a statement from before the app was opened, and a typed figure makes it Posted', async ({ page }) => {
  // Two purchases: this cycle's, and one four months back that opening the programme does not reach.
  await cardWithAPurchase(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Old shop', paidWith: 'CIMB Octo', category: 'Groceries', amount: '500000', date: monthsAgo(4) });
  await page.goto('/wallet');
  await walletCard(page, 'CIMB Octo').click();
  await cardPage(page, 'Points');
  await openProgrammeFromPoints(page);
  await expect(page.getByTestId('programme-balance')).toHaveText('100 points');

  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').getByRole('link', { name: /CIMB Octo/ }).click();
  // No tap: the older month is worked out as the page opens.
  // Every statement from the first purchase to now is listed, the empty ones with nothing.
  await expect(page.getByTestId('programme-card-statement').first()).toBeVisible();
  expect(await page.getByTestId('programme-card-statement').count()).toBeGreaterThanOrEqual(4);
  const old = page.getByTestId('programme-card-statement').filter({ hasText: '200' });
  await expect(old).toHaveCount(1);
  await expect(old).toContainText('Estimated');
  await page.screenshot({ path: `${SHOTS}/programme-catchup-1.png`, fullPage: true });

  // Tap a month, type what the statement shows, save: it is Posted.
  await old.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Statement closed')).toBeVisible();
  await expect(sheet.getByText('Estimated from purchases')).toBeVisible();
  await expect(sheet.getByText('Clear typed points')).toHaveCount(0);
  await sheet.getByLabel('Points on the statement').fill('260');
  await page.screenshot({ path: `${SHOTS}/programme-catchup-2.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save statement points' }).click();
  await expect(page.getByTestId('programme-card-statement').filter({ hasText: '260' })).toContainText('Posted');

  // Typed points can be cleared, which brings the estimate back.
  await page.getByTestId('programme-card-statement').filter({ hasText: '260' }).click();
  await page.getByRole('dialog').getByText('Clear typed points').click();
  await expect(page.getByTestId('programme-card-statement').filter({ hasText: 'Posted' })).toHaveCount(0);
  await expect(page.getByTestId('programme-card-statement').filter({ hasText: '200' })).toContainText('Estimated');

  // Back lands in Settings, and the balance behind it has the older points.
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByRole('dialog').getByText('Cards earning here')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('programme-balance')).toHaveText('300 points');
});

test('the amber earned-nothing line opens only the purchases that earned nothing', async ({ page }) => {
  await cardWithAPurchase(page, undefined, '100000');
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi kecil', paidWith: 'CIMB Octo', category: 'Groceries', amount: '20000' });
  await page.goto('/wallet');
  await walletCard(page, 'CIMB Octo').click();
  await cardPage(page, 'Points');

  const nothing = page.getByTestId('earned-nothing');
  await expect(nothing).toContainText('earned nothing');
  await expect(nothing).toContainText('20.000');
  await nothing.getByRole('link').click();
  await expect(page).toHaveURL(/\/points\/purchases\?filter=nothing/);
  await expect(page.getByTestId('purchases-filter')).toContainText('Showing purchases that earned nothing');
  await expect(page.getByTestId('purchase')).toHaveCount(1);
  await expect(page.getByTestId('purchase')).toContainText('Kopi kecil');

  await page.getByRole('button', { name: /Show all/ }).click();
  await expect(page.getByTestId('purchases-filter')).toHaveCount(0);
  await expect(page.getByTestId('purchase')).toHaveCount(2);
});
