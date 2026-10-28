import { expect, type Page, test } from '@playwright/test';
import { addEvent, addWallet, buyItNow, chooseCategory, fillItem } from './event-plan';

/*
 * The cost page and its edit form, by thumb.
 *
 * A cost is a thing or a service the event means to pay. Its page is an identity block (category mark, name, one
 * grey line), a price strip, Details, the Paid group, the two ways to pay and a Settled switch — with no sentence
 * anywhere and no delete: Delete is the last row of the edit form.
 */

/** The cost's page, from the plan list. */
async function openCost(page: Page, name: string) {
  await page.getByTestId('plan-item').filter({ hasText: name }).getByRole('link').click();
  await expect(page.getByTestId('item-identity').getByRole('heading', { name, exact: true })).toBeVisible();
}

/** An event with two costs: Ticket (two at Rp100.000, nothing else) and Guide (a link and a remark). */
async function plan(page: Page) {
  await addWallet(page);
  await addEvent(page, 'Museum trip');
  await page.getByRole('link', { name: 'Plan what to pay' }).click();
  await page.getByRole('link', { name: 'Add the first cost' }).click();
  await fillItem(page, { name: 'Ticket', quantity: '2', price: '100000', category: 'Food and beverage' });
  await page.getByRole('link', { name: 'Add a cost' }).first().click();
  await fillItem(page, { name: 'Guide', price: '300000', category: 'Food and beverage', link: 'https://example.com/guide', note: 'Combined ticket' });
}

test('the cost page: identity, three figures, Details only when there is something to show', async ({ page }) => {
  await plan(page);

  await openCost(page, 'Ticket');
  await expect(page.getByTestId('item-status')).toHaveText('Unpaid · Food and beverage');
  const strip = page.getByTestId('item-figures');
  await expect(strip.getByText('Price each', { exact: true })).toBeVisible();
  await expect(strip.getByText('How many', { exact: true })).toBeVisible();
  await expect(strip.getByText('Total', { exact: true })).toBeVisible();
  await expect(strip).toContainText(/Rp\s?100\.000/);
  await expect(strip).toContainText(/Rp\s?200\.000/);
  // Nothing to put in Details, so the group is not there; nothing is paid, so neither are Paid and Settled.
  await expect(page.getByRole('heading', { name: 'Details' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Paid', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Settled' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pay now' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Link a payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Back to the plan' }).click();
  await openCost(page, 'Guide');
  await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
  const link = page.getByRole('link', { name: /example\.com\/guide/ });
  await expect(link).toHaveAttribute('href', 'https://example.com/guide');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByText('Remarks', { exact: true })).toBeVisible();
  await expect(page.getByText('Combined ticket')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});

test('Pay now records a payment: the line says what is paid, then Paid and Settled appear', async ({ page }) => {
  await plan(page);
  await openCost(page, 'Ticket');
  await buyItNow(page, { paid: '150000', done: false });

  await openCost(page, 'Ticket');
  await expect(page.getByTestId('item-status')).toHaveText(/^Rp\s?150\.000 of Rp\s?200\.000 paid · Food and beverage$/);
  await expect(page.getByRole('heading', { name: 'Paid', exact: true })).toBeVisible();
  await expect(page.getByTestId('item-payment')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Add payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay now' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Link a payment' })).toBeVisible();

  const settled = page.getByRole('checkbox', { name: 'Settled' });
  await expect(settled).not.toBeChecked();
  await settled.click();
  await expect(settled).toBeChecked();
  await expect(page.getByTestId('item-status')).toHaveText('Settled · Food and beverage');

  await page.getByRole('button', { name: 'Unlink payment' }).click();
  await expect(page.getByRole('heading', { name: 'Paid', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Settled' })).toHaveCount(0);
  await expect(page.getByTestId('item-status')).toHaveText('Unpaid · Food and beverage');
});

test('Delete lives at the foot of the edit form: it asks when payments exist, and goes straight when none', async ({ page }) => {
  await plan(page);

  // Not on a new cost.
  await page.getByRole('link', { name: 'Add a cost' }).first().click();
  await expect(page.getByRole('heading', { name: 'New cost' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Cancel' }).click();

  // With a payment: asked first. Cancel leaves everything as it was; accepting deletes and lands on the plan.
  await openCost(page, 'Ticket');
  await buyItNow(page, { paid: '150000', done: false });
  await openCost(page, 'Ticket');
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit cost' })).toBeVisible();
  const messages: string[] = [];
  page.once('dialog', (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => messages).toEqual(['Delete Ticket? Its payments stay in the event as not planned.']);
  await expect(page.getByRole('heading', { name: 'Edit cost' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Ticket' })).toHaveCount(0);
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Guide' })).toHaveCount(1);

  // With none: straight away, no dialog.
  await openCost(page, 'Guide');
  await page.getByRole('link', { name: 'Edit' }).click();
  let asked = false;
  page.on('dialog', (dialog) => {
    asked = true;
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('plan-item').filter({ hasText: 'Guide' })).toHaveCount(0);
  expect(asked).toBe(false);
});

test('the category sheet has no None tile: tapping the chosen category again clears it', async ({ page }) => {
  await plan(page);
  await openCost(page, 'Guide');
  await page.getByRole('link', { name: 'Edit' }).click();

  await page.getByRole('button', { name: /^Category, / }).click();
  const sheet = page.getByRole('dialog', { name: 'Category' });
  await expect(sheet.getByRole('button', { name: 'None', exact: true })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Food and beverage', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Category, Not in a category' })).toBeVisible();

  // Another tile picks as before, and the same tile again clears.
  await chooseCategory(page, 'Food and beverage');
  await expect(page.getByRole('button', { name: 'Category, Food and beverage' })).toBeVisible();
});
