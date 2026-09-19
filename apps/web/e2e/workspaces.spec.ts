import { expect, type Page, test } from '@playwright/test';

/**
 * An account is yours, not a workspace's, so its history holds every workspace and each row says which one it
 * belongs to — unless there is only one workspace, when the badge would say the same word on every row.
 */
test('an account’s history opens from Accounts, and badges nothing while there is one workspace', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill('Supplier dinner');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Restaurants' });
  await page.getByLabel('Amount', { exact: true }).fill('640000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Supplier dinner')).toBeVisible();

  await page.goto('/accounts');
  await page.getByRole('link', { name: 'BCA Tahapan', exact: true }).click();
  await expect(page.locator('li', { hasText: 'Supplier dinner' }).first()).toContainText('640.000');
  // One workspace, so no row names it: a badge every row carried would say nothing at all.
  await expect(page.getByTestId('workspace-badge')).toHaveCount(0);
});

/**
 * A wide screen keeps the switcher in the sidebar, where it is on every screen — the phone reaches it only from
 * Cashflow's ⋯, so the desktop is the stronger of the two, which is the rule.
 */
test('the sidebar names the open workspace and opens the switcher', async ({ page }) => {
  await page.goto('/');
  const switcher = page.getByRole('button', { name: 'Workspace', exact: true });
  await expect(switcher).toContainText('Personal');
  await expect(switcher).toContainText('IDR');
  await switcher.click();
  const sheet = page.getByRole('dialog', { name: 'Workspaces' });
  await expect(sheet).toBeVisible();
  // One workspace, and it is the open one: a tick beside it, and nothing else to choose.
  const rows = sheet.getByTestId('workspace-choice');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Personal');
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await expect(rows.first().getByLabel('Open')).toBeVisible();
  // It is reachable from a screen that is not Cashflow, which is the point of it living in the sidebar.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.goto('/accounts');
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toBeVisible();
});

