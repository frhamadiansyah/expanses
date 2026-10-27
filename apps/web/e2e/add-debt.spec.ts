import { expect, test } from '@playwright/test';
import { cardPage, saveCardTerms } from './card-section';
import { nameCardByHand, openCard, pickCatalogueCard } from './accounts';
import { openDrawers } from './drawers';

/**
 * The debt picker, end to end: the three things a debt turns out to be, and where each one lands.
 *
 * The forms are unit-tested by `debt-form.test.ts`; what is proved here is the wiring — that a mortgage really
 * opens a loan account with a schedule, that family money goes to the ledger, and that a card named from the
 * catalogue arrives with its bank, its earn rules and the fee the bank publishes.
 */

test('a mortgage opens a loan account at what is still owed, with the terms that give it a schedule', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Home mortgage' }).click();

  await page.getByLabel('Name', { exact: true }).fill('KPR BTN Bintaro');
  await page.getByLabel('Owed now').fill('650000000');
  await page.getByLabel('Lender').fill('Bank BTN');
  await page.getByLabel('Interest rate').fill('9');
  await page.getByLabel('Months left').fill('168');
  await page.getByRole('button', { name: 'Add debt' }).click();

  await expect(page).toHaveURL(/\/net-worth\/loans$/);
  // The row, and the terms line under it, sit inside the kind's own drawer, which the list opens shut.
  await openDrawers(page);
  // The terms the picker worked out: the lender, the rate as basis points read back, and the months left.
  await expect(page.getByText(/Bank BTN · 9% · 168 months/)).toBeVisible();

  await page.getByRole('link', { name: 'KPR BTN Bintaro' }).click();
  await expect(page.getByText('Still owed')).toBeVisible();
  await expect(page.getByText(/650\.000\.000/).first()).toBeVisible();
});

test('money borrowed from family lands under Lend & borrow', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: /^Affiliate debt/ }).click();

  await page.getByLabel('Owed now').fill('10000000');
  await page.getByLabel('Who').fill('Ibu');
  await page.getByRole('button', { name: 'Add debt' }).click();

  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
  await expect(page.getByText('Payables', { exact: true })).toBeVisible();
  await expect(page.getByText('Ibu').first()).toBeVisible();
});

test('a card named from the catalogue arrives with its bank, its rules and the published fee', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Credit card' }).click();

  // Picking the product is the whole of the setup: it fills the bank and the name, and links the card to the entry.
  await pickCatalogueCard(page, 'bca', 'BCA UnionPay');
  await expect(page.getByLabel('Bank', { exact: true })).toHaveValue('BCA');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('UnionPay');
  // The dates are details, and given here the terms are made at once — with the published fee written onto them.
  await page.getByRole('button', { name: 'Add more details' }).click();
  // A catalogue card already knows its currency, so the details ask only the dates.
  await expect(page.getByLabel('Currency', { exact: true })).toHaveCount(0);
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Add card' }).click();

  await expect(page).toHaveURL(/\/cards\//);
  // Saved as its bank and its own name: the issuer is BCA, the name UnionPay.
  await expect(page.getByRole('heading', { name: 'UnionPay' })).toBeVisible();

  // The catalogue's own terms: the bank's published annual fee, and the earn rules that came with it.
  await cardPage(page, 'Settings');
  await expect(page.getByLabel('Annual fee')).toHaveValue('125000');
});

test('a catalogue card opens without its dates, and the fee is saved once they are given on its page', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Credit card' }).click();
  await pickCatalogueCard(page, 'unionpay', 'BCA UnionPay');
  await page.getByRole('button', { name: 'Add card' }).click();
  // Saved as its bank and its own name: the issuer is BCA, the name UnionPay.
  await expect(page.getByRole('heading', { name: 'UnionPay' })).toBeVisible();

  // Its rules are in already, so the dates are not step 1 of anything: one row offers to add them.
  const dates = page.getByTestId('card-setup');
  await expect(dates).toContainText('Billing and due dates');
  await expect(dates).toContainText('Add');
  await dates.click();
  await expect(page.getByText('Step 1 of 3')).toHaveCount(0);
  await expect(page.getByText('Is this card in the catalogue?')).toHaveCount(0);
  // The published fee waits beside the empty days, and is saved with them.
  await expect(page.getByLabel('Annual fee')).toHaveValue('125000');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await saveCardTerms(page);
  // Saved once the step's own words stand down: the dates were all this card's setup still asked for.
  await expect(page.getByText('Start with the billing date.', { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Billing date')).toHaveValue('25');
  await expect(page.getByLabel('Annual fee')).toHaveValue('125000');
});

test('one date without the other is refused, and nothing is opened meanwhile', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Credit card' }).click();
  await nameCardByHand(page, 'Kartu Setengah');
  await page.getByRole('button', { name: 'Add more details' }).click();
  await page.getByLabel('Billing date').fill('25');
  await page.getByRole('button', { name: 'Add card' }).click();

  await expect(page.getByText('Give both the billing date and the due date, or leave both for later')).toBeVisible();
  await expect(page).toHaveURL(/\/debts\/new$/);
  await page.goto('/wallet');
  await expect(page.getByText('Kartu Setengah')).toHaveCount(0);
});

test('a card that earns by level is refused until the level is chosen, and nothing is opened meanwhile', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Credit card' }).click();

  await pickCatalogueCard(page, 'jenius', 'Jenius Platinum');
  await expect(page.getByLabel(/ level$/)).toBeVisible();
  await page.getByRole('button', { name: 'Add card' }).click();

  await expect(page.getByText(/Choose the level before adding it/)).toBeVisible();
  await expect(page).toHaveURL(/\/debts\/new$/);
  // Nothing was opened, so the same button finishes the job once the level is given.
  await page.goto('/wallet');
  await expect(page.getByText('Jenius Platinum')).toHaveCount(0);
});

test('a card filed under no bank is given one on its Settings, and its face follows', async ({ page }) => {
  // Typed with its bank half left empty: the form asks nothing more about the bank.
  await openCard(page, { name: 'Kartu Kita', last4: '5521' });
  await cardPage(page, 'Settings');
  const institution = page.getByLabel('Institution', { exact: true });
  await expect(institution).toHaveValue('');
  await institution.fill('Bank Mega');
  // Kept as it is left, as a holding's Institution row is.
  await institution.blur();
  await expect(page.getByTestId('card-face').first()).toContainText('Bank Mega');

  // Kept: after a reload the row shows it, to be changed, and the face still reads it.
  await page.reload();
  await expect(page.getByLabel('Institution', { exact: true })).toHaveValue('Bank Mega');
  await expect(page.getByTestId('card-face').first()).toContainText('Bank Mega');
});
