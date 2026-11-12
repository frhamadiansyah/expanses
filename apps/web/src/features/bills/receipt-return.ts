/*
 * The way back from a receipt's bill pages (the bill list, then a bill's month) to the receipt itself.
 *
 * Linking or moving a purchase used to push the receipt again on top of the list and the month page, so the
 * receipt's ‹ went back to the month just used. The receipt notes its own history entry as it opens the list; ✓ on
 * the month page then steps back to exactly that entry, and the receipt's ‹ goes wherever it was opened from.
 */
const receiptAt = new Map<string, number>();

/** The receipt's history entry, noted as it opens its bill list. */
export function markReceiptAt(transactionId: string, index: number): void {
  receiptAt.set(transactionId, index);
}

/** How far back the receipt is from the entry `now` (a negative step), or null when it is not behind it. */
export function stepsBackToReceipt(transactionId: string, now: number): number | null {
  const at = receiptAt.get(transactionId);
  return at !== undefined && at < now ? at - now : null;
}

/** The history entry the router is on: its index in this tab's session. */
export function historyIndex(history: { location: { state: unknown } }): number {
  return (history.location.state as { __TSR_index?: number } | null)?.__TSR_index ?? 0;
}
