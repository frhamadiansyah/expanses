import { expect, test } from '@playwright/test';
import { currencyRow, setCurrency } from './currency-field';
import { openAccount } from './accounts';
import { mockRates } from './pockets';
import { addSharedCost, corner, newEvent, openTrip, recordSharedSpend, showCard } from './shared-events';

/*
 * A shared trip's cost is the private plan's cost: a page of its own (identity block, figure strip, Details, Paid,
 * the two ways to pay, a Settled switch), a form that makes and edits it with the trip's own categories, costs grouped
 * by category on the plan, and Delete at the foot of the form. One phone, a trip in lira; invented names and figures.
 */

test.describe.configure({ timeout: 240_000 });

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

test('a shared cost: add with category, link and remarks, pay, link, unlink, settle, edit and delete', async ({ page }) => {
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await mockRates(page, { TRY: 560 });
  await openAccount(page, { subtype: 'bank', name: 'Rina Bank', balance: '900000000' });
  await newEvent(page, 'Coast week');
  await corner(page, 'Share this event');
  const share = page.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await setCurrency(currencyRow(share, 'Currency'), 'TRY');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 60_000 });
  await openTrip(page);

  // A payment already on the trip, for the cost to be linked to later.
  await corner(page, 'Add spending');
  await recordSharedSpend(page, { note: 'Fish dinner', amount: '900', paidWith: 'Rina Bank', charged: { currency: 'IDR', amount: '504000' } });

  // The trip's own category, for the cost's picker.
  await corner(page, 'Categories');
  await page.getByTestId('event-category-add').click();
  await page.getByRole('dialog', { name: 'New category' }).getByLabel('Name', { exact: true }).fill('Stay');
  await page.getByRole('dialog', { name: 'New category' }).getByRole('button', { name: 'Save category' }).click();
  await expect(page.getByTestId('event-category')).toHaveCount(1);
  await page.goBack();
  await expect(page.getByTestId('shared-event')).toBeVisible();

  // No inline form any more: the first cost is added from the empty plan, the next from the bar's ＋.
  await showCard(page, 'Plan');
  await expect(page.getByRole('form', { name: 'Add to the plan' })).toHaveCount(0);
  await addSharedCost(page, { name: 'Hotel', quantity: '2', price: '1000', category: 'Stay', link: 'https://example.com/hotel', note: 'Sea view' });
  await addSharedCost(page, { name: 'Taxi', price: '150' });

  // Grouped by category: Stay holds the hotel, the cost with no category sits in a group of its own.
  const groups = page.getByTestId('plan-category');
  await expect(groups).toHaveCount(2);
  await expect(groups.filter({ hasText: 'Stay' }).getByTestId('shared-plan-item')).toHaveCount(1);
  await expect(groups.filter({ hasText: 'Stay' })).toContainText('Hotel');
  await expect(groups.filter({ hasText: 'No category' })).toContainText('Taxi');
  await expect(page.getByTestId('plan-count')).toContainText('0 of 2 paid');
  await page.screenshot({ path: `${SHOTS}/shared-cost-3.png` });

  // The cost's page.
  await page.getByTestId('shared-plan-item').filter({ hasText: 'Hotel' }).click();
  await expect(page.getByTestId('item-identity').getByRole('heading', { name: 'Hotel', exact: true })).toBeVisible();
  await expect(page.getByTestId('item-identity').getByTestId('category-mark')).toBeVisible();
  await expect(page.getByTestId('item-status')).toHaveText('Unpaid · Stay');
  const strip = page.getByTestId('item-figures');
  await expect(strip).toContainText('Price each');
  await expect(strip).toContainText('How many');
  await expect(strip).toContainText('Total');
  await expect(strip).toContainText(/1[.,]000/);
  await expect(strip).toContainText(/2[.,]000/);
  await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
  const link = page.getByRole('link', { name: /example\.com\/hotel/ });
  await expect(link).toHaveAttribute('href', 'https://example.com/hotel');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByText('Remarks', { exact: true })).toBeVisible();
  await expect(page.getByText('Sea view')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Paid', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Settled' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/shared-cost-1.png` });

  // Pay now: the ordinary shared Add screen, filled from the cost; the payment is then on the cost.
  await page.getByRole('button', { name: 'Pay now' }).click();
  await recordSharedSpend(page, { note: 'Hotel deposit', amount: '500', paidWith: 'Rina Bank', charged: { currency: 'IDR', amount: '280000' } });
  await showCard(page, 'Plan');
  await page.getByTestId('shared-plan-item').filter({ hasText: 'Hotel' }).click();
  await expect(page.getByTestId('item-status')).toHaveText(/paid · Stay$/);
  await expect(page.getByRole('heading', { name: 'Paid', exact: true })).toBeVisible();
  await expect(page.getByTestId('item-payment')).toHaveCount(1);
  await expect(page.getByTestId('item-payment')).toContainText('Hotel deposit');
  await expect(page.getByRole('button', { name: 'Add payment' })).toBeVisible();

  // Link a payment: an expense of the trip not already on the cost, its part offered, then saved.
  await page.getByRole('link', { name: 'Link a payment' }).click();
  await expect(page.getByTestId('link-choice')).toHaveCount(1);
  await expect(page.getByTestId('link-choice')).toContainText('Fish dinner');
  await page.getByTestId('link-choice').click();
  await expect(page.getByLabel('Its part')).toHaveValue(/\d/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('item-payment')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Unlink every payment' })).toBeVisible();

  // Unlink: every payment comes off and the cost is back to unpaid.
  await page.getByRole('button', { name: 'Unlink every payment' }).click();
  await expect(page.getByRole('heading', { name: 'Paid', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('item-status')).toHaveText('Unpaid · Stay');
  await expect(page.getByRole('button', { name: 'Pay now' })).toBeVisible();

  // Settled: a payment linked again, then the switch; a settled cost has no way left to pay.
  await page.getByRole('link', { name: 'Link a payment' }).click();
  await page.getByTestId('link-choice').first().click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const settled = page.getByRole('checkbox', { name: 'Settled' });
  await expect(settled).not.toBeChecked();
  await settled.click();
  await expect(settled).toBeChecked();
  await expect(page.getByTestId('item-status')).toHaveText('Settled · Stay');
  await expect(page.getByRole('button', { name: /^(Pay now|Add payment)$/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Link a payment' })).toHaveCount(0);

  // Edit: the full form, the category picked from the trip's grid.
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('What', { exact: true })).toHaveValue('Hotel');
  await expect(page.getByLabel('Purchase link')).toHaveValue('https://example.com/hotel');
  await expect(page.getByLabel('Remarks')).toHaveValue('Sea view');
  await expect(page.getByRole('button', { name: 'Category, Stay' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/shared-cost-2.png` });
  await page.getByLabel('What', { exact: true }).fill('Hotel stay');
  await page.getByLabel('Remarks').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('item-identity').getByRole('heading', { name: 'Hotel stay', exact: true })).toBeVisible();
  await expect(page.getByText('Sea view')).toHaveCount(0);
  // Saved on the same row: the payments are still on it.
  await expect(page.getByTestId('item-payment')).toHaveCount(1);

  // Delete is at the foot of the form, and asks because payments are on the cost.
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  expect(asked.some((message) => message.startsWith('Delete Hotel stay?'))).toBe(true);
  await expect(page.getByTestId('shared-event')).toBeVisible();
  await expect(page.getByTestId('shared-plan-item').filter({ hasText: 'Hotel stay' })).toHaveCount(0);
  await expect(page.getByTestId('shared-plan-item').filter({ hasText: 'Taxi' })).toBeVisible();

  // With no payment, Delete goes straight away.
  asked.length = 0;
  await page.getByTestId('shared-plan-item').filter({ hasText: 'Taxi' }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('shared-plan-item')).toHaveCount(0);
  expect(asked).toEqual([]);
});
