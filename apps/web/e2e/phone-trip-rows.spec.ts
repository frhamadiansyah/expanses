import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { corner, newEvent, openTrip, recordSharedSpend, showBalances, showCard, spendingRow } from './shared-events';

/*
 * A shared trip's history rows look like a private trip's (owner 2026-11-14): the same circle, the same title,
 * subtitle and amount sizes, the same day card. The shared spending row reads category on top, the note and who paid
 * under it, and the share under the amount. Invented names and figures. With E2E_MOCKUP_SHOTS set, the two day cards
 * are written to docs/mockups.
 */

test.describe.configure({ timeout: 240_000 });

const SHOTS = process.env.E2E_MOCKUP_SHOTS;

/** What sets a row's look: the circle's size, and each line's font size and weight. */
async function look(row: Locator) {
  return row.evaluate((li) => {
    const font = (el: Element | null) => (el ? { size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight } : null);
    const mark = li.querySelector('[data-testid="category-mark"]')!.getBoundingClientRect();
    const lines = li.querySelectorAll('span.block.truncate');
    return {
      mark: [Math.round(mark.width), Math.round(mark.height)],
      title: font(lines[0] ?? null),
      subtitle: font(lines[1] ?? null),
      amount: font(li.querySelector('span.tabular.block')),
      under: font(li.querySelector('[data-testid="amount-extra"]')),
      height: Math.round(li.getBoundingClientRect().height),
    };
  });
}

async function addTripSpend(page: Page, o: { note: string; amount: string; paidWith: string }) {
  await page.getByRole('button', { name: 'Add a transaction' }).first().click();
  const form = addForm(page);
  await expect(form.getByTestId('event-chip')).toBeVisible();
  await openAmount(form);
  await fillAmount(page, form, o.amount);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, o.paidWith);
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill(o.note);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

test('a shared trip draws its records as a private trip draws its transactions', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'Rina Bank', balance: '90000000' });

  // A private trip, with one purchase in it through event mode.
  await newEvent(page, 'Ridge walk');
  await page.getByTestId('event-mode-group').getByTestId('event-mode-switch').check();
  await page.goto('/transactions');
  await addTripSpend(page, { note: 'Hill market', amount: '235000', paidWith: 'Rina Bank' });
  await page.goto('/events');
  await page.getByTestId('event-row').filter({ hasText: 'Ridge walk' }).click();
  const privateRow = page.getByTestId('event-history').filter({ hasText: 'Hill market' });
  await expect(privateRow).toBeVisible();
  const privateLook = await look(privateRow);
  // The day card: the panel round the row's list.
  if (SHOTS) await privateRow.locator('xpath=ancestor::ul[1]/..').screenshot({ path: `${SHOTS}/2026-11-14-trip-rows-private.png` });
  await page.getByTestId('event-mode-group').getByTestId('event-mode-switch').uncheck();

  // A shared trip with Budi, who has no app: a spending, and Budi settling up with Rina.
  await newEvent(page, 'Coast week');
  await corner(page, 'Share this event');
  const share = page.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 60_000 });
  await openTrip(page);
  await corner(page, 'Add spending');
  await recordSharedSpend(page, { note: 'Fish dinner', amount: '480000', paidWith: 'Rina Bank' });
  await showBalances(page);
  await page.getByTestId('shared-payment-row').first().click();
  const settle = page.getByTestId('settle-up');
  await settle.getByLabel('Received into').selectOption({ label: 'Rina Bank · IDR' });
  await settle.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(settle).toHaveCount(0, { timeout: 30_000 });
  await showCard(page, 'Spending');

  const expense = spendingRow(page, 'Fish dinner');
  // Category on top, the note and who paid under it, the share under the amount.
  await expect(expense.locator('span.block.truncate').first()).toHaveText('Other');
  await expect(expense.locator('span.block.truncate').nth(1)).toHaveText(/^Fish dinner · Rina paid · /);
  await expect(expense.getByTestId('amount-extra')).toHaveText(/^share Rp\s240\.000$/);
  const settlement = page.getByTestId('shared-settlement-row');
  await expect(settlement).toContainText('Budi paid Rina');

  // The same look as the private row: circle, and every line's size and weight. The line under the amount is a
  // private row's foreign-figure line (12 px), here holding the share.
  const { under, height: _h, ...same } = await look(expense);
  const { under: _u, height: _p, ...privateSame } = privateLook;
  expect(same).toEqual(privateSame);
  expect(under).toEqual({ size: '12px', weight: '400' });
  const { under: _s, height: _sh, ...settlementSame } = await look(settlement);
  expect(settlementSame).toEqual(privateSame);
  // The same day card: its rows sit in a panel the same width as the private one's.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A tap still opens the spending to edit.
  if (SHOTS) await page.getByTestId('shared-event-day').first().screenshot({ path: `${SHOTS}/2026-11-14-trip-rows-shared.png` });
  await expense.click();
  await expect(page).toHaveURL(/\/transactions\/new\?.*expense=/);
});
