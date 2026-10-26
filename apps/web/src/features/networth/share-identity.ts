/**
 * Whether a listed share's ticker is read-only on its Settings. A trade is of the security it was made in, so the
 * ticker is fixed once the share has one. While the trades are still being read the ticker is held fixed too, so it
 * is never offered and then refused. A share recorded before tickers existed has none to fix, so it may be given one
 * whatever it has traded (the database enforces the same rule).
 */
export function tickerLocked(hasTicker: boolean, trades: number | null): boolean {
  if (trades === null) return true;
  return hasTicker && trades > 0;
}

/** What the Custodian row says: the broker's RDN bank, or that none is named yet (named in the broker's Settings). */
export function custodianLine(rdnBank: string | null | undefined): string {
  return rdnBank?.trim() || 'Not set';
}
