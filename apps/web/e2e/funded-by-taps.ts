import { expect, type Locator, type Page } from '@playwright/test';
import { addPriced } from './asset-page';
import { newGoal, openHolding } from './goal-funding';
import { mockRates, openWithPockets } from './pockets';
import { addMoneyAccount, goalCard, goalRow, setAside, setAsideBar } from './set-aside';

/**
 * Funded by's two taps (owner C1, 14 Nov), walked the same on a phone and a desktop: a set-aside line's body opens Set
 * aside with the caret in that account's figure, its own › at the right edge opens the account; a multicurrency
 * account's body opens and shuts its currencies, each currency two taps of its own; a tagged purchase opens its page
 * from the whole row as before. Names and figures invented.
 */
export async function fundedByTwoTaps(page: Page) {
  await mockRates(page, {});
  await openWithPockets(page, {
    name: 'Kas Valas',
    pockets: [
      { currency: 'USD', balance: '900.00', rate: '15900' },
      { currency: 'IDR', balance: '6000000' },
    ],
  });
  await addMoneyAccount(page, 'Tabungan Harian', 'savings', '8000000');
  await addPriced(page, 'Gold bullion', 'Emas Batangan', [['2026-03-09', '10', '18000000']]);

  // A goal with the gold tagged to it from the form, then three set-asides from its page.
  await newGoal(page, 'Hajj 2031');
  await page.getByRole('button', { name: /^Funding/ }).click();
  const funding = page.getByRole('dialog', { name: 'Funding' });
  await funding.getByRole('button', { name: 'Tag a purchase' }).click();
  const buys = await openHolding(page, 'Emas Batangan');
  await buys.getByRole('button', { name: 'Tag 1', exact: true }).click();
  await funding.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await expect(goalRow(page, 'Hajj 2031')).toBeVisible();
  await setAside(page, 'Hajj 2031', 'Tabungan Harian', '3000000');
  await setAside(page, 'Hajj 2031', 'Kas Valas · USD', '500.00');
  await setAside(page, 'Hajj 2031', 'Kas Valas · IDR', '4000000');

  let hajj = await goalCard(page, 'Hajj 2031');
  const sheet = page.getByRole('dialog', { name: 'Set aside' });

  // A plain account: the body opens Set aside with the caret in its figure and its bar of figures showing.
  const tabungan = hajj.getByTestId('goal-link').filter({ hasText: 'Tabungan Harian' });
  // Focused inside the tap itself, since iOS raises the keyboard only for a focus made then: the caret is in the figure
  // before the click has returned.
  const focusedInTap = await bodyOf(tabungan).evaluate((button) => {
    (button as HTMLElement).click();
    return document.activeElement?.getAttribute('aria-label') ?? null;
  });
  expect(focusedInTap).toBe('Tabungan Harian');
  await expect(sheet).toBeVisible();
  const field = sheet.getByLabel('Tabungan Harian', { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('3.000.000');
  await expect(setAsideBar(page)).toBeVisible();
  // In the goal's own group, not under Can add.
  await expect(sheet.locator('section').filter({ hasText: 'In Hajj 2031' }).getByLabel('Tabungan Harian', { exact: true })).toBeVisible();
  // Nothing typed: closing writes nothing, and the line still reads what it held.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(tabungan).toContainText(/Rp.3\.000\.000/);

  // Its › is a target of its own, named for the account, opening the account's page.
  const open = tabungan.getByRole('link', { name: 'Open Tabungan Harian', exact: true });
  await expect(open).toBeVisible();
  const box = await open.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await open.click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Tabungan Harian' }).first()).toBeVisible();
  await page.goBack();

  // The multicurrency account: the body still opens and shuts its currencies; its › opens the account itself.
  hajj = await goalCard(page, 'Hajj 2031');
  const valas = hajj.getByTestId('goal-link-account');
  await bodyOf(valas).click();
  await expect(valas).toHaveAttribute('data-open', 'true');
  const currencies = hajj.getByTestId('goal-link-currency');
  await expect(currencies).toHaveCount(2);
  await bodyOf(valas).click();
  await expect(currencies).toHaveCount(0);
  await expect(sheet).toHaveCount(0);
  await valas.getByRole('link', { name: 'Open Kas Valas', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/]+$/);
  await expect(page.getByTestId('pocket-USD')).toBeVisible();
  await page.goBack();

  // A currency under it: the body opens Set aside on that pocket, its › that pocket's page.
  hajj = await goalCard(page, 'Hajj 2031');
  await bodyOf(hajj.getByTestId('goal-link-account')).click();
  const usd = hajj.getByTestId('goal-link-currency').filter({ has: page.getByText('USD', { exact: true }) });
  await bodyOf(usd).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Kas Valas · USD', { exact: true })).toBeFocused();
  await expect(sheet.getByLabel('Kas Valas · USD', { exact: true })).toHaveValue('500,00');
  await expect(setAsideBar(page)).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await usd.getByRole('link', { name: 'Open Kas Valas · USD', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/]+$/);
  await page.goBack();

  // The round Set aside still opens with no line focused.
  hajj = await goalCard(page, 'Hajj 2031');
  await hajj.getByRole('button', { name: 'Set aside', exact: true }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('textbox').and(page.locator(':focus'))).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();

  // The gold wears the same › as the set-aside lines, so the rows line up; its body and its › both open the holding,
  // and neither opens Set aside.
  const gold = hajj.getByTestId('goal-link').filter({ hasText: 'Emas Batangan' });
  const goldOpen = gold.getByRole('link', { name: 'Open Emas Batangan', exact: true });
  await expect(goldOpen).toBeVisible();
  await expect(gold.getByRole('button')).toHaveCount(0);
  const [goldBox, tabunganBox] = [await goldOpen.boundingBox(), await hajj.getByTestId('goal-link').filter({ hasText: 'Tabungan Harian' }).getByRole('link', { name: 'Open Tabungan Harian', exact: true }).boundingBox()];
  expect(goldBox!.x).toBe(tabunganBox!.x);
  expect(goldBox!.width).toBe(tabunganBox!.width);
  await goldOpen.click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Emas Batangan' }).first()).toBeVisible();
  const holding = page.url();
  await page.goBack();
  hajj = await goalCard(page, 'Hajj 2031');
  await hajj.getByTestId('goal-link').filter({ hasText: 'Emas Batangan' }).getByRole('link').first().click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(holding);
}

/** A Funded-by row's body: the row's own button, not its ›. */
const bodyOf = (row: Locator) => row.getByRole('button').first();
