import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { todayIn } from './today';

/*
 * Holding ＋ on Cashflow does what Settings › Default chose; One line is the default. The page stays; the field docks
 * at the foot (a browser has no on-screen keyboard), the tab bar stands aside, and in the Card look the line is drawn
 * as the row it will be saved as, in a card over the keyboard (the Plain look is the bare field). Return saves it into
 * the list. Held anywhere else, ＋ is a tap: the full form.
 * Invented names and figures.
 */
test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const plus = (page: Page) => page.getByRole('button', { name: 'Add a transaction' });
const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const field = (page: Page) => page.getByLabel('One line', { exact: true });
const ghost = (page: Page) => page.getByTestId('line-ghost');
const preview = (page: Page) => page.getByTestId('line-preview');
/** A press held past the hold and let go: down, a wait, up — and the click the release sends, as a finger's does. */
async function hold(page: Page, expecting?: 'form' | 'line' | 'scan' | 'paste' | 'menu') {
  // The choice is read from the database as the app opens; the hold is only meaningful once it has been.
  if (expecting) await expect(plus(page)).toHaveAttribute('data-hold', expecting);
  const box = (await plus(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
}

async function chooseHold(page: Page, choice: 'One line' | 'Scan a receipt' | 'Paste a list' | 'Show the menu' | 'Off') {
  await page.goto('/settings/default');
  await expect(page.getByText('Hold ＋ on Cashflow')).toBeVisible();
  await page.getByRole('button', { name: choice, exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test('on Cashflow, holding ＋ opens One line over the list; Return saves the row into it', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Nusa', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'warung sate', paidWith: 'Bank Nusa', category: 'Restaurants', amount: '10000' });
  await page.goto('/transactions');
  await expect(tabBar(page)).toBeVisible();

  await test.step('the hold opens the field, focused, with the tab bar gone and Cashflow still on screen', async () => {
    await hold(page, 'line');
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('placeholder', 'Shop, amount, how it was paid');
    await expect(field(page)).toHaveAttribute('enterkeyhint', 'done');
    await expect(tabBar(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('hold-1-open.png') });
  });

  await test.step('typing draws the line as a row in the card above the field, the page behind dimmed', async () => {
    await field(page).fill('warung sate 45rb nusa');
    await expect(ghost(page)).toBeVisible();
    await expect(page.getByTestId('line-dim')).toBeVisible();
    await expect(preview(page)).toContainText('Restaurants');
    await expect(preview(page)).toContainText('Warung Sate');
    await expect(preview(page)).toContainText('45.000');
    // No dashed row in the list, and no strip of suggested names.
    await expect(page.getByTestId('line-slot')).toHaveCount(0);
    await expect(page.getByRole('listbox', { name: 'Suggested notes' })).toHaveCount(0);
    const cardBox = (await page.getByTestId('line-composer').boundingBox())!;
    const fieldBox = (await field(page).boundingBox())!;
    expect(fieldBox.y).toBeGreaterThan(cardBox.y);
    await page.screenshot({ path: test.info().outputPath('hold-2-typing.png') });
  });

  await test.step('a missing part is amber; a part opens its picker, and the field stays open behind it', async () => {
    // Emptied first: a pick (the suggestion's paid-with) lasts only while the line it was made on does.
    await field(page).fill('');
    await field(page).fill('parkir 10rb');
    const paid = preview(page).getByRole('button', { name: 'Paid with', exact: true });
    await expect(paid).toHaveAttribute('data-missing', 'true');
    await expect(paid).toHaveText('Paid with?');
    await field(page).fill('parkir 10rb nusa');
    await preview(page).getByRole('button', { name: 'Category', exact: true }).click();
    await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Parking & tolls', exact: true }).click();
    await expect(preview(page).getByRole('button', { name: 'Category', exact: true })).toHaveText('Parking & tolls');
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue('parkir 10rb nusa');
  });

  await test.step('Return saves: the row is in the list, the field empties and stays', async () => {
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('placeholder', 'Next one');
    await expect(ghost(page)).toHaveCount(0);
    const saved = page.getByTestId('transaction-row').filter({ hasText: 'Parkir' });
    await expect(saved).toHaveCount(1);
    await expect(saved).toContainText('Parking & tolls');
    await page.screenshot({ path: test.info().outputPath('hold-3-saved.png') });
  });

  await test.step('the next line keeps the paid-with, and saves on top', async () => {
    await field(page).fill('kopi 20rb');
    await expect(preview(page).getByRole('button', { name: 'Paid with', exact: true })).toHaveText('Bank Nusa?');
    await page.screenshot({ path: test.info().outputPath('hold-4-next.png') });
    await field(page).press('Enter');
    await expect(page.getByTestId('transaction-row').filter({ hasText: 'Kopi' })).toHaveCount(1);
    await expect(page.getByTestId('transaction-row').first()).toContainText('Kopi');
  });

  await test.step('two quick Returns save one row', async () => {
    await field(page).fill('teh 5rb nusa');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(field(page)).toHaveValue('');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('transaction-row').filter({ hasText: 'Teh' })).toHaveCount(1);
  });

  await test.step('a tap outside puts it away and the tab bar comes back', async () => {
    // The dim over the page is the tap outside.
    await page.getByTestId('line-dim').click({ position: { x: 200, y: 120 } });
    await expect(field(page)).toHaveCount(0);
    await expect(tabBar(page)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('hold-5-closed.png') });
  });

  await test.step('a plain tap on ＋ is still the full form', async () => {
    await plus(page).click();
    await expect(page).toHaveURL(/\/transactions\/new$/);
  });
});

test('a line for another day is read as that day and lands in its own group', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Nusa', balance: '5000000' });
  await page.goto('/transactions');
  const yesterday = await todayIn(page, 1);
  // Yesterday in another month: the list shows this month only, so there is nowhere for it to land on screen.
  test.skip(yesterday.slice(0, 7) !== (await todayIn(page)).slice(0, 7), 'yesterday is last month');
  await hold(page, 'line');
  await field(page).fill('kemarin roti 15rb nusa');
  await expect(preview(page).getByRole('button', { name: 'Day', exact: true })).toHaveText('Yesterday');
  await field(page).press('Enter');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Roti' })).toHaveCount(1);
});

async function chooseLook(page: Page, look: 'Card' | 'Plain') {
  await page.goto('/settings/default');
  await expect(page.getByText('One line look')).toBeVisible();
  await page.getByRole('button', { name: look, exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}

const send = (page: Page) => page.getByRole('button', { name: 'Save line', exact: true });
const arrowColour = (page: Page) => send(page).evaluate((el) => getComputedStyle(el).backgroundColor);

test('Card look: a blocked blue key saves nothing and shakes the missing part; the arrow is grey until the line can save', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Nusa', balance: '5000000' });
  await page.goto('/transactions');
  await hold(page, 'line');
  await expect(send(page)).toBeDisabled();

  await test.step('nothing pays: the arrow is grey and inert, and the blue key saves nothing', async () => {
    await field(page).fill('kopi kenangan 38rb');
    await expect(preview(page).getByRole('button', { name: 'Paid with', exact: true })).toHaveAttribute('data-missing', 'true');
    await expect(send(page)).toBeDisabled();
    await expect(send(page)).toHaveAttribute('data-blocked', 'true');
    const grey = await arrowColour(page);
    await field(page).press('Enter');
    await expect(page.getByTestId('line-composer')).toHaveClass(/line-shake/);
    await expect(preview(page).getByRole('button', { name: 'Paid with', exact: true })).toBeVisible();
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveValue('kopi kenangan 38rb');
    await expect(page.getByTestId('transaction-row').filter({ hasText: 'Kopi Kenangan' })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('card-blocked.png') });
    // Naming what pays turns the arrow black and live.
    await field(page).fill('kopi kenangan 38rb nusa');
    await expect(send(page)).toBeEnabled();
    expect(await arrowColour(page)).not.toBe(grey);
  });

  await test.step('the arrow saves; the card empties and stays', async () => {
    await send(page).click();
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
    await expect(page.getByTestId('transaction-row').filter({ hasText: 'Kopi Kenangan' })).toHaveCount(1);
    await expect(ghost(page)).toHaveCount(0);
    await expect(send(page)).toBeDisabled();
  });
});

test('Plain look: a bare bar; a blocked blue key shows the amber hint, shakes it and saves nothing', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Nusa', balance: '5000000' });
  await chooseLook(page, 'Plain');
  await page.goto('/transactions');
  await hold(page, 'line');

  await test.step('no preview, no dim; typing a line nothing pays shows nothing until a save is asked for', async () => {
    await field(page).fill('kopi kenangan 38rb');
    await expect(page.getByTestId('line-composer')).toHaveAttribute('data-look', 'plain');
    await expect(ghost(page)).toHaveCount(0);
    await expect(page.getByTestId('line-dim')).toHaveCount(0);
    await expect(page.getByTestId('line-lacking')).toHaveCount(0);
    await expect(send(page)).toBeDisabled();
    await expect(send(page)).toHaveAttribute('data-blocked', 'true');
  });

  await test.step('the blue key: nothing saved, focus kept, the amber hint names what is missing and shakes', async () => {
    await field(page).press('Enter');
    await expect(page.getByTestId('line-lacking')).toHaveText('Paid with?');
    await expect(page.getByTestId('line-lacking')).toHaveClass(/line-shake-self/);
    await expect(field(page)).toBeFocused();
    await expect(page.getByTestId('transaction-row').filter({ hasText: 'Kopi Kenangan' })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('plain-blocked.png') });
  });

  await test.step('changing the line clears the hint, and the line then saves', async () => {
    await field(page).fill('kopi kenangan 38rb nusa');
    await expect(page.getByTestId('line-lacking')).toHaveCount(0);
    await expect(send(page)).toBeEnabled();
    await send(page).click();
    await expect(field(page)).toHaveValue('');
    await expect(page.getByTestId('transaction-row').filter({ hasText: 'Kopi Kenangan' })).toHaveCount(1);
  });

  await test.step('an amount missing is named too', async () => {
    await field(page).fill('parkir nusa');
    await field(page).press('Enter');
    await expect(page.getByTestId('line-lacking')).toHaveText('Amount?');
  });
});

