/**
 * Opens an account once, then does what follows on it — a wallet's phone digits, sharing it with the household.
 *
 * What follows can fail after the account is already open. Saving again must not open a second one, so the opened
 * account is remembered in `memory`, and a second try only does again what follows on the account already there.
 */
export async function openOnce(memory: { id: string | null }, open: () => Promise<string>, after: (id: string) => Promise<void>): Promise<string> {
  const id = memory.id ?? (await open());
  memory.id = id;
  await after(id);
  return id;
}
