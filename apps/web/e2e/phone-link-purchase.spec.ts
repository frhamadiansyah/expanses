import { expect, type Locator, test, type Page } from '@playwright/test';
import { addTransaction } from './add-transaction';
import { openAccount } from './accounts';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';
import { household, MONTHS } from './bill-pause';
import { todayIn } from './today';

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/link';

/** The day of a month this many months back, in YYYY-MM-DD. */
function monthsAgo(months: number, day = 15): { date: string; label: string; month: string } {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day));
  return { date: at.toISOString().slice(0, 10), label: `${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`, month: at.toISOString().slice(0, 7) };
}

const thisMonth = () => monthsAgo(0, 1);

async function openGym(page: Page) {
  await page.goto('/bills');
  await page.getByTestId('bill-row').filter({ hasText: 'Gym' }).click();
  await expect(page.getByTestId('bill-hero')).toBeVisible();
}

async function buyGym(page: Page, description: string, amount: string, date: string) {
  await page.goto('/transactions');
  await addTransaction(page, { description, paidWith: 'BCA Tahapan', category: 'Sports & fitness', amount, date });
}

const actions = (page: Page) => page.getByRole('group', { name: 'Actions' });

/** Pointer down, a drag to the left, up — the gesture that reveals a row's actions. */
async function swipeLeft(page: Page, row: Locator) {
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  const from = box.x + box.width - 12;
  await page.mouse.move(from, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(from - 120 * (step / 10), y);
  await page.mouse.up();
}

test('on a phone: a purchase already recorded is linked to this month from the Pay sheet, and unlinked again', async ({ page }) => {
  await household(page);
  await buyGym(page, 'Gym fee', '340000', thisMonth().date);
  await openGym(page);

  await actions(page).getByRole('button', { name: 'Pay', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay Gym' });
  await page.screenshot({ path: `${SHOTS}-1-pay-sheet.png` });
  await sheet.getByTestId('link-purchase').click();

  await expect(page).toHaveURL(/\/bills\/.+\/link\?.*month=/);
  await expect(page.getByRole('heading', { name: "In the bill's category, newest first" })).toBeVisible();
  const candidate = page.getByTestId('link-candidate');
  await expect(candidate).toHaveCount(1);
  await expect(candidate).toContainText('Gym fee');
  await expect(candidate).toContainText('close');
  await page.screenshot({ path: `${SHOTS}-2-pick.png` });
  await candidate.click();

  // Back on the bill: the month is paid with the purchase's own amount, listed in History like any payment.
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  const history = page.getByTestId('bill-history');
  await expect(history).toContainText('Rp 340.000');
  await expect(history).toContainText('paid');
  await page.screenshot({ path: `${SHOTS}-3-after.png` });

  // A linked payment opens to the purchase or Unlink, never to Undo payment.
  await history.getByRole('button', { name: /bill/ }).first().click();
  const paid = page.getByRole('dialog', { name: /^Gym · / });
  await expect(paid.getByRole('button', { name: 'Open the purchase' })).toBeVisible();
  await expect(paid.getByRole('button', { name: 'Undo payment' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}-4-sheet.png` });
  await paid.getByRole('button', { name: 'Unlink' }).click();

  await expect(actions(page).getByRole('button', { name: 'Pay', exact: true })).toBeVisible();
  await expect(history.getByText('paid')).toHaveCount(0);
  // Linking stepped back to the bill rather than opening it again: one step back from it is Recurring.
  await page.goBack();
  await expect(page).toHaveURL(/\/bills\/?(\?.*)?$/);
  // The purchase is still there.
  await page.goto('/transactions');
  await expect(page.getByText('Gym fee')).toBeVisible();
});

test('on a phone: a month before the bill started is linked from Link an earlier month, and no total moves', async ({ page }) => {
  await household(page);
  const three = monthsAgo(3);
  const four = monthsAgo(4);
  await buyGym(page, 'Gym old', '350000', three.date);
  await buyGym(page, 'Gym old two', '120000', monthsAgo(3, 20).date);
  await buyGym(page, 'Gym older', '349000', four.date);
  await openGym(page);

  const hero = page.getByTestId('bill-hero');
  const before = await hero.innerText();
  await page.getByRole('button', { name: 'Link an earlier month' }).click();
  await expect(page).toHaveURL(/\/bills\/.+\/earlier/);
  await expect(page.getByRole('heading', { name: new RegExp(`^Before ${thisMonth().label}$`, 'i') })).toBeVisible();
  await expect(page.getByTestId(`earlier-${three.month}`)).toContainText('2 purchases');
  await expect(page.getByTestId(`earlier-${four.month}`)).toContainText('1 purchase');
  await expect(page.getByTestId(`earlier-${monthsAgo(2).month}`)).toContainText('None found');
  await page.screenshot({ path: `${SHOTS}-5-earlier.png` });

  await page.getByTestId(`earlier-${three.month}`).click();
  await expect(page.getByTestId('link-candidate')).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}-6-earlier-pick.png` });
  await page.getByTestId('link-candidate').filter({ hasText: 'Gym old two' }).click();

  const history = page.getByTestId('bill-history');
  await expect(history).toContainText(`${MONTHS[Number(three.month.slice(5)) - 1]} bill`);
  await expect(history).toContainText('Rp 120.000');
  // Nothing about the bill moved: the card, its status and the start month are as they were.
  expect(await hero.innerText()).toBe(before);
  // Linked from Earlier months, it stepped back past them to the bill: one step back from it is Recurring.
  await page.goBack();
  await expect(page).toHaveURL(/\/bills\/?(\?.*)?$/);
  await page.goto('/bills');
  await expect(page.getByTestId('bill-row').filter({ hasText: 'Gym' })).toContainText('350.000');
  await openGym(page);
  await page.getByRole('button', { name: 'Link an earlier month' }).click();
  // The month linked is no longer offered; the other purchase of it is not either.
  await expect(page.getByTestId(`earlier-${three.month}`)).toHaveCount(0);
  await expect(page.getByTestId(`earlier-${four.month}`)).toContainText('1 purchase');
});

test('on a phone: a receipt links its purchase to a bill in one tap, another month by a swipe, and refuses a paid month', async ({ page }) => {
  await household(page);
  await buyGym(page, 'Gym fee', '340000', thisMonth().date);
  await buyGym(page, 'Gym extra', '30000', thisMonth().date);

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Sports & fitness Gym fee/ }).click();
  // Bill reads None, and opens the bill list.
  await expect(page.getByTestId('receipt-bill')).toContainText('None');
  await page.getByTestId('receipt-bill').click();
  await expect(page.getByRole('heading', { name: 'Bills in this category first' })).toBeVisible();
  await expect(page.getByTestId('unlink-bill')).toHaveCount(0);
  // Each bill names the month a tap links to: a monthly bill's is the purchase's own.
  await expect(page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' })).toContainText(thisMonth().label);
  await page.screenshot({ path: `${SHOTS}-7-pick-bill.png` });
  // One tap links it, with no month page between.
  await page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' }).click();

  // Back on the receipt, whose Bill row now reads Linked.
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await expect(page.getByTestId('receipt-bill')).toContainText('Linked');
  await page.screenshot({ path: `${SHOTS}-10-receipt.png` });
  // This is the receipt's own entry, not a second one on top of the month page: its ‹ goes back to Cashflow.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/?(\?.*)?$/);
  await page.getByRole('button', { name: /^Sports & fitness Gym fee/ }).click();
  await expect(page.getByTestId('receipt-bill')).toContainText('Linked');

  // The bill list again: the current bill has its ✓ and its month; Open this bill opens it, and ‹ comes back.
  await page.getByTestId('receipt-bill').click();
  await expect(page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' }).getByTestId('bill-current')).toBeVisible();
  await expect(page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' })).toContainText(thisMonth().label);
  // Linked already: a tap on another bill never moves the link at once — it opens that bill's month page, whose ✓ does.
  await page.getByTestId(/^bill-choice-/).filter({ hasText: 'Phone' }).click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+\/bill\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Phone' })).toBeVisible();
  await page.getByRole('button', { name: 'Bill', exact: true }).click();
  await expect(page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' }).getByTestId('bill-current')).toBeVisible();
  await page.getByTestId('open-bill').click();
  await expect(page.getByTestId('bill-history')).toContainText('Rp 340.000');
  await page.getByRole('button', { name: 'Transaction' }).first().click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+\/bill$/);

  // A second purchase for the same month: the tap cannot link it, so the month page opens saying why.
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Sports & fitness Gym extra/ }).click();
  await page.getByTestId('receipt-bill').click();
  await page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' }).click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+\/bill\/[^/]+$/);
  await expect(page.getByTestId('link-refusal')).toHaveText(`${thisMonth().label} is already paid`);
  await expect(page.getByRole('button', { name: 'Link to bill' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}-11-refused.png` });

  // A swipe left on a bill offers Month, which opens the same page to choose another first.
  await page.getByRole('button', { name: 'Link to a bill' }).click();
  await swipeLeft(page, page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' }));
  await page.getByRole('button', { name: 'Choose the month for Gym' }).click();
  const month = page.getByTestId('link-month');
  await expect(month).toContainText(thisMonth().label);
  await page.screenshot({ path: `${SHOTS}-8-month.png` });
  await month.click();
  const wheel = page.getByRole('dialog', { name: 'Month' });
  await expect(wheel.getByRole('listbox', { name: 'Month' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}-9-wheel.png` });
  await wheel.getByRole('button', { name: 'Done' }).click();

  const pickMonth = async (at: { month: string }) => {
    await page.getByTestId('link-month').click();
    const picker = page.getByRole('dialog', { name: 'Month' });
    await picker.getByRole('listbox', { name: 'Month' }).getByRole('option', { name: MONTHS[Number(at.month.slice(5)) - 1]!, exact: true }).click();
    await picker.getByRole('listbox', { name: 'Year' }).getByRole('option', { name: at.month.slice(0, 4), exact: true }).click();
    await expect(picker.getByRole('listbox', { name: 'Month' }).getByRole('option', { selected: true })).toHaveText(MONTHS[Number(at.month.slice(5)) - 1]!);
    await picker.getByRole('button', { name: 'Done' }).click();
  };
  const earlier = monthsAgo(2);
  await pickMonth(earlier);
  await expect(page.getByTestId('link-month')).toContainText(earlier.label);
  await expect(page.getByTestId('link-refusal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Link to bill' }).click();
  await expect(page.getByTestId('receipt-bill')).toContainText('Linked');

  // Picking the bill again starts at the month it settles; ✓ on that month changes nothing.
  await page.getByTestId('receipt-bill').click();
  await expect(page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' })).toContainText(earlier.label);
  await page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' }).click();
  await expect(page.getByTestId('link-month')).toContainText(earlier.label);
  await expect(page.getByTestId('link-refusal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Link to bill' }).click();
  await expect(page.getByTestId('receipt-bill')).toContainText('Linked');

  // Another month moves the link: the month it left is free again, the new one holds it.
  const further = monthsAgo(3);
  await page.getByTestId('receipt-bill').click();
  await page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' }).click();
  await pickMonth(further);
  await page.getByRole('button', { name: 'Link to bill' }).click();
  await expect(page.getByTestId('receipt-bill')).toContainText('Linked');
  await page.getByTestId('receipt-bill').click();
  await expect(page.getByTestId(/^bill-choice-/).filter({ hasText: 'Gym' })).toContainText(further.label);
  await page.screenshot({ path: `${SHOTS}-12-moved.png` });

  // The bill, opened from here and left by its ‹, is the receipt's own step: it is never where Delete lands.
  await page.getByTestId('open-bill').click();
  await expect(page.getByTestId('bill-hero')).toBeVisible();
  await page.getByRole('button', { name: 'Transaction' }).first().click();

  // Unlink, from the bill list, frees the month: back on the receipt the row reads None.
  await page.getByTestId('unlink-bill').click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await expect(page.getByTestId('receipt-bill')).toContainText('None');
  await page.screenshot({ path: `${SHOTS}-13-none.png` });

  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page).toHaveURL(/\/transactions\/?(\?.*)?$/);
});

test('on a phone: a yearly bill not begun yet takes a purchase in the month it comes out, asked first on its month page', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  // Out about six weeks from today, so its month is never this one.
  const [y, m, d] = (await todayIn(page)).split('-').map(Number) as [number, number, number];
  const out = new Date(y, m - 1, d + 45);
  const outLabel = `${MONTHS[out.getMonth()]} ${out.getFullYear()}`;
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Domain renewal');
  await page.getByLabel('Amount', { exact: true }).fill('210000');
  await pickBillCategory(page);
  await pickBillPaidFrom(page, 'BCA Tahapan');
  await page.getByLabel('Repeats').selectOption('yearly');
  await page.getByLabel('Month', { exact: true }).selectOption(String(out.getMonth() + 1));
  await page.getByLabel('Due by').selectOption(String(Math.min(out.getDate(), 28)));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Domain early', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '205000', date: await todayIn(page) });
  await page.getByRole('button', { name: /^Restaurants Domain early/ }).click();
  await page.getByTestId('receipt-bill').click();
  const bill = page.getByTestId(/^bill-choice-/).filter({ hasText: 'Domain renewal' });
  await expect(bill).toContainText(outLabel);
  // The list reloaded on the way (the app restarted under it): the way back to the receipt is not known any more.
  await page.reload();
  // Bought before the bill's first occurrence: the tap opens the month page at that occurrence rather than linking.
  await bill.click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+\/bill\/[^/]+$/);
  await expect(page.getByTestId('link-month')).toContainText(outLabel);
  await expect(page.getByTestId('link-refusal')).toHaveCount(0);
  await page.getByRole('button', { name: 'Link to bill' }).click();

  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await expect(page.getByTestId('receipt-bill')).toContainText('Linked');
  // Even so, the receipt's ‹ goes to Cashflow, never back to the bill list just used.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/?(\?.*)?$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await page.getByTestId('receipt-bill').click();
  await expect(bill.getByTestId('bill-current')).toBeVisible();
  await expect(bill).toContainText(outLabel);
});
