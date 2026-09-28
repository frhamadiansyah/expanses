/*
 * RFC 4122 version-5 (SHA-1, name-based) uuids, over WebCrypto. Household sharing names one thing identically on
 * every device without any device telling the others: the book's Uncategorised category is `uuidv5(bookId,
 * 'uncategorised')` (spec §7.3 rule 4).
 */

function parseUuid(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`"${uuid}" is not a uuid`);
  return Uint8Array.from({ length: 16 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

export async function uuidv5(namespace: string, name: string): Promise<string> {
  const ns = parseUuid(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const data = new Uint8Array(ns.length + nameBytes.length);
  data.set(ns, 0);
  data.set(nameBytes, ns.length);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', data)).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
