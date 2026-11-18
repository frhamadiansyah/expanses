import { expect, type Page, test } from '@playwright/test';
import { EVENTS, eventsHousehold, planTab } from './events-desk';

/*
 * Events on a wide screen (Mac redesign step 11, option A): the cards page — Now and next, then Past — and an event full
 * width under its own title bar, whose name is a pop-up menu of every event. Boxes: Spent by category (click filters the
 * table), Plan, and Before it starts (a planned event ahead: what is still to pay, a month until then, the goal it is saved
 * for) or Paid with; then Transactions (a click opens the Mac receipt peek) and Plan (a cost's Planned typed in place,
 * Status as today's Done buying). The figures are the phone's. Invented household (`eventsHousehold`).
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const card = (page: Page, name: string) => page.getByTestId('event-row').filter({ hasText: name });
const section = (page: Page, title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const planRow = (page: Page, name: string) => page.getByTestId('plan-row').filter({ hasText: name });

test('cards, an event and its title menu, Before it starts with a goal, the Plan typed in place, the receipt peek — and the phone reads the same', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const urls = await eventsHousehold(page);

  // The cards: Now and next by start (today's dinner, then the baby), then the past weekend.
  await page.goto('/events');
  await expect(page.getByTestId('events-page')).toHaveAttribute('data-desk', 'true');
  await expect(section(page, 'Now and next').getByTestId('event-row')).toHaveCount(2);
  await expect(section(page, 'Now and next').getByTestId('event-row').nth(0)).toContainText(EVENTS.dinner);
  await expect(section(page, 'Now and next').getByTestId('event-row').nth(1)).toContainText(EVENTS.baby);
  await expect(section(page, 'Past').getByTestId('event-row')).toHaveText([new RegExp(EVENTS.lake)]);
  // Newborn: Stroller (bought at 7.950.000) and the check-ups' first payment (900.000) of a plan of 17.100.000.
  await expect(card(page, EVENTS.baby)).toContainText(/Rp\s?8\.850\.000\s*of Rp\s?17\.100\.000/);
  await expect(card(page, EVENTS.baby).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '52');
  await expect(card(page, EVENTS.lake)).toContainText(/Rp\s?4\.290\.000\s*spent/);
  await expect(card(page, EVENTS.dinner)).toContainText(/Rp\s?0\s*spent/);
  // Four cards a row at 1280: the dashed card sits beside the two, on the same row.
  const firstBox = await card(page, EVENTS.dinner).boundingBox();
  const dashed = await page.getByTestId('new-event-card').boundingBox();
  expect(Math.abs((dashed?.y ?? 0) - (firstBox?.y ?? 1))).toBeLessThan(1);

  // An event opens full width; its name heads the bar.
  await card(page, EVENTS.baby).click();
  await expect(page.getByRole('heading', { name: EVENTS.baby, exact: true })).toBeVisible();
  await expect(page.getByTestId('event-page')).toHaveAttribute('data-desk', 'true');
  const plan = page.getByTestId('event-plan-box');
  await expect(plan.getByTestId('plan-box-spent')).toHaveText(/^Rp\s?8\.850\.000$/);
  await expect(plan.getByTestId('plan-box-of')).toHaveText(/^of Rp\s?17\.100\.000$/);
  // Still to pay: the car seat 4.500.000, the clothes 2.000.000, the check-ups' 1.500.000 left.
  await expect(plan.getByTestId('plan-box-line')).toHaveText(/^Rp\s?8\.000\.000 still to pay$/);
  await expect(plan.getByTestId('plan-box-bought')).toHaveText(/Bought\s*1 of 4/);
  await expect(plan.getByTestId('plan-box-not-planned')).toHaveText(/Not on the plan\s*Rp\s?0/);

  // Before it starts: all of the still-to-pay, over the whole months left, rounded up to a whole rupiah.
  const before = page.getByTestId('before-it-starts');
  await expect(before.getByTestId('before-to-pay')).toHaveText(/To pay before then\s*Rp\s?8\.000\.000/);
  const months = Number(/Over (\d+) month/.exec((await before.getByTestId('before-a-month').locator('[title]').getAttribute('title')) ?? '')?.[1]);
  expect(months).toBeGreaterThanOrEqual(1);
  const aMonth = Math.ceil(8_000_000 / months).toLocaleString('id-ID');
  await expect(before.getByTestId('before-a-month')).toHaveText(new RegExp(`A month until then\\s*Rp\\s?${aMonth.replace(/\./g, '\\.')}$`));

  // Link a goal: the running goals, one picked; its name opens the goal, with what is saved of its target.
  await before.getByRole('button', { name: 'Link a goal ›' }).click();
  await page.getByRole('menuitemradio', { name: /Baby fund/ }).click();
  await expect(before.getByTestId('before-goal-link')).toHaveText('Baby fund ›');
  await expect(before.getByTestId('before-goal-saved')).toHaveText(/^Rp\s?0 saved of Rp\s?[\d.]+$/);
  // Kept by the event: over a reload, and over a rename on its Settings page (today's event write keeps it too).
  await page.reload();
  await expect(before.getByTestId('before-goal-link')).toHaveText('Baby fund ›');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  const rename = page.getByTestId('settings-name');
  await rename.fill('Newborn baby');
  await rename.press('Enter');
  await page.getByRole('link', { name: 'Newborn baby', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Newborn baby', exact: true })).toBeVisible();
  await expect(before.getByTestId('before-goal-link')).toHaveText('Baby fund ›');
  await before.getByTestId('before-goal-link').click();
  await expect(page).toHaveURL(/\/goals\/[^/]+$/);
  await page.goto(urls.baby);

  // The title menu: Now and next then Past, each first day, ✓ on this one; another event opens in its place.
  await page.getByTestId('event-title-menu').click();
  const menu = page.getByRole('menu', { name: 'Events' });
  await expect(menu.getByRole('group', { name: 'Now and next' }).getByRole('menuitemradio')).toHaveText([new RegExp(EVENTS.dinner), /Newborn baby/]);
  await expect(menu.getByRole('group', { name: 'Past' }).getByRole('menuitemradio')).toHaveText([new RegExp(EVENTS.lake)]);
  await expect(menu.getByRole('menuitemradio', { name: /Newborn baby/ })).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitem', { name: 'New event' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'All events…' })).toBeVisible();
  await menu.getByRole('menuitemradio', { name: new RegExp(EVENTS.lake) }).click();
  await expect(page.getByRole('heading', { name: EVENTS.lake, exact: true })).toBeVisible();
  await expect(page.getByRole('menu', { name: 'Events' })).toHaveCount(0);

  // A past weekend with no plan: no Plan box, and Paid with by account adding up to the ring's total.
  await expect(page.getByTestId('event-plan-box')).toHaveCount(0);
  await expect(page.getByTestId('before-it-starts')).toHaveCount(0);
  const paid = page.getByTestId('paid-with');
  await expect(paid.getByTestId('paid-with-row')).toHaveText([/BCA Tahapan\s*Rp\s?3\.200\.000/, /Mandiri Giro\s*Rp\s?1\.090\.000/]);
  await expect(paid.getByTestId('paid-with-total')).toHaveText(/Total\s*Rp\s?4\.290\.000/);
  await expect(page.getByTestId('event-ring').getByTestId('period-total')).toHaveText(/^Rp\s?4\.290\.000$/);

  // The ring filters the table, Show all lets go.
  const rows = page.getByTestId('event-history');
  await expect(rows).toHaveCount(3);
  await page.getByTestId('event-ring').getByRole('button', { name: /^Groceries/ }).click();
  await expect(rows).toHaveText([/Fish market/]);
  await page.getByRole('button', { name: 'Show all' }).click();
  await expect(rows).toHaveCount(3);

  // A click on a row: the Mac receipt peek beside the page (never the phone's receipt page), the page making room.
  await rows.filter({ hasText: 'Villa deposit' }).click();
  const peek = page.getByTestId('receipt-peek');
  await expect(peek).toBeVisible();
  await expect(peek.getByTestId('peek-title')).toHaveText('Villa deposit');
  await expect(page).toHaveURL(/\/events\/[^/]+$/);
  const table = await page.getByTestId('event-table-box').boundingBox();
  const side = await peek.boundingBox();
  expect((table?.x ?? 0) + (table?.width ?? 0)).toBeLessThanOrEqual((side?.x ?? 0) + 1);
  await expect(rows.filter({ hasText: 'Villa deposit' })).toHaveAttribute('aria-selected', 'true');
  // ↑ ↓ step through the rows; Esc puts it away.
  await page.keyboard.press('ArrowUp');
  await expect(peek.getByTestId('peek-title')).toHaveText('Fish market');
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);

  // Back to Newborn by the menu; the Plan tab, a cost typed in place.
  await page.getByTestId('event-title-menu').click();
  await page.getByRole('menuitemradio', { name: /Newborn baby/ }).click();
  await expect(page.getByRole('heading', { name: 'Newborn baby', exact: true })).toBeVisible();
  await planTab(page);
  await expect(page.getByTestId('plan-row')).toHaveCount(4);
  await expect(planRow(page, 'Stroller').getByTestId('plan-status')).toHaveText('Bought ✓');
  await expect(planRow(page, 'Check-ups').getByTestId('plan-status')).toHaveText('Paying');
  await expect(planRow(page, 'Car seat').getByTestId('plan-status')).toHaveText('To buy');
  await expect(planRow(page, 'Stroller').getByTestId('plan-payments')).toHaveText(/^Stroller · \d+ \w{3}$/);
  await expect(page.getByTestId('plan-total')).toContainText(/Rp\s?17\.100\.000\s*Rp\s?8\.850\.000/);

  await planRow(page, 'Car seat').getByRole('button', { name: 'Planned for Car seat' }).click();
  const typed = page.getByRole('textbox', { name: 'Planned for Car seat' });
  await expect(typed).toHaveValue('4500000');
  await typed.fill('nothing');
  await typed.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Type a figure, such as 1.500.000');
  await typed.fill('5.000.000');
  await typed.press('Enter');
  await expect(planRow(page, 'Car seat').getByTestId('plan-planned')).toHaveText(/^Rp\s?5\.000\.000$/);
  await expect(page.getByTestId('plan-total')).toContainText(/Rp\s?17\.600\.000/);
  // Every box reads the new figure: the plan, still to pay, and Before it starts.
  await expect(plan.getByTestId('plan-box-of')).toHaveText(/^of Rp\s?17\.600\.000$/);
  await expect(plan.getByTestId('plan-box-line')).toHaveText(/^Rp\s?8\.500\.000 still to pay$/);
  await expect(before.getByTestId('before-to-pay')).toHaveText(/Rp\s?8\.500\.000/);
  // Esc keeps the figure there was.
  await planRow(page, 'Car seat').getByRole('button', { name: 'Planned for Car seat' }).click();
  await typed.fill('1');
  await typed.press('Escape');
  await expect(planRow(page, 'Car seat').getByTestId('plan-planned')).toHaveText(/^Rp\s?5\.000\.000$/);
  // Several of something opens its form, where the price each and how many are both said.
  await planRow(page, 'Clothes').getByRole('button', { name: 'Planned for Clothes' }).click();
  await expect(page).toHaveURL(/\/plan\/[^/]+\/edit/);
  await expect(page.getByLabel('How many')).toHaveValue('4');
  await page.goto(urls.baby);
  await planTab(page);

  // Status is today's tick: Done buying settles the check-ups, Reopen puts them back.
  await planRow(page, 'Check-ups').getByRole('button', { name: 'Settle Check-ups' }).click();
  await expect(planRow(page, 'Check-ups').getByTestId('plan-status')).toHaveText('Bought ✓');
  await expect(plan.getByTestId('plan-box-bought')).toHaveText(/Bought\s*2 of 4/);
  await expect(plan.getByTestId('plan-box-line')).toHaveText(/^Rp\s?7\.000\.000 still to pay$/);
  await planRow(page, 'Check-ups').getByRole('button', { name: 'Reopen Check-ups' }).click();
  await expect(planRow(page, 'Check-ups').getByTestId('plan-status')).toHaveText('Paying');

  // The receipt peek from the Transactions tab of this event too.
  await page.getByRole('tab', { name: /^Transactions · 2$/ }).click();
  await page.getByTestId('event-history').filter({ hasText: 'Stroller' }).click();
  await expect(page.getByTestId('receipt-peek').getByTestId('peek-title')).toHaveText('Stroller');
  await page.keyboard.press('Escape');

  // The phone's list and page read the same figures for the same event.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/events');
  const phoneRow = page.getByTestId('event-row').filter({ hasText: 'Newborn baby' });
  await expect(phoneRow).toContainText(/Rp\s?8\.850\.000/);
  await expect(phoneRow).toContainText(/of Rp\s?17\.600\.000/);
  await expect(page.getByTestId('event-row').filter({ hasText: EVENTS.lake })).toContainText(/Rp\s?4\.290\.000/);
  await phoneRow.click();
  await expect(page.getByTestId('event-total')).toContainText(/Rp\s?8\.850\.000/);
});