/** A bank account to pay from, since every flow below needs somewhere for the money to come out of. */
async function addBank(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

async function spend(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Restaurants' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(description)).toBeVisible();
}

/** Makes a workspace through the sidebar switcher and lands in it, as the sheet does on its own. */
async function newWorkspace(page: Page, name: string, startsWith: string) {
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New workspace' }).click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByLabel('Starts with').selectOption({ label: startsWith });
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText(name);
}

/**
 * A workspace made from another's categories starts with the tree and none of the spending: the two share a shape,
 * never a figure. Switching back finds the spending exactly where it was left.
 */
test('a new workspace copies the categories, opens empty, and leaves the other alone', async ({ page }) => {
  await addBank(page);
  await spend(page, 'Supplier dinner', '640000');

  await newWorkspace(page, 'Business', 'Copy from Personal');

  await page.goto('/transactions');
  await expect(page.getByText('Supplier dinner')).toHaveCount(0);
  // The tree came with it, so there is somewhere to file a business dinner from the first day.
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByLabel('Category').locator('option', { hasText: 'Restaurants' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Back in Personal, the dinner is where it was: a new workspace took nothing away.
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice').filter({ hasText: 'Personal' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Personal');
  await expect(page.getByText('Supplier dinner')).toBeVisible();
});

/**
 * An account is yours, so its history holds every workspace — badged, and read-only for the rows that are not the
 * open workspace's, since saving one here would re-file it into the workspace being looked from.
 */
test('an account’s history holds every workspace, each row saying which', async ({ page }) => {
  await addBank(page);
  await spend(page, 'Supplier dinner', '640000');
  await newWorkspace(page, 'Business', 'Copy from Personal');
  await spend(page, 'Client lunch', '320000');

  await page.goto('/accounts');
  await page.getByRole('link', { name: 'BCA Tahapan', exact: true }).click();
  await expect(page.getByTestId('workspace-badge').filter({ hasText: 'Business' })).toBeVisible();
  await expect(page.getByTestId('workspace-badge').filter({ hasText: 'Personal' })).toBeVisible();

  // Personal's row cannot be edited from Business: pressing it says so, and offers the way there.
  await page.locator('li', { hasText: 'Supplier dinner' }).first().click();
  await expect(page.getByTestId('other-workspace-note')).toContainText('Filed in Personal — open that workspace to edit it.');
  await page.getByRole('button', { name: 'Open Personal' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Personal');
});

/** A credit card with a statement day, so there is a statement to read the purchases off. */
async function addCard(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Visa');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Visa', exact: true })).toBeVisible();

  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  // The 31st is clamped to each month's last day, so today is always inside the current statement.
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
}

/** Spends on the card from whatever workspace is open. */
async function buyOnCard(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Visa (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Restaurants' });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(description).first()).toBeVisible();
}

/**
 * A card is the owner's, like the account it is paid from: the bank bills one statement for everything bought on
 * it, from whichever workspace. So the statement holds both, adds both up, and each row says where it was filed —
 * the badge is a label, not a filter, which is what the total is here to prove.
 */
test('a card’s statement holds every workspace, and each row says which', async ({ page }) => {
  await addBank(page);
  await addCard(page);
  await buyOnCard(page, 'Superindo', '450000');

  await newWorkspace(page, 'Business', 'Copy from Personal');
  await buyOnCard(page, 'Client lunch', '320000');

  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  const lines = page.getByTestId('statement-line');
  await expect(lines).toHaveCount(2);
  await expect(lines.filter({ hasText: 'Superindo' }).getByTestId('workspace-badge')).toHaveText('Personal');
  await expect(lines.filter({ hasText: 'Client lunch' }).getByTestId('workspace-badge')).toHaveText('Business');
  // The bank bills the whole card, so the bill is both workspaces added together.
  await expect(page.getByTestId('statement-total')).toContainText('770.000');
});

/** The switcher is where a workspace is chosen; Settings is where one is changed, and it says so. */
test('the switcher’s “Manage workspaces” lands on Settings, and the sheet closes behind it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByRole('link', { name: 'Manage workspaces' }).click();

  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('dialog', { name: 'Workspaces' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // Your own currency is stated rather than offered: every owner-level figure is already recorded against it.
  await expect(page.getByText('Net worth, balances, statements and the tax report are read in this currency.')).toBeVisible();
  await expect(page.getByTestId('workspace-entry')).toHaveCount(1);
});

/**
 * Settings holds what a workspace is, rather than which one is open: its name, and whether it is still in use.
 * Personal is neither — it is where categories and expected income fall back to — so it refuses to go away.
 */
test('Settings renames a workspace, archives it, and keeps Personal', async ({ page }) => {
  await addBank(page);
  await newWorkspace(page, 'Business', 'Copy from Personal');

  await page.goto('/settings');
  // Personal first, then the one just made: the order the switcher shows them in.
  await expect(page.getByTestId('workspace-entry')).toHaveCount(2);
  const business = page.getByTestId('workspace-entry').nth(1);
  await business.getByTestId('settings-workspace-row').click();
  await business.getByLabel('Name', { exact: true }).fill('Consulting');
  await business.getByRole('button', { name: 'Save' }).click();
  await expect(business.getByTestId('settings-workspace-row')).toContainText('Consulting');
  // The switcher follows: it is the same workspace, under the name it is now called.
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Consulting');

  // Archiving asks twice, and the app cannot stay in a workspace that has just been put away.
  await business.getByRole('button', { name: 'Archive workspace' }).click();
  await business.getByRole('button', { name: 'Click again to archive' }).click();
  await expect(page.getByTestId('workspace-entry')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Personal');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Workspaces' }).getByTestId('workspace-choice')).toHaveCount(1);
  await page.getByRole('dialog', { name: 'Workspaces' }).getByRole('button', { name: 'Close' }).click();

  // Personal stays, and says why in the place it was asked to go.
  const personal = page.getByTestId('workspace-entry').first();
  await personal.getByTestId('settings-workspace-row').click();
  await personal.getByRole('button', { name: 'Archive workspace' }).click();
  await personal.getByRole('button', { name: 'Click again to archive' }).click();
  await expect(personal.getByRole('alert')).toContainText('Personal is where categories and expected income fall back to, so it stays');
  await expect(page.getByTestId('workspace-entry')).toHaveCount(1);
});

// Local time, like every date field in the app: toISOString() is UTC, so between midnight and 07:00 in Jakarta
// it names yesterday and an event window built from it excludes what was just recorded.
const NOW = new Date();
const TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;

/** Records spending in whatever workspace is open, against a category of that workspace. */
async function spendOn(page: Page, description: string, category: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: category });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(description).first()).toBeVisible();
}

