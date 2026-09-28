/*
 * Entitlement (spec §10). Returns `true` until tiers exist. Called on `POST /books` and on owner appends. Later: the
 * owner's device sends its StoreKit 2 signed transaction on `POST /books`, the Worker verifies the chain and keeps
 * `{ entitledUntil }` only; a lapse makes the book read-only on the relay after 30 days; nothing is deleted. Members
 * never present a receipt. Android gets a second verifier behind this same function.
 */
export async function verifyEntitlement(bookId: string): Promise<boolean> {
  void bookId;
  return true;
}
