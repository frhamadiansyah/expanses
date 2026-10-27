import { expect, test } from '@playwright/test';
import { expectWalletFigure, openAccount } from './accounts';
import { pickBillCategory, showRepeating } from './bill-form';
import { localIsoDate, todayIn } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('a yearly bill saves up in a savings account, and is paid by card from the fund', async ({ page }) => {
  await openAccount(page, { subtype: 'savings', name: 'BCA Savings', balance: '20000000' });
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'credit_card', name: 'Visa Gold' });

  const [y, m, d] = (await todayIn(page)).split('-').map(Number) as [number, number, number];
  const at = new Date(y, m - 1, d + 75);
  void localIsoDate(at);

  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Car insurance');
  await page.getByLabel('Amount', { exact: true }).fill('3000000');
  await pickBillCategory(page);
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  // A monthly bill has no sinking fund.
  await expect(page.getByText('Sinking fund', { exact: true })).toHaveCount(0);
  await page.getByLabel('Repeats').selectOption('yearly');
  await page.getByLabel('Month', { exact: true }).selectOption(String(at.getMonth() + 1));
  await page.getByLabel('Due by').selectOption(String(at.getDate()));

  await expect(page.getByText('Sinking fund', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Save up for it' }).check();
  // The monthly figure is worked out and offered; the savings account is the default place.
  await expect(page.getByRole('textbox', { name: 'Each month' })).toHaveAttribute('placeholder', /\d/);
  await expect(page.getByLabel('Set aside in')).toHaveValue(/.+/);
  await expect(page.getByLabel('Set aside in')).toContainText('BCA Savings');
  await page.getByLabel('Set aside in').selectOption({ label: 'BCA Savings' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/bills$/);

  // Recurring's Repeating page sets the month's amount aside in its hero and lists the bill.
  await showRepeating(page);
  await expect(page.getByTestId('repeating-summary')).toContainText('Needed · per month, from now');
  await expect(page.getByTestId('repeating-summary')).toContainText('Set aside');
  await expect(page.getByTestId('yearly-bill-row').filter({ hasText: 'Car insurance' })).toBeVisible();

  // Its page.
  await page.getByTestId('yearly-bill-row').filter({ hasText: 'Car insurance' }).click();
  await expect(page.getByText('Sinking fund', { exact: true })).toBeVisible();
  await expect(page.getByTestId('sinking-saved')).toContainText('of Rp');
  await expect(page.getByTestId('sinking-monthly')).toContainText('Rp');
  await expect(page.getByTestId('sinking-history')).toContainText('1 entry');
  const before = await page.getByTestId('sinking-saved').innerText();

  await page.getByRole('button', { name: 'Put in extra' }).click();
  const extra = page.getByRole('dialog', { name: 'Put in extra' });
  await extra.getByLabel(/^Amount/).fill('100000');
  await expect(extra.getByTestId('extra-after-monthly')).toContainText('months left');
  await extra.getByRole('button', { name: 'Put in', exact: true }).click();
  await expect(extra).toHaveCount(0);
  await expect(page.getByTestId('sinking-saved')).not.toHaveText(before);
  await expect(page.getByTestId('sinking-history')).toContainText('2 entries');

  // Pay it by credit card: the card is paid from the savings account too.
  await page.getByRole('button', { name: /^Pay/ }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Pay Car insurance' });
  await sheet.getByLabel('Paid with').selectOption({ label: 'Visa Gold' });
  const toggle = sheet.getByRole('checkbox', { name: 'Pay the card from the fund' });
  await expect(toggle).toBeChecked();
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(sheet).toHaveCount(0);

  // Savings paid the card, the card owes nothing, and the fund is gone.
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Savings', '17.000.000');
  await page.goto('/bills');
  await showRepeating(page);
  await expect(page.getByTestId('repeating-summary')).toContainText('Not set aside');
});

test('the Repeating hero adds up what each bill needs a month, with and without a fund', async ({ page }) => {
  await openAccount(page, { subtype: 'savings', name: 'BCA Savings', balance: '20000000' });
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  const [y, m, d] = (await todayIn(page)).split('-').map(Number) as [number, number, number];
  const bill = async (name: string, days: number, fund: boolean) => {
    const at = new Date(y, m - 1, d + days);
    await page.goto('/bills/new');
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Amount', { exact: true }).fill('3000000');
    await pickBillCategory(page);
    await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
    await page.getByLabel('Repeats').selectOption('yearly');
    await page.getByLabel('Month', { exact: true }).selectOption(String(at.getMonth() + 1));
    await page.getByLabel('Due by').selectOption(String(at.getDate()));
    if (fund) {
      await page.getByRole('checkbox', { name: 'Save up for it' }).check();
      await page.getByLabel('Set aside in').selectOption({ label: 'BCA Savings' });
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(/\/bills$/);
  };
  await bill('Car insurance', 75, true);
  await bill('Domain', 150, false);

  await showRepeating(page);
  const hero = page.getByTestId('repeating-summary');
  await expect(hero).toContainText('Needed · per month, from now');
  await expect(hero).toContainText('Set aside');
  await expect(hero).toContainText('Not set aside');
  const share = async (name: string) => {
    const text = await page.getByTestId('yearly-bill-row').filter({ hasText: name }).innerText();
    return Number(/Rp\s([\d.]+)\sa month/.exec(text)![1]!.replace(/\./g, ''));
  };
  const total = (await share('Car insurance')) + (await share('Domain'));
  expect(total).toBeGreaterThan(0);
  expect(Number((await page.getByTestId('needed-total').innerText()).replace(/\D/g, ''))).toBe(total);
});
