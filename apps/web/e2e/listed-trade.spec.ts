import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAsset } from './asset-page';
import { openSettings } from './accounts';
import { bbcaAt, expectBrokerBalance, openBroker, openBrokerSettings } from './listed-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

/** The Price or Lots row's field: tapping the row selects it (its figure turns typeable, and the − / + bar rises). */
const field = (sheet: Locator, name: 'Price' | 'Lots') => sheet.getByLabel(name, { exact: true });

/** The bar's Done: lets the selected field go, which takes the bar away. */
async function done(page: Page) {
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('toolbar')).toHaveCount(0);
}

test('Buy BBCA: a price stepped on IDX’s tick, two lots, the broker’s fee, and the RDN pays exactly the total', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '8000000');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  // Only "Buy" in the title, the stock in the first row, and no header block, ✓ or button at the foot.
  await expect(sheet.getByRole('heading', { name: 'Buy', exact: true })).toBeVisible();
  await expect(sheet.getByText('BBCA · Bank Central Asia')).toBeVisible();
  await expect(sheet).not.toContainText('Last close');
  await expect(sheet.getByRole('button', { name: 'Record buy' })).toHaveCount(1);
  await expect(sheet.getByRole('button', { name: 'Add more details' })).toHaveCount(0);
  // The last close and the day are behind the Price row's ⓘ; the lot's size behind Lots'.
  await sheet.getByRole('button', { name: 'About Price' }).click();
  await expect(sheet).toContainText(/Last close 6\.150 · \d{1,2} \w{3} \d{4}/);
  await sheet.getByRole('button', { name: 'About Lots' }).click();
  await expect(sheet).toContainText('1 lot is 100 shares');
  await expect(field(sheet, 'Price')).toHaveValue('6.150');
  await expect(sheet.getByText('1 lot · 100 shares')).toBeVisible();
  // No − / + until a row is selected.
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await field(sheet, 'Price').click();
  await expect(page.getByRole('toolbar')).toBeVisible();
  await page.getByRole('button', { name: 'More price' }).click();
  await expect(field(sheet, 'Price')).toHaveValue('6.175');
  await field(sheet, 'Lots').click();
  await page.getByRole('button', { name: 'More lots' }).click();
  await expect(field(sheet, 'Lots')).toHaveValue('2');
  await done(page);
  await expect(sheet.getByText('2 lots · 200 shares')).toBeVisible();
  // 200 shares at 6.175 is 1.235.000; 0,15% of it is 1.852,5, a whole 1.853.
  await expect(sheet.getByText('Value', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Fee, tap to change' })).toBeVisible();
  await expect(sheet).toContainText('0,15% · Rp 1.853');
  const total = page.getByTestId('trade-total');
  await expect(total).toContainText('Total');
  await expect(total).toContainText('Rp 1.236.853');
  // A price between IDX's steps is refused until it is on one.
  await field(sheet, 'Price').fill('6.160');
  await expect(sheet).toContainText('IDX prices move in steps of 25 at this price');
  await done(page);
  await expect(page.getByRole('button', { name: 'Record buy' })).toBeDisabled();
  await field(sheet, 'Price').fill('6.175');
  await done(page);
  // The broker pays: no Paid from row.
  await expect(sheet.getByText('Paid from')).toHaveCount(0);
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('12 lots');
  await expectBrokerBalance(page, 'Stockbit Sekuritas', '6.763.147');
});

test('Sell BBCA: what reaches the RDN after the fee, the gain on the lots sold, and no more lots than are held', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '0');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Sell', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'About Lots' }).click();
  await expect(sheet).toContainText('Held: 10 lots');
  await field(sheet, 'Lots').fill('5');
  await done(page);
  // 500 at 6.150 is 3.075.000; 0,25% is 7.687,5, a whole 7.688 with the 0,1% tax in it; 500 cost 4.375.000.
  await expect(sheet.getByRole('button', { name: 'Fee and tax, tap to change' })).toBeVisible();
  await expect(sheet).toContainText('0,25% · Rp 7.688');
  const total = page.getByTestId('trade-total');
  await expect(total).toContainText('Rp 3.067.312');
  const gain = page.getByTestId('trade-gain');
  await expect(gain).toContainText('Gain');
  await expect(gain).toContainText('−Rp 1.304.613');
  await gain.getByRole('button', { name: 'About Gain' }).click();
  await expect(gain).toContainText('Bought at avg 8.750');

  await field(sheet, 'Lots').fill('11');
  await expect(sheet).toContainText('Held: 10 lots; cannot sell more than that');
  await done(page);
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();
  await field(sheet, 'Lots').fill('10');
  await expect(page.getByRole('button', { name: 'More lots' })).toBeDisabled();
  await done(page);
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expectBrokerBalance(page, 'Stockbit Sekuritas', '6.134.625');
});

