import { expect, type Locator, test } from '@playwright/test';
import { fillFigure } from './add-transaction';
import { goldAtPrice } from './gold-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('phone: the brand’s bar sizes ride over the keyboard while Grams is typed, and one tap fills it', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const strip = page.getByRole('listbox', { name: 'Bar sizes' });
  await expect(strip).toHaveCount(0);
  const grams = sheet.getByLabel('Grams', { exact: true });
  await grams.focus();
  await expect(strip).toBeVisible();
  // UBS's own sizes: a 4 g bar, and nothing past 100 g.
  await expect(strip.getByRole('option', { name: '4 g', exact: true })).toHaveCount(1);
  await expect(strip.getByRole('option', { name: '1.000 g', exact: true })).toHaveCount(0);
  await strip.getByRole('option', { name: '5 g', exact: true }).click();
  await expect(grams).toHaveValue('5');
  await expect(grams).toBeFocused();
  // The total is Expense's amount row: on a phone, the keypad's dock, and the bar sizes go as Grams is left.
  await fillFigure(sheet, 'Total paid', '9850000');
  await expect(strip).toHaveCount(0);
  await expect(sheet.getByLabel('Total paid', { exact: true })).toHaveText('9.850.000');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('17 g');
});

test('phone: All sells every gram, down to 0 g, and more than is held is refused', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Grams', { exact: true }).fill('12,5');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'All', exact: true }).click();
  await fillFigure(sheet, 'Received', '22000000');
  await expect(page.getByTestId('gold-gain')).toContainText('−Rp 500.000');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('0 g');
});

test('phone: every row of the sheet reads at one size, and the details open under the first box in the same sheet', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const size = (node: Locator) => node.evaluate((element) => getComputedStyle(element).fontSize);
  // Trade's rows, read as Expense's: Paid with's account, the total, the holding's name and Grams, all one size on a phone.
  const grams = sheet.getByLabel('Grams', { exact: true });
  expect(await size(grams)).toBe('17px');
  expect(await size(sheet.getByLabel('Total paid', { exact: true }))).toBe('17px');
  expect(await size(sheet.getByRole('button', { name: /^Payment method/ }).getByText('BCA', { exact: true }))).toBe('17px');
  expect(await size(sheet.getByTestId('trade-holding').getByText('UBS gold bars', { exact: true }))).toBe('17px');

  // Where the first box sits in the sheet, measured from the holding's line above Grams.
  // Both read in one go: the sheet stands up to large as the details open, and two reads apart would each catch it at
  // a different height.
  const offset = () =>
    grams.evaluate((field) => {
      const line = field.closest('[role=dialog]')!.querySelector('[data-testid=trade-holding]')!;
      return Math.round(field.getBoundingClientRect().top - line.getBoundingClientRect().top);
    });
  const before = await offset();
  await sheet.getByRole('button', { name: 'Add more details' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const fee = sheet.getByLabel('Fee', { exact: true });
  await expect(fee).toBeVisible();
  expect(await size(fee)).toBe('17px');
  // The first box never moves within the sheet; the second is under it.
  expect(await offset()).toBe(before);
  expect((await fee.boundingBox())!.y).toBeGreaterThan((await sheet.getByLabel('Date').boundingBox())!.y);
  await expect(sheet.getByRole('button', { name: 'Fewer details' })).toHaveAttribute('aria-expanded', 'true');
});
