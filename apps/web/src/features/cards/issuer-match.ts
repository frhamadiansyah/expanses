/**
 * The banks a card's Institution row offers over the keyboard for what is typed: the known issuers — the
 * catalogue's and the ones already used here — whose name holds every word typed, at most three, the ones that
 * start with it first. Nothing typed, or the name already in full, offers nothing: there is nothing left to finish.
 */
export function issuerMatches(typed: string, issuers: readonly string[]): { name: string; also: readonly string[] }[] {
  const wanted = typed.trim().toLowerCase();
  if (!wanted) return [];
  const words = wanted.split(/\s+/);
  return issuers
    .filter((issuer) => issuer.toLowerCase() !== wanted && words.every((word) => issuer.toLowerCase().includes(word)))
    .sort((a, b) => Number(!a.toLowerCase().startsWith(wanted)) - Number(!b.toLowerCase().startsWith(wanted)) || a.localeCompare(b))
    .slice(0, 3)
    .map((name) => ({ name, also: [] }));
}