/**
 * Draws the event on a category, then says yes to the payment it then suggests.
 *
 * `option` is what the picker calls that category: once there is more than one workspace it says which workspace
 * each option belongs to, since two workspaces can hold copies of one category and the name alone is a coin toss.
 */
async function planAndTag(page: Page, category: string, description: string, option = category) {
  await page.getByLabel('Category').selectOption({ label: option });
  // What it is expected to cost: a plan is a list of things to buy, and an item without a price is not one.
  await page.getByLabel('Planned', { exact: true }).fill('1000000');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('button', { name: `Stop drawing on ${category}` })).toBeVisible();
  await page.getByTestId('event-suggestions').getByRole('button', { name: `Tag ${description}` }).click();
}

/**
 * A trip is the owner's, not a workspace's: it is spent on from both, and no single workspace's Cashflow ever
 * holds the whole of it. So the event reads whole by default, and one tab at a time reads that workspace's
 * share — its figure, and only the categories filed in it.
 */
test('an event reads whole, then one workspace at a time', async ({ page }) => {
  // The Categories screen asks for a name with a prompt; this is the answer to it.
  page.on('dialog', (dialog) => void dialog.accept(dialog.type() === 'prompt' ? 'Client lunches' : ''));

  await addBank(page);
  await spendOn(page, 'Hotel dinner', 'Restaurants', '4200000');

  await page.goto('/events');
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Singapore holiday');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Singapore holiday', exact: true })).toBeVisible();
  const url = page.url();
  await planAndTag(page, 'Restaurants', 'Hotel dinner');
  // One workspace has spent in it, so there is nothing to choose between yet.
  await expect(page.getByTestId('event-workspaces')).toHaveCount(0);

  // A second workspace, with a category of its own so each side of the trip is told apart by name.
  await newWorkspace(page, 'Business', 'Start empty');
  await page.goto('/categories');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByText('Client lunches')).toBeVisible();
  await spendOn(page, 'Supplier lunch', 'Client lunches', '640000');

  await page.goto(url);
  await planAndTag(page, 'Client lunches', 'Supplier lunch', 'Client lunches · Business');
  // The plan says which workspace each category it draws on belongs to, in the same words as the picker: two
  // workspaces can hold a category of the same name, and the name alone would make the choice a coin toss.
  await expect(page.getByRole('button', { name: 'Stop drawing on Restaurants' }).locator('xpath=..')).toContainText('Restaurants · Personal');

  // All: the whole trip, both workspaces added up.
  const tabs = page.getByTestId('event-workspaces');
  await expect(tabs.getByRole('button')).toHaveText(['All', 'Personal', 'Business']);
  await expect(page.getByTestId('event-total')).toContainText('4.840.000');
  await expect(page.getByTestId('event-detail-sheet')).toContainText('Restaurants');

  // Business: its own share, and only the categories filed in it.
  await tabs.getByRole('button', { name: 'Business' }).click();
  await expect(page.getByTestId('event-total')).toContainText('640.000');
  await expect(page.getByTestId('event-detail-sheet')).toContainText('Client lunches');
  await expect(page.getByTestId('event-detail-sheet')).not.toContainText('Restaurants');
  // And its own history: the dinner is Personal's, so it is not under this tab.
  await expect(page.getByText('Hotel dinner')).toHaveCount(0);

  // Back to All, and the whole trip is there again.
  await tabs.getByRole('button', { name: 'All' }).click();
  await expect(page.getByTestId('event-total')).toContainText('4.840.000');
});
