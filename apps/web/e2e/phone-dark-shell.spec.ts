import { expect, type Locator, type Page, test } from '@playwright/test';
import { addTransaction } from './add-transaction';
import { restoreAgedByDays } from './backup-reminders-fixture';
import { addBank } from './recovery-fixture';
import { tokenColour } from './securities';

/*
 * The shell in the dark — what the audit found and the restyle did not cause: the kit resolved in the dark from
 * its first commit, and the frame around it never did. A black page kept a white tab bar, a sky-blue install
 * banner, and a white band at its foot, because the shell's colours were literals and the tokens could not reach
 * them.
 *
 * Every assertion here is the **token**, never a hex copied out of `tokens.css`: the test asks the browser what a
 * custom property resolved to and then asks for that same colour on the element. A hex in the test would pass
 * while the shell drew something else entirely, which is the failure this file exists to catch.
 */

test.use({ colorScheme: 'dark' });

/** The colour an element is really painted in. */
const painted = (target: Locator) => target.evaluate((node) => getComputedStyle(node).backgroundColor);

/** What a screen's own text is drawn in. */
const inked = (target: Locator) => target.evaluate((node) => getComputedStyle(node).color);

/** The shell is on every phone screen, so this is the marker that the app has mounted. */
const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test('the page itself is the kit’s ground, so no white band shows under a dark screen', async ({ page }) => {
  await page.goto('/transactions');
  await expect(tabBar(page)).toBeVisible();

  // The dark block is the one that won...
  expect(await tokenColour(page, '--ph-ground')).toBe('rgb(0, 0, 0)');
  // ...and the page is drawn from it, rather than from a literal.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(await tokenColour(page, '--ph-ground'));
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(await tokenColour(page, '--ph-ink'));
  // `color-scheme` is what lets the browser draw its own furniture — the scrollbar, a date picker — in the dark.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain('dark');
});

test('the floating tab bar is the kit’s chrome, not a white capsule on a black page', async ({ page }) => {
  await page.goto('/transactions');
  const bar = tabBar(page);
  await expect(bar).toBeVisible();

  expect(await tokenColour(page, '--ph-chrome')).toBe('rgba(28, 28, 30, 0.8)');
  expect(await painted(bar)).toBe(await tokenColour(page, '--ph-chrome'));
  expect(await painted(bar)).not.toBe('rgb(255, 255, 255)');
});

test('the install banner is a toned panel, not the light one', async ({ page }) => {
  await page.goto('/transactions');
  const banner = page.getByRole('status').filter({ hasText: 'Install Expanses' });
  await expect(banner).toBeVisible();

  expect(await painted(banner)).toBe(await tokenColour(page, '--ph-info-panel'));
  // The light banner was Tailwind's sky-50; it is what the audit found on a black page.
  expect(await painted(banner)).not.toBe('rgb(240, 249, 255)');
  expect(await inked(banner)).toBe(await tokenColour(page, '--ph-info-ink'));
});

test('the backup reminder, its button and its ink all move together', async ({ page }, testInfo) => {
  await addBank(page, 'Needs backing up', '1000000');
  await restoreAgedByDays(page, testInfo.outputPath('aged.sqlite3'), 31);
  await page.goto('/transactions');

  const banner = page.getByRole('status').filter({ hasText: 'No backup in 31 days.' });
  await expect(banner).toBeVisible();
  expect(await painted(banner)).toBe(await tokenColour(page, '--ph-warn-panel'));
  expect(await inked(banner)).toBe(await tokenColour(page, '--ph-warn-ink'));

  /*
   * The button inside it is the shared primitive, so this is the sweep as much as the banner: a `Button` used to
   * be Tailwind's `bg-slate-900 text-white`, which on a dark page is a white slab with dark text on it.
   */
  const download = banner.getByRole('button', { name: 'Download backup' });
  expect(await painted(download)).toBe(await tokenColour(page, '--ph-ink'));
  expect(await inked(download)).toBe(await tokenColour(page, '--ph-surface'));
});

