import { test } from '@playwright/test';
import { cardWithPurchase, flipHero, refundFlow, waiverFlow } from './card-spend-bonus';

/** The same journey on the phone shell: the card turns over, the challenge sits on its back, Fee refunded records. */
test('phone: the card flips to Owed now; the Fee waiver challenge shows on the back; Fee refunded records the refund', async ({ page }) => {
  await cardWithPurchase(page, 'Flip Card', '412000');
  await flipHero(page, 'Flip Card');
  await waiverFlow(page, 'Flip Card');
  await refundFlow(page, 'Flip Card');
});
