import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { openGoalForm } from './goals';
import { goalRow, setAside } from './set-aside';
import { localIsoDate, todayIn } from './today';

/*
 * An invented household for the Mac Goals page: two money accounts, one month of pay and spending (so Saved a month is
 * something), and four goals — an emergency fund (compulsory), then Hajj, a trip and a car — three of them with money set
 * aside, the car with nothing yet; Hajj has a standing amount each month. Saved a month is Rp 5.000.000: the emergency fund
 * and Hajj fit in full, the trip gets part, the car waits.
 */

/** A day so many months from now, as the app names it. */
export function monthsAhead(months: number): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + months + 1);
  date.setDate(0);
  return localIsoDate(date);
}

/** A goal from its template: name, what it costs today (none for an emergency fund: its months) and its date. */
export async function addDeskGoal(page: Page, template: string, name: string, cost: string | null, dueOn: string) {
  if (!/\/goals$/.test(page.url())) await page.goto('/goals');
  await openGoalForm(page, template);
  await page.getByLabel('Name', { exact: true }).fill(name);
  // An emergency fund is counted in months of outgoings (its template's six), the others in what they cost today.
  if (cost) {
    const field = page.getByLabel(/Cost today/).first();
    await field.clear();
    await field.pressSequentially(cost);
  }
  await page.getByLabel('Due by').first().fill(dueOn);
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await expect(page).toHaveURL(/\/goals$/);
  await expect(goalRow(page, name)).toBeVisible({ timeout: 15_000 });
}

export const GOALS = { emergency: 'Emergency fund', hajj: 'Hajj', trip: 'Japan in spring', car: 'Car down payment' } as const;

export async function goalsHousehold(page: Page) {
  await openAccount(page, { subtype: 'savings', name: 'Jenius', balance: '80000000' });
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '30000000' });
  // Last month's pay and spending: Saved a month reads the last full months.
  const lastMonth = await todayIn(page, 35);
  await page.goto('/transactions');
  await addTransaction(page, { mode: 'Income', description: 'Salary', paidWith: 'BCA Tahapan', category: 'Salary, wage, or pay', amount: '9000000', date: lastMonth });
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '4000000', date: lastMonth });

  await page.goto('/goals');
  await addDeskGoal(page, 'Emergency fund', GOALS.emergency, null, monthsAhead(19));
  await addDeskGoal(page, 'Hajj or umrah', GOALS.hajj, '95000000', monthsAhead(59));
  await addDeskGoal(page, 'Holiday', GOALS.trip, '32000000', monthsAhead(5));
  await addDeskGoal(page, 'Vehicle', GOALS.car, '60000000', monthsAhead(13));
  await setAside(page, GOALS.emergency, 'Jenius (IDR)', '20000000');
  await setAside(page, GOALS.trip, 'Jenius (IDR)', '12000000');
  await setAside(page, GOALS.hajj, 'BCA Tahapan (IDR)', '10000000');
  // Hajj has a standing amount each month, set from its peek's Monthly: on track.
  await page.goto('/goals');
  await goalRow(page, GOALS.hajj).click();
  await page.getByTestId('goal-peek').getByRole('button', { name: 'Monthly', exact: true }).click();
  const monthly = page.getByRole('dialog', { name: `Monthly for ${GOALS.hajj}` });
  await monthly.getByRole('textbox', { name: 'Each month' }).fill('1600000');
  await monthly.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(monthly).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('goal-peek')).toHaveCount(0);
}