test('held on Net worth, ＋ opens the full form', async ({ page }) => {
  await page.goto('/net-worth');
  await expect(tabBar(page)).toBeVisible();
  await hold(page, 'form');
  await expect(page).toHaveURL(/\/transactions\/new$/);
  await expect(page.getByRole('dialog', { name: 'Add' })).toHaveCount(0);
});

test('Settings › Default chooses what the hold does: the menu, or a plain tap with Off', async ({ page }) => {
  await test.step('Show the menu', async () => {
    await chooseHold(page, 'Show the menu');
    await page.goto('/transactions');
    await hold(page, 'menu');
    await expect(page.getByRole('dialog', { name: 'Add' })).toBeVisible();
    await expect(field(page)).toHaveCount(0);
  });

  await test.step('Paste a list', async () => {
    await chooseHold(page, 'Paste a list');
    await page.goto('/transactions');
    await hold(page, 'paste');
    await expect(page).toHaveURL(/\/transactions\/paste$/);
  });

  await test.step('Off', async () => {
    await chooseHold(page, 'Off');
    await page.goto('/transactions');
    // The release's click is the tap.
    await hold(page, 'form');
    await expect(page).toHaveURL(/\/transactions\/new$/);
    await expect(page.getByRole('dialog', { name: 'Add' })).toHaveCount(0);
  });

  await test.step('the page shows the choice that is saved', async () => {
    await page.goto('/settings/default');
    const off = page.getByRole('button', { name: 'Off', exact: true });
    await expect(off.getByTestId('hold-ticked')).toHaveCount(1);
    await expect(page.getByText('Only on the Cashflow page. Everywhere else, holding ＋ opens the full form, the same as a tap.')).toBeVisible();
    // One line look is Card until Plain is chosen.
    await expect(page.getByRole('button', { name: 'Card', exact: true }).getByTestId('look-ticked')).toHaveCount(1);
  });
});
