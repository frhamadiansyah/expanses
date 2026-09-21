import { expect, type Page, test } from '@playwright/test';

test('the three card screens draw at 390px without scrolling sideways', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));

  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA KrisFlyer Visa Signature');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA KrisFlyer Visa Signature', exact: true })).toBeVisible();

  await page.goto('/cards');
  const card = page.getByRole('link', { name: 'BCA KrisFlyer Visa Signature', exact: true });
  await expect(card).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(wide).toBe(false);

  await card.click();
  const title = page.getByRole('heading', { name: 'BCA KrisFlyer Visa Signature' });
  await expect(title).toBeVisible();
  // A name someone typed is read whole or not at all: one line, never broken over two at a phone's width.
  expect((await title.boundingBox())!.height).toBeLessThanOrEqual(36);
  await expect(page.getByRole('radiogroup', { name: 'Card sections' }).getByRole('radio')).toHaveCount(4);
  // "Rules" is what fits at 390; "Rewards rules" is still what a screen reader hears.
  await expect(page.getByRole('radio', { name: 'Rewards rules', exact: true })).toHaveText('Rules');
  const wideCard = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(wideCard).toBe(false);

  await page.goto('/cards/merchants');
  await expect(page.getByRole('heading', { name: 'Merchants & MCCs' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  const wideMerchants = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(wideMerchants).toBe(false);

  expect(crashes).toEqual([]);
});

/** A credit card with a billing date, a points program and a rule, so its band has a figure to carry. */
async function addEarningCard(page: Page, name: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.goto('/cards');
  await page.getByRole('region', { name: 'Your cards' }).getByRole('link', { name: new RegExp(`^${name}(,|$)`) }).click();
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await page.getByRole('button', { name: 'Set up rewards' }).click();
  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  // The suggested base rule, so the card is set up and opens on Wallet's summary from now on.
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByText('Step 3 of 3')).toHaveCount(0);
}

const closeCard = (page: Page) => page.locator('header').getByRole('button', { name: 'Close', exact: true });
const NAMES = ['Alpha Card', 'Beta Card', 'Gamma Card'];

/**
 * The wall is Apple Wallet's stack, back to front: every card is a whole card at one width, each laid over the one
 * before it, so a covered card shows its own top band — its print and its points — and the front card comes last,
 * whole.
 */
test('the stack overlaps real cards of one width, each band carrying its own points', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));
  for (const name of NAMES) await addEarningCard(page, name);

  await page.goto('/cards');
  const wall = page.getByRole('region', { name: 'Your cards' });
  const cards = wall.getByTestId('wallet-card');
  await expect(cards).toHaveCount(3);
  const boxes = await Promise.all([0, 1, 2].map(async (at) => (await cards.nth(at).boundingBox())!));
  const viewport = page.viewportSize()!;

  // One width for every card: the phone's column inside the 16 px gutter, on a card's own shape.
  for (const box of boxes) {
    expect(Math.round(box.width)).toBe(viewport.width - 32);
    expect(Math.round((box.width / box.height) * 10)).toBe(16);
  }
  // Real overlap: each card starts inside the one before it, a band lower, and lies over it.
  for (let at = 1; at < boxes.length; at += 1) {
    expect(boxes[at]!.y).toBeLessThan(boxes[at - 1]!.y + boxes[at - 1]!.height);
    expect(Math.round(boxes[at]!.y - boxes[at - 1]!.y)).toBeGreaterThanOrEqual(56);
    expect(Math.round(boxes[at]!.y - boxes[at - 1]!.y)).toBeLessThanOrEqual(64);
  }
  // The front card is the last one, whole; the others are bands.
  await expect(cards.nth(2)).toHaveAttribute('data-front', '');

  // Each covered band prints the card's own name and its points, without a tap.
  const bands = wall.getByTestId('card-band');
  await expect(bands).toHaveCount(2);
  for (const at of [0, 1]) {
    const band = cards.nth(at).getByTestId('card-band');
    await expect(band).toContainText(NAMES[at]!);
    await expect(band).toContainText(/\d+ points/);
    await expect(band).toBeInViewport();
  }
  // Every card is one link named by the card and its figure.
  for (const name of NAMES) await expect(wall.getByRole('link', { name: new RegExp(`^${name}, \\d+ points$`) })).toHaveCount(1);

  // The front card's facts are one grouped row under the stack.
  await expect(wall.getByTestId('wallet-facts')).toContainText('Gamma Card');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  expect(crashes).toEqual([]);
});

/**
 * Opening a card is Wallet's selected state: the card's own element rises to the top at the width it had in the
 * stack, the others hide, and its page follows below it, laid out as Wallet lays out a pass. ✕, Escape and Back put
 * it back.
 */
