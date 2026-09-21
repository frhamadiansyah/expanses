import { expect, type Locator, test } from '@playwright/test';

/**
 * The specimen sheet at 390 px — the width the whole restyle is measured at.
 *
 * These assert the three things the audit says the app gets wrong today: a section title inside a ringed card
 * rather than outside a flat group, a separator running the full width of its container, and a tab row that
 * wraps.
 */

/** Anything a finger is meant to hit must be at least this tall. */
const TAP = 44;

test('a group header sits outside and above its group, not inside a card', async ({ page }) => {
  await page.goto('/design-kit');
  const heading = page.getByRole('heading', { name: 'Friday 18 September' });
  await expect(heading).toBeVisible();
  const group = page.locator('section', { has: heading }).first();
  // A group's children are its header block and then its flat white surface; the header is above, not inside.
  const surface = group.locator('> div').last();
  const headingBox = (await heading.boundingBox())!;
  const surfaceBox = (await surface.boundingBox())!;
  expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(surfaceBox.y + 1);
});

test('separators are inset to the text, not run full-bleed across the group', async ({ page }) => {
  await page.goto('/design-kit');
  const group = page.locator('section', { has: page.getByRole('heading', { name: 'Friday 18 September' }) }).first();
  const surface = group.locator('> div').last();
  const rows = surface.getByRole('button');
  await expect(rows).toHaveCount(4);

  const surfaceBox = (await surface.boundingBox())!;
  // Every row but the first draws a hairline; each starts where its row's text starts, past the 28px icon.
  const insets = await surface.evaluate((node) =>
    [...node.querySelectorAll<HTMLElement>('span[aria-hidden]')]
      .filter((span) => Math.round(span.getBoundingClientRect().height) <= 1 && span.getBoundingClientRect().width > 0)
      .map((span) => span.getBoundingClientRect().left),
  );
  expect(insets).toHaveLength(3);
  for (const left of insets) expect(left - surfaceBox.x).toBeGreaterThan(40);
});

test('every row clears the tap target, and the row itself is the target — no button inside it', async ({ page }) => {
  await page.goto('/design-kit');
  const group = page.locator('section', { has: page.getByRole('heading', { name: 'Friday 18 September' }) }).first();
  const rows = group.getByRole('button');
  for (const row of await rows.all()) {
    const box = (await row.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(TAP);
    // One tap target, not two: a row holds no button of its own.
    expect(await row.getByRole('button').count()).toBe(0);
  }

  // The row with the least in it is the one the floor is for: a single line of text is 42px on its own.
  const destructive = page.getByRole('button', { name: 'Delete this transaction' });
  expect((await destructive.boundingBox())!.height).toBeGreaterThanOrEqual(TAP);
});

test('five tabs do not wrap at phone width — the fifth moves behind a …', async ({ page }) => {
  await page.goto('/design-kit');
  const group = page.getByRole('radiogroup', { name: 'Net worth sections' });
  await expect(group.getByRole('radio')).toHaveCount(4);
  await expect(group.getByRole('radio', { name: 'Loans' })).toHaveCount(0);

  const more = page.getByRole('button', { name: 'More Net worth sections' });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole('menu', { name: 'More Net worth sections' }).getByRole('menuitem', { name: 'Loans' })).toBeVisible();
});

test('the wallet stack shows every card’s figure without a tap', async ({ page }) => {
  await page.goto('/design-kit');
  await expect(page.getByText('42.500 miles')).toBeVisible();
  await expect(page.getByText('18.240 points')).toBeVisible();
  await expect(page.getByText(/Rp\s8\.412\.000/)).toBeVisible();
});

test('a table becomes rows on a phone, and the hidden columns are not on screen', async ({ page }) => {
  await page.goto('/design-kit');
  const group = page.locator('section', { has: page.getByRole('heading', { name: 'This week' }) }).first();
  await expect(group.getByRole('table')).toHaveCount(0);
  await expect(group.getByRole('button', { name: /Superindo/ })).toBeVisible();
  // The phone row keeps the title and the one figure; the other columns wait behind the chevron.
  await expect(group.getByText('SPBU 34-12907 Pondok Indah')).toHaveCount(0);
  await expect(group.getByText('Paid with')).toHaveCount(0);
});

