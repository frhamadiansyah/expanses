import { test } from '@playwright/test';
import { cardWithPurchase, flipHero, refundFlow, waiverFlow } from './card-spend-bonus';

/**
 * A card's hero is the card, turned over like a bank or e-wallet account: Owed now and the limit on the back, the
 * nearest spend bonus (or the points) under them. The fee waiver is one row in Settings; a reached challenge is
 * refunded from its page, which records the refund and clears the challenge.
 */
test('the card flips to Owed now; the Fee waiver challenge shows on the back; Fee refunded records the refund and Undo takes it back', async ({ page }) => {
  await cardWithPurchase(page, 'Flip Card', '412000');
  await flipHero(page, 'Flip Card');
  await waiverFlow(page, 'Flip Card');
  await refundFlow(page, 'Flip Card');
});
