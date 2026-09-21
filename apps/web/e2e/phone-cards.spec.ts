import { expect, test } from '@playwright/test';

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
  await expect(page.getByRole('heading', { name: 'BCA KrisFlyer Visa Signature' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Card sections' }).getByRole('radio')).toHaveCount(4);
  await expect(page.getByRole('radio', { name: 'Rules' })).toBeVisible();
  const wideCard = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(wideCard).toBe(false);

  await page.goto('/cards/merchants');
  await expect(page.getByRole('heading', { name: 'Merchants & MCCs' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  const wideMerchants = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(wideMerchants).toBe(false);

  expect(crashes).toEqual([]);
});

/**
 * The wall is the Wallet stack, and the band a neighbour leaves showing carries one card's lines and no others.
 *
 * The stack clips a covered card to its 58 px strip and draws that strip's name and figure in the band. The face
 * under it is handed to `CardFace` as `behind`, so it prints its colour, finish and motif and none of its own
 * rows — the bank mark, the wordmark, the digits — which otherwise land in the same pixels as the strip's two
 * lines. Two texts in one band is the one thing a Wallet stack never looks like, and every covered band on
 * `/cards` was exactly that.
 */
test('a covered card prints only its strip, so no two lines of text share a band', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));

  // Two cards, because a band only exists where one card covers another.
  for (const name of ['BCA KrisFlyer Visa Signature', 'Mandiri Marriott Bonvoy']) {
    await page.goto('/accounts');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Type').selectOption('credit_card');
    await page.getByRole('button', { name: 'Add account' }).click();
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  }

  await page.goto('/cards');
  const wall = page.getByRole('region', { name: 'Your cards' });
  await expect(wall.getByTestId('card-face')).toHaveCount(2);

  const faces = await wall.getByTestId('card-face').evaluateAll((nodes) =>
    nodes.map((node) => ({
      behind: node.getAttribute('aria-hidden') === 'true',
      role: node.getAttribute('role'),
      text: (node.textContent ?? '').trim(),
    })),
  );

  // One card is whole and in front; every other card in the wall is clipped to its strip.
  expect(faces.filter((face) => face.role === 'img')).toHaveLength(1);
  expect(faces.filter((face) => face.behind)).toHaveLength(faces.length - 1);
  // Behind is colour alone: nothing of a covered face is printed, so no half-hidden text can sit under the strip
  // that draws its own two lines in that same band.
  for (const face of faces.filter((face) => face.behind)) expect(face.text).toBe('');
  // The card in front is whole, so its face still prints for itself.
  expect(faces.find((face) => face.role === 'img')!.text).toContain('••••');

  // And the band still answers for the card it belongs to: its strip is the only text in that edge.
  const band = wall.getByRole('button');
  await expect(band).toHaveCount(1);
  await expect(band).toContainText(/KrisFlyer Visa Signature|Marriott Bonvoy/);

  expect(crashes).toEqual([]);
});
