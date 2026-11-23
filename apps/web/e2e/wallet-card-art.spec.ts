import { test } from '@playwright/test';
import { drawnFaces } from './wallet-card-art';
import { macV2 } from './mac-detail';

test('a Mandiri account is drawn as Mandiri’s debit card, its tier changes the face, an unknown bank keeps the plain face, and a wallet carries no chip', async ({ page }) => {
  // A bank account drawn as its card's face is a v2 part of Mac Wallet (v1 draws money as tiles).
  await macV2(page);
  await drawnFaces(page);
});
