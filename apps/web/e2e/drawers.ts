import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Every drawer on a page, opened.
 *
 * The Assets list, the Debts list and the two columns of the balance sheet fold their rows by what each one is — a
 * kind of account, a kind of loan, a catalogue item — so a spec that reads a row has to open the drawer it sits in
 * first. That is the reader's own tap, made once for the whole page: the drawer's testid carries the key it is folded
 * by (`type-drawer-<group>:<kind>`), which is the only handle a spec needs.
 *
 * The first drawer is waited for, because these pages are reached by a navigation or by the save before them, and
 * counting the drawers before the screen is on screen would count nothing and leave every row folded.
 *
 * The whole pass is retried, because a list that is still settling — the save that just landed, the query that just
 * refetched — mounts its rows again, and a remount hands the drawers back shut. Opening them once would lose that race
 * silently, with a row hidden behind a drawer that the spec believed was open; the pass runs until the page itself
 * agrees that nothing is folded.
 */
export async function openDrawers(page: Page): Promise<void> {
  const drawers = page.locator('[data-testid^="type-drawer-"]');
  await expect(drawers.first()).toBeVisible();
  await expect(async () => {
    for (let index = 0; index < (await drawers.count()); index += 1) await open(drawers.nth(index));
    expect(await folded(drawers)).toBe(0);
  }).toPass({ timeout: 10_000 });
}

/**
 * The Assets list, with its drawers open — the page a spec reaches for when it came to read a row.
 *
 * Every row on that list is folded into its kind's drawer, so going there and reading a name in one step is the whole
 * of what most specs want; the two are one function so that no call site can forget the second half.
 */
export async function openAssets(page: Page): Promise<void> {
  await page.goto('/net-worth/assets');
  await openDrawers(page);
}

/**
 * The one drawer whose words match, opened — and the row inside it, which is what the caller came for.
 *
 * For the specs that are about one kind of thing rather than the whole page: "open Listed shares" reads as the tap a
 * person makes, and leaves the rest of the page folded so an assertion cannot pass on a row that belongs elsewhere.
 */
export async function openDrawer(page: Page, label: string | RegExp): Promise<void> {
  const drawer = page.locator('[data-testid^="type-drawer-"]').filter({ hasText: label }).first();
  await expect(drawer).toBeVisible();
  await expect(async () => {
    await open(drawer);
    expect(await drawer.getAttribute('aria-expanded')).toBe('true');
  }).toPass({ timeout: 10_000 });
}

/** One drawer opened, if it is not open already. */
async function open(drawer: Locator): Promise<void> {
  if ((await drawer.getAttribute('aria-expanded')) === 'false') await drawer.click();
}

/** How many of these drawers are still shut. */
async function folded(drawers: Locator): Promise<number> {
  let shut = 0;
  for (let index = 0; index < (await drawers.count()); index += 1) {
    if ((await drawers.nth(index).getAttribute('aria-expanded')) === 'false') shut += 1;
  }
  return shut;
}
