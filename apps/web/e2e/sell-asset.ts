import { expect, type Page } from '@playwright/test';
import { openAccount, openSettings } from './accounts';
import { addEstimated } from './asset-page';
import { openDrawers } from './drawers';

/** A bank account with money in it and a laptop bought for 22.000.000 and now estimated at 14.000.000. */
export async function bankAndLaptop(page: Page) {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '9000000' });
  await addEstimated(page, 'Electronics', 'Laptop', '2024-01-05', '22000000', '14000000');
}

/** The laptop's Settings, from the Assets list. */
export async function laptopSettings(page: Page) {
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: /^Laptop/ }).first().click();
  await expect(page.getByText('Value now')).toBeVisible();
  await openSettings(page);
}

/** The three ways out of an estimated asset: one box, Sell first, Sell and Archive in ink, only Delete in alarm. */
export async function expectWaysOut(page: Page) {
  const main = page.getByRole('main');
  const sell = main.getByRole('button', { name: 'Sell', exact: true });
  const archive = main.getByRole('button', { name: 'Archive', exact: true });
  const del = main.getByRole('button', { name: 'Delete', exact: true });
  await expect(main.getByRole('button', { name: /^(Sell|Archive|Delete)$/ })).toHaveText(['Sell', 'Archive', 'Delete']);
  expect(await sell.evaluate((el, other) => el.parentElement?.parentElement === (other as Element).parentElement?.parentElement, await del.elementHandle())).toBe(true);
  expect(await archive.evaluate((el, other) => el.parentElement?.parentElement === (other as Element).parentElement?.parentElement, await del.elementHandle())).toBe(true);
  const colour = (b: typeof sell) => b.evaluate((el) => getComputedStyle(el).color);
  // Archive is grey while the asset holds anything; Sell is in the ordinary ink, only Delete in alarm.
  expect(await colour(sell)).toBe(await tokenColour(page, '--ph-ink'));
  expect(await colour(del)).toBe(await tokenColour(page, '--ph-alarm'));
  expect(await colour(sell)).not.toBe(await colour(del));
}

/** Sells the laptop for 20.000.000 with 500.000 of costs into the bank account, and checks the sheet's sums. */
export async function sellLaptop(page: Page) {
  await page.getByRole('main').getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Sell' })).toBeVisible();
  await expect(sheet).toContainText('Laptop');
  const record = sheet.getByRole('button', { name: 'Record sale', exact: true });
  await expect(record).toBeDisabled();
  await sheet.getByLabel('Sold for', { exact: true }).fill('20000000');
  await expect(record).toBeDisabled();
  await sheet.getByLabel('Paid into', { exact: true }).selectOption({ index: 1 });
  await expect(record).toBeEnabled();
  await expect(sheet.getByTestId('sell-total')).toContainText('Rp 20.000.000');
  // Costs fold open in place and come off what is received.
  await expect(sheet.getByTestId('trade-fee')).toContainText('None');
  await sheet.getByTestId('trade-fee').getByRole('button', { name: /tap to change/ }).click();
  await sheet.getByLabel('Costs', { exact: true }).fill('500000');
  await expect(sheet.getByTestId('sell-costs')).toContainText('Rp 500.000');
  await expect(sheet.getByTestId('sell-total')).toContainText('Rp 19.500.000');
  // Against the original cost of 22.000.000, not the estimate of 14.000.000.
  await expect(sheet.getByTestId('sell-gain')).toContainText('−Rp 2.500.000');
  await expect(sheet.getByTestId('sell-gain').locator('span').last()).toHaveCSS('color', await tokenColour(page, '--ph-alarm'));
  await record.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function tokenColour(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    // Read where the page reads it: a Mac page (`.mk`) maps the --ph-* tokens onto its own colours.
    (document.querySelector('main .mk') ?? document.body).appendChild(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, token);
}

export async function expectSoldPage(page: Page) {
  await expect(page.getByTestId('sold-word')).toHaveText('Sold');
  await expect(page.getByTestId('sold-line')).toContainText('Rp 20.000.000');
  await expect(page.getByTestId('sold-line')).toContainText('into BCA Tahapan');
  const main = page.getByRole('main');
  await expect(main).toContainText('Gain−Rp 2.500.000');
  await expect(main).toContainText('Original costRp 22.000.000');
  await expect(main).toContainText('Held for');
  // No value, no buttons: only the way back.
  await expect(page.getByText('Value now')).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Undo sale' })).toBeVisible();
  await expect(main.getByRole('button', { name: /^(Buy|Sell|Price)$/ })).toHaveCount(0);
}
