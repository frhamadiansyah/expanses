import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, saveCardTerms, walletCard } from './card-section';

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** A card earning 1 point per Rp 2.500 with one purchase of Rp 250.000 (100 points), then on to its programme page. */
async function openProgramme(page: Page) {
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
  await page.getByLabel('Per spend (IDR)').fill('2500');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('1 per Rp')).toBeVisible();
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'CIMB Octo', category: 'Groceries', amount: '250000' });
  await page.goto('/wallet');
  await walletCard(page, 'CIMB Octo').click();
  await cardPage(page, 'Points');
  await page.getByTestId('statement-points-programme').click();
  await expect(page.getByTestId('programme-balance')).toBeVisible();
}

const actions = (page: Page) => page.getByRole('group', { name: 'Actions' });

test('a programme has four buttons: Convert, Adjust, Expiry, Settings; Redeem, Worth and History are gone', async ({ page }) => {
  await openProgramme(page);
  await expect(actions(page).getByText(/^(Convert|Adjust|Expiry|Settings)$/)).toHaveText(['Convert', 'Adjust', 'Expiry', 'Settings']);
  await expect(actions(page).getByText('Redeem')).toHaveCount(0);
  await expect(actions(page).getByText('Worth')).toHaveCount(0);
  await expect(actions(page).getByText('History')).toHaveCount(0);
  // The corner gear is gone: Settings is a round button.
  await expect(page.locator('header').getByRole('button', { name: 'Programme settings' })).toHaveCount(0);
});

test('Convert spends points on a use, and the History row says what for', async ({ page }) => {
  await openProgramme(page);
  await expect(page.getByTestId('programme-balance')).toHaveText('100 points');

  await actions(page).getByRole('button', { name: 'Convert' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('To another programme')).toBeVisible();
  await expect(sheet.getByText('Or use on')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/programme-four-2.png`, fullPage: true });
  await sheet.getByRole('button', { name: 'Flight' }).click();
  await expect(sheet.getByText('Use on Flight')).toBeVisible();
  await sheet.getByLabel('Points used').fill('40');
  await sheet.getByLabel('What it fetched (IDR)').fill('1000');
  await page.getByRole('button', { name: 'Save redemption' }).click();

  await expect(page.getByTestId('programme-balance')).toHaveText('60 points');
  await expect(page.getByTestId('programme-history')).toContainText('Flight');
  await expect(page.getByTestId('programme-history')).toContainText('Redeemed');

  // Something else asks what for.
  await actions(page).getByRole('button', { name: 'Convert' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Something else…' }).click();
  await page.getByRole('dialog').getByLabel('Points used').fill('10');
  await page.getByRole('dialog').getByLabel('What for').fill('Lounge pass');
  await page.getByRole('button', { name: 'Save redemption' }).click();
  await expect(page.getByTestId('programme-balance')).toHaveText('50 points');
  await expect(page.getByTestId('programme-history')).toContainText('Lounge pass');
});

test('a value per point in Settings shows the ≈ figure and Worth about on the statement points page', async ({ page }) => {
  await openProgramme(page);
  await expect(page.getByTestId('programme-provenance')).not.toContainText('≈');

  await actions(page).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Value per point/ })).toContainText('Not set');
  await page.getByRole('dialog').getByRole('button', { name: /Value per point/ }).click();
  await page.getByLabel('1 point = Rp').fill('110');
  await page.getByRole('button', { name: 'Save value' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Value per point/ })).toContainText(/Rp\s110/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // 100 points at Rp 110.
  await expect(page.getByTestId('programme-provenance')).toContainText(/≈ Rp\s11\.000/);
  await expect(page.getByTestId('programme-provenance')).toContainText('posted');
  await page.screenshot({ path: `${SHOTS}/programme-four-1.png`, fullPage: true });

  await page.goBack();
  await expect(page.getByTestId('statement-points-balance')).toContainText(/≈ Rp\s11\.000/);
  await expect(page.getByText('Worth about')).toBeVisible();
});

test('Expiry holds the policy; with points that can die it lists what dies when', async ({ page }) => {
  await openProgramme(page);
  await actions(page).getByRole('link', { name: 'Expiry' }).click();
  // Never: the page is the one row.
  await expect(page.getByLabel('Points expire')).toHaveValue('none');
  await expect(page.getByTestId('programme-expiry-summary')).toHaveCount(0);
  await expect(page.getByTestId('programme-expiry-lots')).toHaveCount(0);
  await page.getByLabel('Points expire').selectOption('months_from_earn');
  await page.getByLabel('Months they last').fill('24');
  await page.getByRole('button', { name: 'Save expiry' }).click();
  await page.goBack();
  await page.reload();
  await expect(actions(page).getByText(/^(Convert|Adjust|Expiry|Settings)$/)).toHaveCount(4);

  await actions(page).getByRole('link', { name: 'Expiry' }).click();
  await expect(page.getByLabel('Points expire')).toHaveValue('months_from_earn');
  await expect(page.getByTestId('programme-expiry-summary')).toContainText('Expiring in 30 days');
  await expect(page.getByTestId('programme-expiry-summary')).toContainText('Expiring in 90 days');
  await expect(page.getByTestId('programme-expiry-summary')).toContainText('Next to expire');
  await expect(page.getByTestId('programme-expiry-lots')).toContainText('By date');
  await expect(page.getByTestId('programme-expiry-lot')).toHaveCount(1);
  await expect(page.getByTestId('programme-expiry-lot')).toContainText('100 points');
  await page.screenshot({ path: `${SHOTS}/programme-four-3.png`, fullPage: true });

  await page.goBack();
  await expect(page.getByTestId('programme-balance')).toBeVisible();
});

/** A day this many whole months back, on the 15th. */
function monthsAgo(months: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 15)).toISOString().slice(0, 10);
}

test('a card first used years ago lists its statements by year, two years first, Show earlier years adding one at a time', async ({ page }) => {
  await openProgramme(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Old shop', paidWith: 'CIMB Octo', category: 'Groceries', amount: '500000', date: monthsAgo(40) });
  await page.goto('/wallet');
  await walletCard(page, 'CIMB Octo').click();
  await cardPage(page, 'Points');
  await page.getByTestId('statement-points-programme').click();
  await actions(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /CIMB Octo/ }).click();

  const thisYear = new Date().getUTCFullYear();
  await expect(page.getByTestId('programme-show-earlier')).toBeVisible();
  await expect(page.getByTestId('programme-show-earlier')).toContainText('the first purchase on this card');
  await expect(page.getByRole('heading', { name: String(thisYear - 1) })).toBeVisible();
  await expect(page.getByRole('heading', { name: String(thisYear - 2) })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/programme-catchup-3.png`, fullPage: true });

  for (let n = 2; n <= 4; n += 1) {
    if ((await page.getByTestId('programme-show-earlier').count()) === 0) break;
    await page.getByTestId('programme-show-earlier').click();
  }
  await expect(page.getByTestId('programme-show-earlier')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: String(thisYear - 3) })).toBeVisible();
});
