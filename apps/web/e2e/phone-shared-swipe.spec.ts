import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { mockRates } from './pockets';
import { addSharedCost, corner, newEvent, openTrip, recordSharedSpend, showCard, spendingRow } from './shared-events';

/*
 * The shared trip's hero swipes between three cards, Spending, Balances and Plan, with a dot each and no tabs; the list
 * under the hero follows the card. One phone is enough: Budi is a name without the app, so there is something to settle.
 * Invented figures, a trip in lira (1 TRY = 560 IDR). Screenshots of the three cards go to the scratchpad.
 */

test.describe.configure({ timeout: 240_000 });

const SHOTS = '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad';

const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Every card's contents sit inside its own card: nothing overflows sideways. */
const noClip = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="hero-slide-"]')].every((slide) => {
      const box = slide.getBoundingClientRect();
      return [...slide.querySelectorAll('*')].every((el) => {
        const r = el.getBoundingClientRect();
        return r.width === 0 || (r.left >= box.left - 0.5 && r.right <= box.right + 0.5);
      });
    }),
  );

test('the shared trip swipes between Spending, Balances and Plan', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await mockRates(page, { TRY: 560 });
  await openAccount(page, { subtype: 'bank', name: 'Rina Bank', balance: '900000000' });
  await newEvent(page, 'Coast week');
  await corner(page, 'Share this event');
  const share = page.getByRole('form', { name: 'Share this event' });
  await share.getByLabel('Name', { exact: true }).fill('Rina');
  await share.getByLabel('Currency').selectOption('TRY');
  await share.getByLabel('Without the app').fill('Budi');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('invite-link')).toBeVisible({ timeout: 60_000 });
  await openTrip(page);
  await corner(page, 'Add spending');
  await recordSharedSpend(page, { note: 'Fish dinner', amount: '900', paidWith: 'Rina Bank', charged: { currency: 'IDR', amount: '504000' } });
  await corner(page, 'Add spending');
  // A long amount, to see nothing clips on a 390 px phone.
  await recordSharedSpend(page, { note: 'Villa', amount: '123456789', paidWith: 'Rina Bank', charged: { currency: 'IDR', amount: '69135802' } });
  await expect(spendingRow(page, 'Villa')).toBeVisible();

  const dots = page.getByTestId('hero-dots');
  const dot = (name: string) => dots.getByRole('button', { name, exact: true });
  const carousel = page.getByRole('region', { name: 'Coast week sections' });

  // No tabs; three dots, Spending first.
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Balances' })).toHaveCount(0);
  await expect(carousel).toHaveAttribute('aria-roledescription', 'carousel');
  await expect(dots.getByRole('button')).toHaveCount(3);
  await expect(dot('Spending')).toHaveAttribute('aria-current', 'true');
  await expect(dot('Balances')).not.toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('shared-event-total')).toContainText('Total spent');
  await expect(page.getByTestId('shared-event-total').getByRole('heading', { name: 'Coast week' })).toBeVisible();
  await expect(spendingRow(page, 'Fish dinner')).toBeVisible();
  expect(await noPageScroll(page)).toBe(true);
  expect(await noClip(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/shared-swipe-1.png` });

  // No peek: the second card starts exactly at the carousel's right edge.
  const edge = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="hero-swipe"]')!.getBoundingClientRect();
    const second = document.querySelector('[data-testid="hero-slide-balances"]')!.getBoundingClientRect();
    return second.left - scroller.right;
  });
  expect(Math.abs(edge)).toBeLessThanOrEqual(1);

  // The dot for Balances: the Net balance panel and To settle up.
  await showCard(page, 'Balances');
  await expect(page.getByTestId('shared-balance-bars')).toBeInViewport();
  await expect(page.getByTestId('shared-balance-bars')).toContainText('Net balance');
  await expect(page.getByTestId('shared-balance-bars')).not.toContainText('Without the app');
  await expect(page.getByRole('heading', { name: 'To settle up' })).toBeVisible();
  await expect(page.getByTestId('shared-payment-row')).toHaveCount(1);
  await expect(spendingRow(page, 'Fish dinner')).toHaveCount(0);
  expect(await noPageScroll(page)).toBe(true);
  expect(await noClip(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/shared-swipe-2.png` });

  // The dot for Plan: the plan hero and the costs by category; add two costs from the ＋ form.
  await showCard(page, 'Plan');
  await expect(page.getByTestId('plan-totals')).toBeInViewport();
  await expect(page.getByTestId('plan-totals')).toContainText('Nothing planned yet');
  for (const [what, price] of [['Boat tour', '750'], ['Hotel', '2000']] as const) await addSharedCost(page, { name: what, price });
  await expect(page.getByTestId('plan-ring')).toBeInViewport();
  await expect(page.getByTestId('plan-count')).toContainText('0 of 2 paid');
  await expect(page.getByTestId('plan-status')).toContainText('Nothing paid yet');
  await expect(page.getByTestId('plan-planned')).toContainText(/2[.,]750/);
  await expect(page.getByTestId('shared-plan-card')).toHaveCount(0);
  await expect(page.getByTestId('shared-plan-item')).toHaveCount(2);
  expect(await noPageScroll(page)).toBe(true);
  expect(await noClip(page)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/shared-swipe-3.png` });
  // A row opens the cost's page, and the way back lands on the Plan card again.
  await page.getByTestId('shared-plan-item').filter({ hasText: 'Hotel' }).click();
  await expect(page.getByTestId('item-identity').getByRole('heading', { name: 'Hotel', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to the plan' }).click();
  await expect(dot('Plan')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('plan-ring')).toBeInViewport();

  // A swipe: scroll the carousel back one card at a time, and the active dot follows.
  const scrollTo = (index: number) => carousel.evaluate((el, i) => el.scrollTo({ left: i * el.clientWidth, behavior: 'instant' as ScrollBehavior }), index);
  await scrollTo(1);
  await expect(dot('Balances')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('shared-payment-row')).toHaveCount(1);
  await scrollTo(0);
  await expect(dot('Spending')).toHaveAttribute('aria-current', 'true');
  await expect(spendingRow(page, 'Villa')).toBeVisible();

  // A tap on the Spending card unfolds the category rows; picking one filters; a second tap folds and drops the pick.
  await page.getByTestId('see-categories').click();
  const rows = page.getByTestId('event-category-row');
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('shared-event-categories')).toBeVisible();
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(spendingRow(page, 'Villa')).toBeVisible();
  await page.getByTestId('hide-categories').click();
  await expect(rows).toHaveCount(0);

  // The last card is remembered while the page stays: back on Balances after another dot.
  await showCard(page, 'Balances');
  await showCard(page, 'Spending');
});
