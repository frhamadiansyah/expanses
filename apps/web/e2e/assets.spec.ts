import { expect, type Page, test } from '@playwright/test';
import { openAccount, openSettings as openSettingsMenu } from './accounts';
import { openNewAsset, fillDay } from './add-asset';
import { addTransfer } from './add-transaction';
import { addPriced, openAsset } from './asset-page';
import { openDrawers } from './drawers';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** The gold's own page and its round Buy or Sell: the gold sheet up. */
async function openGoldSheet(page: Page, kind: 'Buy' | 'Sell') {
  await openAsset(page, 'Antam gold bars');
  await page.getByRole('group', { name: 'Actions' }).getByRole('button', { name: kind, exact: true }).click();
  await expect(page.getByRole('button', { name: `Record ${kind.toLowerCase()}`, exact: true })).toBeVisible();
}

async function addBank(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
}

async function addGold(page: Page) {
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await fillDay(page, 'Bought', '2024-02-03');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('13100000');
  await page.getByRole('button', { name: 'Add another purchase' }).click();
  await fillDay(page, 'Bought', '2026-03-09', 1);
  await page.getByLabel('How much').nth(1).fill('5');
  await page.getByLabel('Total cost', { exact: true }).nth(1).fill('9300000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  // The list folds its rows by kind — gold under "Gold bullion" — so the drawer comes first, as it does for a reader.
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
}

test('records past purchases without touching the bank balance', async ({ page }) => {
  await addBank(page);
  await addGold(page);

  // Cost of both purchases, no price yet.
  await expect(page.getByText(/22\.400\.000/).first()).toBeVisible();
  await expect(page.getByText(/50\.000\.000/).first()).toBeVisible();
});

test('buys, sells, and works out the gain at average cost', async ({ page }) => {
  await addBank(page);
  await addGold(page);

  await openGoldSheet(page, 'Buy');
  await page.getByLabel('Grams', { exact: true }).fill('2');
  await page.getByLabel('Total paid', { exact: true }).pressSequentially('3980000');
  await page.getByRole('button', { name: 'Record buy', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 17 g cost Rp 26.380.000, so average cost is Rp 1.551.764 a gram.
  await expect(page.getByText(/26\.380\.000/).first()).toBeVisible();

  await openGoldSheet(page, 'Sell');
  await page.getByLabel('Grams', { exact: true }).fill('5');
  await page.getByLabel('Received', { exact: true }).pressSequentially('9000000');
  await expect(page.getByTestId('gold-gain')).toBeVisible();
  await page.getByRole('button', { name: 'Record sell', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 12 g left of the 17 g held.
  await expect(page.getByText('12 g').first()).toBeVisible();

  // The year's figures are read on Income, behind the Assets corner: 5 g sold for Rp 9.000.000 at an average cost of
  // Rp 26.380.000 over 17 g realizes about Rp 1.241.176, and nothing has paid income.
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: 'Income', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  const year = page.getByTestId('trades-year');
  await expect(year).toContainText('Realized this year');
  await expect(year).toContainText(/\+Rp\s?1\.241\.17\d/);
  await expect(year).toContainText('Income this year');
});

test('updates a price from the assets list and shows the new value', async ({ page }) => {
  await addBank(page);
  await addGold(page);

  // The corner beside + opens Income; Update prices is reached from a holding's Settings. Gold is there too.
  await expect(page.getByRole('link', { name: 'Income', exact: true })).toBeVisible();
  await page.goto('/net-worth/prices');
  await expect(page.getByRole('heading', { name: 'Update prices' })).toBeVisible();
  await page.getByLabel(/Antam gold bars/).fill('1842000');
  await page.getByRole('button', { name: 'Save prices' }).click();
  await expect(page.getByText(/Last Rp\s?1\.842\.000 · .* · Typed/)).toBeVisible();

  // 15 g at Rp 1.842.000 a gram.
  await page.goto('/net-worth/assets');
  await expect(page.getByText(/27\.630\.000/).first()).toBeVisible();
});

async function openSettings(page: Page, name: string) {
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).first().click();
  await openSettingsMenu(page);
}

test('renames an account from its settings page, and every list reads the new name', async ({ page }) => {
  await addBank(page);
  await openSettings(page, 'BCA Tahapan');

  // Kept when the row is left, as every settings row is: the way back then carries the new name.
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan Utama');
  await page.getByLabel('Name', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'BCA Tahapan Utama', exact: true })).toBeVisible();

  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /BCA Tahapan Utama/ })).toBeVisible();
});

