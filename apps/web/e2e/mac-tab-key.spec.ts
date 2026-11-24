import { type Browser, expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';

/*
 * The Mac app's web view hands Tab to the page and then never moves focus for it (native/tab-key.ts), so in the Mac
 * app the page moves focus itself. Chromium moves focus on its own, so these walks turn the Mac's code on
 * (`__cicisTabKey`) and check that it is what moved focus — every Tab marked handled — and that it goes where
 * Chromium itself goes. Every figure and name here is invented.
 */

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-11-18T12:00:00'));
});

/** Turns the Mac's Tab on for the next page load, and counts the Tab presses nothing marked handled. */
async function macTab(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cicisTabKey: boolean; __tabsLeft: number };
    w.__cicisTabKey = true;
    w.__tabsLeft = 0;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') setTimeout(() => (w.__tabsLeft += event.defaultPrevented ? 0 : 1));
    });
  });
}
const tabsLeft = (page: Page) => page.evaluate(() => (window as unknown as { __tabsLeft: number }).__tabsLeft);

/** Where focus is, by what it says (its label, or failing that its text), and what it is. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return '(page)';
    const name = el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent?.trim().slice(0, 30) ?? '';
    return `${el.tagName.toLowerCase()} ${name}`;
  });

/**
 * Opens the same page twice — Chromium's own Tab, then the Mac's — presses the same keys from the same field in each,
 * and gives where focus went after each press.
 */
async function bothWays(browser: Browser, open: (page: Page) => Promise<Locator>, presses: string[]) {
  const run = async (mac: boolean) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.clock.setSystemTime(new Date('2026-11-18T12:00:00'));
    if (mac) await macTab(page);
    await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
    await (await open(page)).focus();
    const seen: string[] = [];
    for (const key of presses) {
      await page.keyboard.press(key);
      seen.push(await focused(page));
    }
    const left = mac ? await tabsLeft(page) : 0;
    await context.close();
    return { seen, left };
  };
  const browserOwn = await run(false);
  const mac = await run(true);
  return { browserOwn: browserOwn.seen, mac: mac.seen, left: mac.left };
}

test('in the Mac app, Tab moves along the typing row and on past it, and ⇧Tab back, as it does in a browser', async ({ page }) => {
  await macTab(page);
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '9000000' });
  await page.goto('/transactions');
  const typing = page.getByTestId('typing-row');
  await expect(typing.getByLabel('Row payment method')).toBeEnabled();

  await typing.getByLabel('Row date').focus();
  await page.keyboard.press('Tab');
  await expect(typing.getByLabel('Row description')).toBeFocused();
  await page.keyboard.type('Roti Contoh');
  await page.keyboard.press('Tab');
  await expect(typing.getByLabel('Row category')).toBeFocused();
  // Tab in an open list takes its highlighted choice and goes on to the next cell.
  await page.keyboard.type('Restaurants');
  await expect(typing.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(typing.getByLabel('Row payment method')).toBeFocused();
  await expect(typing.getByLabel('Row category')).toHaveValue('Restaurants');
  await page.keyboard.type('Bank Contoh');
  await page.keyboard.press('Tab');
  await expect(typing.getByLabel('Row amount (IDR)')).toBeFocused();
  await page.keyboard.type('15000');
  await page.keyboard.press('Shift+Tab');
  await expect(typing.getByLabel('Row payment method')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(typing.getByLabel('Row category')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  // Past Amount the row waits and a fresh row's Date takes the typing (the row's own Tab, which the Mac code leaves be).
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('not-recorded-row')).toHaveCount(1);
  await expect(typing.getByLabel('Row date')).toBeFocused();
  // The empty row's Amount is the page's last place: Tab goes round to the page's first, where a browser would leave.
  await typing.getByLabel('Row amount (IDR)').focus();
  await page.keyboard.press('Tab');
  expect(await focused(page)).not.toBe('(page)');
  expect(await page.evaluate(() => !document.querySelector('[data-testid="typing-row"]')?.contains(document.activeElement))).toBe(true);
  expect(await tabsLeft(page)).toBe(0);
});

// Back from a field up through the page, then forward again: never past the page's last place, where a browser leaves
// for its own toolbar and the Mac app goes round to the first.
const backAndForth = (n: number) => [...Array<string>(n).fill('Shift+Tab'), ...Array<string>(n).fill('Tab')];

test('in the Mac app, Tab and ⇧Tab visit the same places on the Cashflow page as a browser’s own Tab', async ({ browser }) => {
  const walk = await bothWays(
    browser,
    async (page) => {
      await page.goto('/transactions');
      const typing = page.getByTestId('typing-row');
      await expect(typing.getByLabel('Row payment method')).toBeEnabled();
      return typing.getByLabel('Row date');
    },
    backAndForth(14),
  );
  expect(walk.mac).toEqual(walk.browserOwn);
  expect(walk.left).toBe(0);
  // The walk leaves the row for the rest of the page and comes back to Date.
  expect(new Set(walk.browserOwn).size).toBeGreaterThan(10);
  expect(walk.browserOwn.at(-1)).toBe('input Row date');
});

test('in the Mac app, Tab and ⇧Tab visit the same places in the New transaction form as a browser’s own Tab', async ({ browser }) => {
  const walk = await bothWays(
    browser,
    async (page) => {
      await page.goto('/transactions/new');
      await expect(page.getByRole('heading', { name: 'New transaction' })).toBeVisible();
      return page.getByLabel('Note');
    },
    // Up from Note and back: below it is the Date field, which Chromium walks a part at a time (month, day, year) where
    // the Mac's date field is one place.
    backAndForth(8),
  );
  expect(walk.mac).toEqual(walk.browserOwn);
  expect(walk.left).toBe(0);
  expect(new Set(walk.browserOwn).size).toBeGreaterThan(5);
});