test('a screen the decision list left alone follows the reader too', async ({ page }) => {
  /*
   * A row is recorded first, because both halves of this test read a *list*: the surface token is painted on the
   * rows' own card, and the `bg-white` name below is the class that card carries. An empty month draws neither,
   * and the read would time out on nothing rather than on the wrong colour.
   */
  await addBank(page, 'BCA Tahapan', '5000000');
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '150000' });
  await page.goto('/transactions');
  await expect(tabBar(page)).toBeVisible();

  /*
   * Every element on the screen, not a sampled one: Tailwind's names are the kit's colours now, so a **light
   * ground** anywhere in the tree is a literal that escaped the remap, and this names it rather than hoping.
   *
   * White is deliberately not on the list. A filled control is `--ph-ink` as a fill with `--ph-surface` for its
   * text, so in the dark it *is* white with dark text on it — the palette working, not a survivor. What the sweep
   * is looking for is the greys and the toned panels, which have no business being light on a black page: slate's
   * 50, 100 and 200, and the four panel grounds.
   */
  const survivors = await page.evaluate(() => {
    const light = ['rgb(248, 250, 252)', 'rgb(241, 245, 249)', 'rgb(226, 232, 240)', 'rgb(240, 249, 255)', 'rgb(254, 243, 199)', 'rgb(254, 242, 242)', 'rgb(236, 253, 245)'];
    const found: string[] = [];
    for (const element of document.querySelectorAll('body *')) {
      const painted = getComputedStyle(element).backgroundColor;
      if (!light.includes(painted)) continue;
      found.push(`${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''} → ${painted}`);
    }
    return found.slice(0, 10);
  });
  expect(survivors).toEqual([]);

  // And the white utilities did move rather than merely survive: `bg-white` is the surface, which is near-black here.
  expect(await tokenColour(page, '--ph-surface')).toBe('rgb(28, 28, 30)');
  expect(await painted(page.locator('.bg-white').first())).toBe(await tokenColour(page, '--ph-surface'));
  expect(await painted(page.locator('.bg-white').first())).not.toBe('rgb(255, 255, 255)');
});

test('a category mark is a wash of what it sits on, so at night it is not a light circle', async ({ page }) => {
  await addBank(page, 'BCA Tahapan', '5000000');
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '150000' });
  await page.goto('/transactions');

  const mark = page.getByTestId('category-mark').first();
  await expect(mark).toBeVisible();
  /*
   * The mark mixes the category's own colour into `transparent`, so the surface behind it comes through — the same
   * reading of a tinted icon the kit's rows use. It used to mix into **white**, which is an opaque pale disc: on a
   * black page, the one light thing left on the screen. The sweep above could not catch it, because the disc was
   * never one of the greys it looks for. What is asserted here is the wash itself, read off the element.
   */
  const wash = await mark.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(wash).not.toContain('255, 255, 255');
  expect(wash).toMatch(/0\.15\)$/);
});

test.describe('the same shell in the light', () => {
  test.use({ colorScheme: 'light' });

  test('is the palette the light block defines, still read from the tokens', async ({ page }) => {
    // A row first, for the same reason as the sweep above: the card the `bg-white` read asks for is a row's.
    await addBank(page, 'BCA Tahapan', '5000000');
    await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '150000' });
    await page.goto('/transactions');
    const bar = tabBar(page);
    await expect(bar).toBeVisible();

    expect(await tokenColour(page, '--ph-ground')).toBe('rgb(242, 242, 247)');
    expect(await tokenColour(page, '--ph-chrome')).toBe('rgba(255, 255, 255, 0.8)');
    expect(await painted(bar)).toBe(await tokenColour(page, '--ph-chrome'));
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(await tokenColour(page, '--ph-ground'));

    // The same name the dark remaps is a real light surface here, which is what makes the sweep above mean
    // something: it is looking for a *light* value, and in this mode finding one is correct.
    expect(await painted(page.locator('.bg-white').first())).toBe('rgb(255, 255, 255)');
  });
});