test('an account opened by mistake deletes once asked; one with entries refuses and says why', async ({ page }) => {
  await addBank(page);
  await openAccount(page, { subtype: 'savings', name: 'Jenius', balance: '0' });
  // A third account, opened and never touched again: this one can go.
  await openAccount(page, { subtype: 'savings', name: 'Hana', balance: '1000000' });
  // One transfer in, and Jenius is no longer an account that was only opened.
  await page.goto('/transactions');
  await addTransfer(page, { from: 'BCA Tahapan', to: 'Jenius (IDR)', amount: '5000000' });

  await openSettings(page, 'Jenius');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('has entries of its own');

  // The one that was only opened goes, opening entry and all.
  await openSettings(page, 'Hana');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  // Money goes back to the list it lives on.
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByRole('link', { name: /Hana/ })).toHaveCount(0);
});

test('sends trade edits to the holding’s page instead of the transaction form', async ({ page }) => {
  await addBank(page);
  await addGold(page);

  // A buy dated today, so it lands in the month the Transactions page opens on.
  await openGoldSheet(page, 'Buy');
  await page.getByLabel('Grams', { exact: true }).fill('2');
  await page.getByLabel('Total paid', { exact: true }).pressSequentially('3980000');
  await page.getByRole('button', { name: 'Record buy', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/transactions');
  await expect(page.getByText('Bought 2 Antam gold bars')).toBeVisible();
  const row = page.locator('li', { hasText: 'Bought 2 Antam gold bars' }).last();
  await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  // The row's link opens the gold's own page, where its ⋮ edits it.
  await row.getByRole('link', { name: 'Holding', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/?]+$/);
  await expect(page.getByRole('heading', { name: 'Antam gold bars' })).toBeVisible();
});

test('a section picked on the chart divides where it stands: the other boxes stay, and its kinds are boxes inside it', async ({ page }) => {
  await addPriced(page, 'Government bonds', 'ORI026', [['2026-01-15', '10000000', '10000000']]);
  await addPriced(page, 'Corporate bonds', 'Obligasi Berkelanjutan', [['2026-02-10', '5000000', '5000000']]);
  await addPriced(page, 'Gold bullion', 'Antam gold bars', [['2025-09-19', '10', '20000000']]);

  await page.goto('/net-worth/assets');
  const boxes = page.getByTestId('share-boxes');
  const investments = boxes.getByRole('button', { name: /^Investments, / });
  await expect(investments).toBeVisible();
  await expect(page.getByTestId('assets-total')).toContainText('35.000.000');
  const total = await page.getByTestId('assets-total').textContent();
  // Where a box sits inside the chart, so a scroll of the page does not read as the box moving.
  const within = async (locator: typeof boxes) => {
    const [box, chart] = [(await locator.boundingBox())!, (await boxes.boundingBox())!];
    return { x: box.x - chart.x, y: box.y - chart.y, width: box.width };
  };
  await investments.scrollIntoViewIfNeeded();
  const before = await within(investments);
  await investments.click();

  // The same chart: the box the gold is in is still drawn, stepped back, and the total above is still the whole.
  await expect(boxes.getByRole('button', { name: /^Intangible and other, / })).toBeVisible();
  await expect(boxes.getByRole('button', { name: /^Intangible and other, / }).locator('span').first()).toHaveClass(/opacity-35/);
  await expect(page.getByTestId('assets-total')).toHaveText(total!);
  // Investments keeps its place and is divided into its kinds, each still a share of the whole: 10 of 35 is 29%.
  const open = boxes.getByRole('group', { name: /^Investments, .*by kind$/ });
  const after = await within(open);
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y) + Math.abs(after.width - before.width)).toBeLessThan(2);
  await expect(open.getByRole('button')).toHaveCount(2);
  await expect(open.getByRole('button', { name: /^Government bonds, Rp\s10\.000\.000, 29%$/ })).toBeVisible();

  // A kind tapped narrows the list to it; tapped again, the whole section is back.
  await open.getByRole('button', { name: /^Corporate bonds, / }).click();
  await expect(open.getByRole('button', { name: /^Corporate bonds, / })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: /^ORI026/ })).toHaveCount(0);
  await open.getByRole('button', { name: /^Corporate bonds, / }).click();
  await expect(page.getByRole('link', { name: /^ORI026/ })).toBeVisible();

  // Show all puts the chart back as it was.
  await page.getByTestId('show-all').click();
  await expect(boxes.getByRole('button', { name: /^Investments, / })).toHaveAttribute('aria-pressed', 'false');
});