/**
 * The other half of the rule, and the one a restyle loses columns by forgetting: behind the chevron is only a
 * place when there is a chevron. A table whose rows open nothing keeps every column at 390 px and scrolls in
 * its own container — so this fails the moment a column stops being drawn on a phone.
 */
test('a table with nothing to open keeps every column at phone width, and scrolls sideways for them', async ({ page }) => {
  await page.goto('/design-kit');
  const group = page.locator('section', { has: page.getByRole('heading', { name: 'Nothing to open' }) }).first();
  const table = group.getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveCount(6);
  for (const heading of ['Date', 'Merchant', 'What it was', 'Paid with', 'Points', 'Amount']) {
    await expect(table.getByRole('columnheader', { name: heading })).toBeVisible();
  }
  await expect(table.getByRole('cell', { name: 'SPBU 34-12907 Pondok Indah' })).toBeAttached();

  // The table scrolls inside its own box; the page body does not scroll sideways for it.
  const scroller = group.locator('div').first();
  const overflow = await scroller.evaluate((node) => ({
    wider: node.scrollWidth > node.clientWidth,
    body: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  }));
  expect(overflow.wider).toBe(true);
  expect(overflow.body).toBe(true);
});

test('the hero states how far through its budget it is, for a screen reader as well as an eye', async ({ page }) => {
  await page.goto('/design-kit');
  const bar = page.getByRole('progressbar', { name: 'Eating out against its budget' });
  await expect(bar).toHaveAttribute('aria-valuenow', '89');
});

/**
 * The box a thumb actually hits: the drawn box, grown by whatever `ph-tap` reaches past it.
 *
 * Measured from `boundingBox` plus the pseudo-element's used offsets, and then hit-tested at the edge of the
 * result — a reach that exists in the stylesheet but is covered, or drawn with no pointer events, would pass the
 * arithmetic and fail the probe. Both are asserted, because only the probe is the thumb's own answer.
 */
async function hitBox(target: Locator): Promise<{ width: number; height: number; reachable: boolean }> {
  const box = (await target.boundingBox())!;
  const reach = await target.evaluate((node) => {
    const after = getComputedStyle(node, '::after');
    if (after.content === 'none') return null;
    const px = (value: string) => (Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : 0);
    return { top: px(after.top), bottom: px(after.bottom), left: px(after.left), right: px(after.right) };
  });
  if (!reach) return { width: box.width, height: box.height, reachable: true };
  const reachable = await target.evaluate(
    (node, at) => {
      const found = document.elementFromPoint(at.x, at.y);
      return found === node || node.contains(found);
    },
    // Half a pixel inside the top edge of the grown box, above everything the control itself draws.
    { x: box.x + box.width / 2, y: box.y + reach.top + 0.5 },
  );
  return { width: box.width - reach.left - reach.right, height: box.height - reach.top - reach.bottom, reachable };
}

test('a segment stays the height iOS draws, and is a tap target anyway', async ({ page }) => {
  await page.goto('/design-kit');
  const segments = page.getByRole('radiogroup', { name: 'Card sections' }).getByRole('radio');
  await expect(segments).toHaveCount(4);
  for (const segment of await segments.all()) {
    // Not solved by making the control 44 tall: iOS ships this control at about 32, and so does the kit.
    expect((await segment.boundingBox())!.height).toBeLessThan(TAP);
    const hit = await hitBox(segment);
    expect(hit.height).toBeGreaterThanOrEqual(TAP);
    expect(hit.reachable).toBe(true);
  }
});

test('the … beside the track is a tap target in both directions, at 32 square drawn', async ({ page }) => {
  await page.goto('/design-kit');
  const more = page.getByRole('button', { name: 'More Net worth sections' });
  const drawn = (await more.boundingBox())!;
  expect(drawn.width).toBeLessThan(TAP);
  expect(drawn.height).toBeLessThan(TAP);
  const hit = await hitBox(more);
  expect(hit.width).toBeGreaterThanOrEqual(TAP);
  expect(hit.height).toBeGreaterThanOrEqual(TAP);
  expect(hit.reachable).toBe(true);
});
