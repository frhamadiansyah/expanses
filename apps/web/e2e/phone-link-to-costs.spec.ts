import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { fillItem, showPlanCard, TODAY } from './event-plan';

/*
 * "Link to costs" at 390px: one receipt shared out between costs.
 *
 * Two boxes and nothing else: a summary whose rows are all one weight, and a checklist drawn like the plan's list,
 * whose ticked rows carry the typed share grouped as it is typed.
 */

const SHOT = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/link-to-costs.png';

test('Link to costs reads as two plain boxes with the share grouped as typed', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
  await page.goto('/wallet');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await addTransaction(page, { description: 'Hospital', paidWith: 'BCA Tahapan', category: 'Food and beverage', amount: '4500000' });

  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('link', { name: /^Events/ }).click();
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Newborn');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Newborn', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Plan what to pay' }).click();
  await page.getByRole('link', { name: 'Add the first cost' }).click();
  await fillItem(page, { name: 'Delivery package', price: '3000000', category: 'Food and beverage' });
  for (const item of [
    { name: 'Check up', price: '1500000' },
    { name: 'Stroller', price: '3000000' },
  ]) {
    await page.getByRole('link', { name: 'Add a cost' }).first().click();
    await fillItem(page, { ...item, category: 'Food and beverage' });
  }

  // The receipt is offered once the plan names its category, so it is tagged now and not earlier.
  await page.getByRole('link', { name: 'Back to the event' }).click();
  await page.getByTestId('event-suggestions').getByRole('button', { name: 'Tag Hospital' }).click();
  await showPlanCard(page);
  await page.getByRole('link', { name: 'See the whole plan' }).click();

  await page.getByTestId('plan-item').filter({ hasText: 'Delivery package' }).getByRole('link').click();
  await page.getByRole('link', { name: 'Link a payment' }).click();
  await page.getByRole('link', { name: /Hospital/ }).click();

  await expect(page.getByRole('heading', { name: 'Link to costs' })).toBeVisible();
  await expect(page.getByText('not planned')).toHaveCount(0);
  await expect(page.getByText('Tick everything')).toHaveCount(0);

  // The summary: receipt, linked, left, all one weight and one size.
  const totals = page.getByTestId('cover-totals');
  await expect(totals).toContainText('Linked to costs');
  await expect(totals).toContainText('Left on this receipt');
  const looks = await totals.locator('section > div:last-of-type > *').evaluateAll((rows) =>
    rows.flatMap((row) => [...row.querySelectorAll('span')].filter((el) => el.children.length === 0 && el.textContent?.trim()).map((el) => {
      const style = getComputedStyle(el);
      return `${style.fontWeight}`;
    })),
  );
  const titles = await totals.locator('section > div:last-of-type > *').evaluateAll((rows) =>
    rows.map((row) => {
      const spans = [...row.querySelectorAll('span')].filter((el) => el.children.length === 0 && el.textContent?.trim());
      return [getComputedStyle(spans[0]!).fontWeight, getComputedStyle(spans[spans.length - 1]!).fontWeight];
    }),
  );
  expect(looks.length).toBeGreaterThan(0);
  expect(new Set(titles.flat())).toEqual(new Set(['400']));

  // The first cost is ticked at its estimate; the share regroups as digits are typed.
  const share = page.getByLabel('Share for Delivery package');
  await expect(share).toHaveValue('3.000.000');
  await share.fill('4200000');
  await expect(share).toHaveValue('4.200.000');
  await expect(totals).toContainText('Rp 4.200.000');
  await expect(totals).toContainText('Left on this receipt');
  await expect(totals).toContainText('Rp 300.000');

  // Over the receipt: the label changes, the figure stays plain and positive, Save is off.
  await page.getByRole('checkbox', { name: 'Check up' }).check();
  await page.getByLabel('Share for Check up').fill('1500000');
  await expect(totals).toContainText('Over this receipt');
  await expect(totals).not.toContainText('-');
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

  await page.screenshot({ path: SHOT });
});
