import { expect, type Page, test } from '@playwright/test';
import { expectWalletFigure, openAccount, openSettings, openWalletAccount } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';

/*
 * A money account's starting balance, changed from its Settings (owner, 22 Nov 2026): the Balance on the As of day is
 * an amount field; a new figure asks first, saying what moves, and then every balance from that day moves by the
 * difference while Cashflow stays as it was. Today is pinned to 22 November 2026. Every name and figure is invented.
 */
const TODAY = new Date('2026-11-22T12:00:00');
const SHOTS = process.env.SHOTS_DIR;

test.beforeEach(async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  await openAccount(page, { subtype: 'cash', name: 'Dompet Contoh', balance: '1250000' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await fillAmount(page, form, '50000');
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'Dompet Contoh');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Warung Contoh');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
});

/** Every figure Cashflow shows for the month, in order: its totals and its rows. */
async function cashflowFigures(page: Page): Promise<string[]> {
  await page.goto('/transactions');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Warung Contoh' })).toHaveCount(1);
  const text = await page.getByRole('main').innerText();
  return text.split('\n').filter((line) => /Rp/.test(line));
}

/**
 * For the screenshot only: a headless browser draws no confirm, so the words it was asked with are drawn as iOS shows
 * a confirm (title, body, Cancel and OK), over the page as it was, then taken away.
 */
async function showConfirm(page: Page, message: string) {
  await page.evaluate((text) => {
    const [title, body] = text.split('\n\n');
    const veil = document.createElement('div');
    veil.id = 'shot-confirm';
    veil.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif';
    veil.innerHTML = `<div style="width:270px;border-radius:14px;background:#f2f2f2;text-align:center;overflow:hidden">
      <div style="padding:19px 16px 15px"><div data-part="title" style="font-weight:600;font-size:17px;line-height:22px;color:#000"></div>
      <div data-part="body" style="margin-top:2px;font-size:13px;line-height:16px;color:#000"></div></div>
      <div style="display:flex;border-top:.5px solid rgba(60,60,67,.29)"><div style="flex:1;padding:11px;font-size:17px;color:#007aff">Cancel</div>
      <div style="flex:1;padding:11px;font-size:17px;font-weight:600;color:#007aff;border-left:.5px solid rgba(60,60,67,.29)">OK</div></div></div>`;
    veil.querySelector('[data-part="title"]')!.textContent = title ?? '';
    veil.querySelector('[data-part="body"]')!.textContent = body ?? '';
    document.body.appendChild(veil);
  }, message);
  await page.screenshot({ path: `${SHOTS}/start-balance-confirm.png` });
  await page.evaluate(() => document.getElementById('shot-confirm')?.remove());
}

async function balanceField(page: Page) {
  await openWalletAccount(page, 'Dompet Contoh');
  await openSettings(page);
  const field = page.getByLabel('Balance', { exact: true });
  await expect(field).toHaveValue('1.250.000');
  return field;
}

test('a new starting balance asks first, then moves the balance today by the difference and leaves Cashflow', async ({ page }) => {
  const before = await cashflowFigures(page);
  const field = await balanceField(page);
  await field.fill('1450000');
  await expect(field).toHaveValue('1.450.000');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/start-balance-editing.png` });

  let asked = '';
  page.once('dialog', (dialog) => {
    asked = dialog.message();
    void dialog.accept();
  });
  await field.blur();
  await expect.poll(() => asked).not.toBe('');
  if (SHOTS) await showConfirm(page, asked);
  expect(asked.replace(/ /g, ' ')).toBe('Change the starting balance?\n\nEvery balance from 22 Nov 2026 moves by +Rp 200.000. Balance today becomes Rp 1.400.000.');
  await expect(field).toHaveValue('1.450.000');
  await expect(page.getByLabel('As of')).toHaveValue('2026-11-22');

  await page.goto('/wallet');
  await expectWalletFigure(page, 'Dompet Contoh', '1.400.000');
  expect(await cashflowFigures(page)).toEqual(before);
});

test('Cancel leaves the starting balance and the balance as they were', async ({ page }) => {
  const field = await balanceField(page);
  await field.fill('900000');
  page.once('dialog', (dialog) => void dialog.dismiss());
  await field.blur();
  await expect(field).toHaveValue('1.250.000');
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Dompet Contoh', '1.200.000');
});
