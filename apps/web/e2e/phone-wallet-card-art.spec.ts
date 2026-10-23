import { test } from '@playwright/test';
import { drawnFaces } from './wallet-card-art';

/** The same drawn-faces journey as `wallet-card-art.spec.ts`, at a phone's width with its tab bar. */
test('a Mandiri account is drawn as Mandiri’s debit card, its tier changes the face, an unknown bank keeps the plain face, and a wallet carries no chip', async ({ page }) => {
  await drawnFaces(page);
});