test('Mandiri Sekuritas’ Rp 5.000 minimum a day is charged on a small buy, and said behind the fee row’s ⓘ', async ({ page }) => {
  await openBroker(page, 'Mandiri Sekuritas', '8000000');
  await bbcaAt(page, 'Mandiri Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  // 0,18% of 615.000 is 1.107, under the day's minimum.
  await expect(page.getByTestId('trade-total')).toContainText('Rp 620.000');
  await expect(sheet).toContainText('0,18% · Rp 5.000');
  await sheet.getByRole('button', { name: 'About Fee' }).click();
  await expect(sheet).toContainText('Minimum fee Rp 5.000 a day applies');
});

test('a broker’s fees are set on its cash account, and the Buy sheet works from them', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '8000000');
  await openBrokerSettings(page, 'Stockbit Sekuritas');
  await expect(page.getByLabel('Buy fee %', { exact: true })).toHaveValue('0,15');
  await expect(page.getByLabel('Sell fee %', { exact: true })).toHaveValue('0,25');
  await page.getByLabel('Buy fee %', { exact: true }).fill('0,19');
  await page.getByLabel('Minimum fee per day', { exact: true }).click();
  // Saved as the row is left: the page read again (back, and in again) shows it once the save has landed.
  await expect(async () => {
    await page.getByRole('button', { name: 'Stockbit Sekuritas', exact: true }).click();
    await openSettings(page);
    await expect(page.getByLabel('Buy fee %', { exact: true })).toHaveValue('0,19', { timeout: 1_000 });
  }).toPass();

  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  // 0,19% of 615.000 is 1.168,5, a whole 1.169.
  await expect(page.getByRole('dialog')).toContainText('0,19% · Rp 1.169');
  await openAsset(page, 'BBCA');
});

test('the fee row folds open in place: Automatic until a fee is typed, which takes the worked-out fee’s place in the total and on the trade', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '8000000');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'More options' })).toHaveCount(0);
  await expect(sheet.getByLabel('Fee', { exact: true })).toHaveCount(0);
  const row = sheet.getByRole('button', { name: 'Fee, tap to change' });
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  // Empty, the app works the fee out from the broker's rates, and the row says so in a word.
  const fee = sheet.getByLabel('Fee', { exact: true });
  await expect(fee).toHaveAttribute('placeholder', 'Automatic');
  await fee.pressSequentially('2500');
  const total = page.getByTestId('trade-total');
  await expect(total).toContainText('Rp 617.500');
  // A typed fee has no rate to show: just the amount.
  await expect(sheet).not.toContainText('0,15% ·');
  // Clearing returns to Automatic: 0,15% of 615.000 is 922,5, a whole 923.
  await fee.fill('');
  await expect(total).toContainText('Rp 615.923');
  await expect(sheet).toContainText('0,15% · Rp 923');
  await fee.pressSequentially('2500');
  await row.click();
  await expect(sheet.getByLabel('Fee', { exact: true })).toHaveCount(0);
  await expect(total).toContainText('Rp 617.500');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expectBrokerBalance(page, 'Stockbit Sekuritas', '7.382.500');
});

test('a sell’s fee row opens into a fee and the tax withheld, both Automatic', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '0');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Fee and tax, tap to change' }).click();
  await expect(sheet.getByLabel('Fee', { exact: true })).toHaveAttribute('placeholder', 'Automatic');
  await expect(sheet.getByLabel('Tax withheld', { exact: true })).toHaveAttribute('placeholder', 'Automatic');
});

test('a past purchase starts with no fee, and the trade moves no account', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '8000000');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('checkbox', { name: 'Past purchase' }).check();
  await expect(sheet).toContainText('None');
  await expect(sheet).not.toContainText('0,15% ·');
  await expect(page.getByTestId('trade-total')).toContainText('Rp 615.000');
  await expect(sheet.getByText('Paid from')).toHaveCount(0);
  // A fee typed all the same still counts.
  await sheet.getByRole('button', { name: 'Fee, tap to change' }).click();
  await expect(sheet.getByLabel('Fee', { exact: true })).toHaveAttribute('placeholder', 'None');
  await sheet.getByLabel('Fee', { exact: true }).pressSequentially('1000');
  await expect(page.getByTestId('trade-total')).toContainText('Rp 616.000');
  await sheet.getByLabel('Fee', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expectBrokerBalance(page, 'Stockbit Sekuritas', '8.000.000');
});

test('Value, the fee row and Total share one right edge', async ({ page }) => {
  await openBroker(page, 'Stockbit Sekuritas', '8000000');
  await bbcaAt(page, 'Stockbit Sekuritas');
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await expect(page.getByTestId('trade-total')).toContainText('Rp 6');
  const right = async (testId: string) => {
    const box = await page.getByTestId(testId).locator('span.tabular').last().boundingBox();
    return Math.round((box?.x ?? 0) + (box?.width ?? 0));
  };
  const edge = await right('trade-total');
  expect(edge).toBeGreaterThan(0);
  expect(await right('trade-value')).toBe(edge);
  expect(await right('trade-fee')).toBe(edge);
});
