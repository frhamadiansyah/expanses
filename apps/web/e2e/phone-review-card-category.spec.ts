import { expect, test } from '@playwright/test';
import { addPlastic, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage } from './card-section';
import { inject, notice } from './capture';

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-09-30T12:00:00+07:00'));
});

test('review opens on the card whose digits the message names, with the category guessed from the shop', async ({ page }) => {
  await openCard(page, { name: 'Prima Platinum', bank: 'Mandiri', last4: '3317' });
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Mandiri Prima Platinum(,|$)/ }).click();
  await cardPage(page, 'Settings');
  await addPlastic(page, '9025', 'Partner');
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  // A shop recorded before under a name sharing only its first word: the Add form guesses its category from that.
  await addTransaction(page, { description: 'Warteg Bahari', paidWith: 'Mandiri Prima Platinum ···· 3317', category: 'Restaurants', amount: '30000' });

  await page.goto('/review');
  await inject(page, [
    notice({
      id: 'sms-card',
      app: 'BANKCONTOH',
      title: 'BANKCONTOH',
      body: 'Terima kasih utk trx kartukredit XXXX9025 tgl 30-09-2026 10:15:00 di WARTEG SEDERHANA IDR48.300,00. Jika trx tidak Anda kenal, hub 10000',
    }),
  ]);
  await page.getByTestId('draft-row').filter({ hasText: 'WARTEG SEDERHANA' }).click();
  const form = page.getByRole('form', { name: 'Review WARTEG SEDERHANA' });
  await expect(form.getByRole('button', { name: 'Paid with' })).toContainText('9025');
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Restaurants');
});
