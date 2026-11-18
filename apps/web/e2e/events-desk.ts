import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { fillItem, recordIntoEvent } from './event-plan';
import { addDeskGoal, monthsAhead } from './goals-desk';
import { todayIn } from './today';

/*
 * An invented household for the Mac Events pages (Mac redesign step 11): a bank account and a card, a planned event two
 * months ahead ("Newborn": four costs, one bought, one being paid, two to buy) with a goal to save for it, a past
 * weekend with spending and no plan, and an event starting today with nothing yet. No name or figure is anyone's.
 */

export const EVENTS = { baby: 'Newborn', lake: 'Lake house week', dinner: 'Office dinner' } as const;

/** A day so many days from today, as the app names it. */
export async function dayFrom(page: Page, days: number): Promise<string> {
  return todayIn(page, -days);
}

/** An event from the cards page's ＋ New event, between two days. Returns its page's address. */
export async function deskEvent(page: Page, name: string, startsOn: string, endsOn: string): Promise<string> {
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event', exact: true }).click();
  await page.getByTestId('new-event').click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Starts on').fill(startsOn);
  await page.getByLabel('Ends on').fill(endsOn);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return page.url();
}

/** The event page's Plan tab. */
export async function planTab(page: Page) {
  await page.getByRole('tab', { name: /^Plan · / }).click();
  await expect(page.getByTestId('plan-table')).toBeVisible();
}

/** A cost added from the Plan tab's ＋ Add a cost (today's form), and back to the event. */
export async function deskCost(page: Page, eventUrl: string, cost: { name: string; price: string; category: string; quantity?: string }) {
  await page.goto(eventUrl);
  await planTab(page);
  await page.getByRole('link', { name: 'Add a cost' }).click();
  await fillItem(page, cost);
  await page.goto(eventUrl);
}

/** Pays a cost from its Status (Pay …): the Add screen filled in from the cost, at `paid` from `paidWith`; Settle when done. */
export async function deskPay(page: Page, eventUrl: string, cost: string, options: { paid: string; paidWith: string; done?: boolean }) {
  await page.goto(eventUrl);
  await planTab(page);
  await page.getByRole('button', { name: `Pay ${cost}`, exact: true }).click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, options.paidWith);
  await form.getByRole('button', { name: 'Clear amount' }).click();
  await openAmount(form);
  await fillAmount(page, form, options.paid);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await page.goto(eventUrl);
  if (options.done) {
    await planTab(page);
    await page.getByRole('button', { name: `Settle ${cost}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Reopen ${cost}`, exact: true })).toBeVisible();
  }
}

export async function eventsHousehold(page: Page): Promise<{ baby: string; lake: string; dinner: string }> {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '90000000' });
  await openAccount(page, { subtype: 'bank', name: 'Mandiri Giro', balance: '40000000' });
  // A goal to save for the baby, nothing set aside yet.
  await page.goto('/goals');
  await addDeskGoal(page, 'Holiday', 'Baby fund', '20000000', monthsAhead(3));

  const today = await todayIn(page);
  // Newborn: from 61 days ahead, two months of saving left.
  const baby = await deskEvent(page, EVENTS.baby, await dayFrom(page, 61), await dayFrom(page, 150));
  await deskCost(page, baby, { name: 'Stroller', price: '8200000', category: 'Groceries' });
  await deskCost(page, baby, { name: 'Check-ups', price: '2400000', category: 'Food and beverage' });
  await deskCost(page, baby, { name: 'Car seat', price: '4500000', category: 'Groceries' });
  await deskCost(page, baby, { name: 'Clothes', price: '500000', category: 'Food and beverage', quantity: '4' });
  await deskPay(page, baby, 'Stroller', { paid: '7950000', paidWith: 'BCA Tahapan', done: true });
  await deskPay(page, baby, 'Check-ups', { paid: '900000', paidWith: 'Mandiri Giro' });

  // Lake house week: last month, no plan, three payments from two accounts.
  const lake = await deskEvent(page, EVENTS.lake, await todayIn(page, 40), await todayIn(page, 33));
  await recordIntoEvent(page, { description: 'Villa deposit', amount: '3200000', category: 'Food and beverage', paidWith: 'BCA Tahapan' });
  await recordIntoEvent(page, { description: 'Fish market', amount: '640000', category: 'Groceries', paidWith: 'Mandiri Giro' });
  await recordIntoEvent(page, { description: 'Boat hire', amount: '450000', category: 'Food and beverage', paidWith: 'Mandiri Giro' });

  // Office dinner: today, nothing yet.
  const dinner = await deskEvent(page, EVENTS.dinner, today, today);
  return { baby, lake, dinner };
}