test('a tapped card rises to the top at its own width and opens its page; ✕ and Escape put it back', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));
  for (const name of NAMES) await addEarningCard(page, name);

  await page.goto('/cards');
  const wall = page.getByRole('region', { name: 'Your cards' });
  const order = async () => wall.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')));
  await expect(wall.getByRole('link')).toHaveCount(3);
  const before = await order();
  expect(before).toEqual(['Alpha Card, 0 points', 'Beta Card, 0 points', 'Gamma Card, 0 points']);
  const covered = wall.getByTestId('wallet-card').first();
  const inStack = (await covered.boundingBox())!;

  // Tap the rearmost card, the one showing only its band: THAT card's page opens.
  await wall.getByRole('link', { name: /^Alpha Card, / }).click();
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Alpha Card', exact: true })).toBeFocused();
  await expect(page.getByTestId('tile-points')).toBeVisible();
  const raised = wall.locator('[data-place="raised"]');
  await expect(raised).toHaveCount(1);
  await expect(raised.getByRole('button', { name: 'Alpha Card', exact: true })).toBeVisible();
  // No title drawn and no back link: the card is the header, with ✕ on the left and ⋯ on the right.
  await expect(page.getByRole('link', { name: 'Cards', exact: true }).filter({ hasText: '‹' })).toHaveCount(0);
  const bar = page.locator('header').filter({ has: page.getByRole('heading', { name: 'Alpha Card', exact: true }) });
  const [closeBox, moreBox] = [(await bar.getByRole('button', { name: 'Close', exact: true }).boundingBox())!, (await bar.getByRole('button', { name: 'More' }).boundingBox())!];
  expect(closeBox.x).toBeLessThan(moreBox.x);
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  // The same element, at the same width and the same edges, as in the stack.
  await expect.poll(async () => (await raised.boundingBox())!.y).toBeLessThanOrEqual(inStack.y + 1);
  const top = (await raised.boundingBox())!;
  expect(Math.abs(top.width - inStack.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(top.x - inStack.x)).toBeLessThanOrEqual(1);
  // The others are gone: out of sight and out of reach, by pointer, keyboard or screen reader.
  const hidden = wall.locator('[data-place="hidden"]');
  await expect(hidden).toHaveCount(2);
  for (const at of [0, 1]) await expect(hidden.nth(at)).not.toBeInViewport();
  await expect(wall.getByRole('link')).toHaveCount(0);
  await expect(page.getByText('Beta Card, 0 points')).toHaveCount(0);

  // Wallet's summary under the card: what is unpaid with Pay, the points with Use, and the latest transactions.
  const unpaid = page.getByTestId('tile-left-to-pay');
  await expect(unpaid).toContainText('Unpaid');
  await expect(unpaid.getByRole('button', { name: 'Pay', exact: true })).toBeVisible();
  const points = page.getByTestId('tile-points');
  await expect(points).toContainText('Points');
  await expect(points.getByRole('button', { name: 'Use', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Latest transactions' })).toBeVisible();
  await expect(page.getByTestId('latest-transactions').getByRole('button', { name: 'See all' })).toBeVisible();

  // ⋯ holds what the tabs held: each section opens as its own screen under the card, and ‹ comes back.
  for (const [item, radio] of [
    ['Statement', 'Activity'],
    ['Points', 'Points'],
    ['Rewards rules', 'Rewards rules'],
    ['Card details', 'Card'],
  ] as const) {
    await bar.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: item }).click();
    await expect(page.getByRole('radio', { name: radio, exact: true })).toBeChecked();
    await expect(wall.locator('[data-place="raised"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Back to Alpha Card' }).click();
    await expect(page.getByTestId('tile-points')).toBeVisible();
  }

  // ✕ returns to the stack, in the order it had.
  const url = page.url();
  await closeCard(page).click();
  await expect(page).toHaveURL(/\/cards$/);
  await expect(wall.locator('[data-place="raised"]')).toHaveCount(0);
  expect(await order()).toEqual(before);

  // Escape closes it too.
  await wall.getByRole('link', { name: /^Beta Card, / }).click();
  await expect(page.getByRole('heading', { name: 'Beta Card', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/cards$/);
  expect(await order()).toEqual(before);

  // A deep link opens straight into the raised card, and ✕ still lands on the stack.
  await page.goto(url);
  await expect(wall.locator('[data-place="raised"]').getByRole('button', { name: 'Alpha Card', exact: true })).toBeVisible();
  await expect(wall.locator('[data-place="hidden"]')).toHaveCount(2);
  await closeCard(page).click();
  await expect(page).toHaveURL(/\/cards$/);
  expect(await order()).toEqual(before);

  expect(crashes).toEqual([]);
});

/**
 * A card is printed, not themed: the ink on its art and on its band stays the colour it was printed in when the
 * reader is dark. The face reads its ink from the two print tokens, which the dark block never redefines.
 */
test.describe('in the dark', () => {
  test.use({ colorScheme: 'dark' });

  test('the print on a card and on its band keeps its own colour', async ({ page }) => {
    for (const name of ['Alpha Card', 'Beta Card']) await addEarningCard(page, name);

    await page.goto('/cards');
    const wall = page.getByRole('region', { name: 'Your cards' });
    // A card with no catalogue design is a dark bank colour, so it prints in white — in the dark as in the light.
    const front = wall.getByRole('img');
    await expect(front).toBeVisible();
    expect(await front.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(255, 255, 255)');
    const band = wall.getByTestId('card-band');
    await expect(band).toContainText(/\d+ points/);
    expect(await band.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(255, 255, 255)');
  });
});
