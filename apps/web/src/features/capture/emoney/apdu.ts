/**
 * The handful of commands an e-money card is sent, and the one rule they all pass: read only.
 *
 * A spike. Mandiri e-money answers ISO 7816-4 over ISO-DEP. Its application is selected by the AID
 * `0000000000000001`, and a few proprietary commands with no data field hand back the balance and the card number
 * without any authentication. The bytes are public: `EMoney.java` in agusibrahim/prepaidcard_reader (MIT,
 * https://github.com/agusibrahim/prepaidcard_reader, android/src/main/java/lib/bmandirinfc/EMoney.java) and
 * `emoneyUtils.dart` in felixtandian/emoneyReader (https://github.com/felixtandian/emoneyReader, lib/emoneyUtils.dart),
 * which also reads a "card attribute" the same way. Only the command bytes and the layout of the answers are taken
 * from them — no code — and no key, no bank app and nothing that authenticates is used.
 *
 * This diagnostic reads exactly these commands and no others. The card holds money, so a write, a debit or a top-up
 * sent by mistake could change what is on it; every command is checked against `readOnlyRefusal` before it leaves —
 * here, and again in Swift (`EmoneyReaderPlugin.swift`), which is the gate nothing can go round.
 */

/** A command as bytes, from hex with or without spaces. Throws on anything that is not whole bytes of hex. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(clean)) throw new Error(`Not hex: "${hex}"`);
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** Upper-case hex, no spaces: how the bridge carries bytes both ways and how the raw list shows them. */
export function toHex(bytes: ArrayLike<number>): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 1) out += (bytes[index]! & 0xff).toString(16).padStart(2, '0');
  return out.toUpperCase();
}

/** The e-money application's AID, also listed under `com.apple.developer.nfc.readersession.iso7816.select-identifiers`. */
export const EMONEY_AID = '0000000000000001';

/** SELECT the e-money application by name (P1 04), first or only occurrence (P2 00), asking for its FCI. */
export const SELECT_EMONEY = `00A4040008${EMONEY_AID}`;

/**
 * The proprietary reads the references send, each with no data field. Their instruction bytes (B5, B3, F2) sit
 * outside ISO's read set, so they are allowed only in exactly this shape — CLA 00, the INS, P1, P2 and an Le.
 */
export const PROPRIETARY_READS = {
  /** Balance: 4 bytes, little-endian rupiah, then card data the references do not read. */
  balance: '00B500000A',
  /** Card number: the first 8 bytes are the 16 digits printed on the card, as hex. */
  cardNumber: '00B300003F',
  /** "Card attribute" in felixtandian/emoneyReader; shown raw only. */
  cardAttribute: '00F210000B',
} as const;

/** Every fixed command this diagnostic sends, in order, before the records. Nothing outside this list reaches the card. */
export const COMMANDS: { label: string; command: string }[] = [
  { label: 'SELECT e-money application', command: SELECT_EMONEY },
  { label: 'Balance', command: PROPRIETARY_READS.balance },
  { label: 'Card number', command: PROPRIETARY_READS.cardNumber },
  { label: 'Card attribute', command: PROPRIETARY_READS.cardAttribute },
];

/**
 * Owner-supplied standard ISO read, read-only, on the owner's own card, no authentication bypassed: one READ RECORD
 * (B2) of record number `nn` in short file 1, by record number (P2 0C), with no data field — `00 B2 nn 0C 00`. The
 * owner's source claims an e-money card keeps its last 10–20 entries in SFI 1; it is unverified, so the reader stops
 * at the first status word that is not 9000 and the screen says a history cannot be read when none comes back. Only
 * this one file and this one instruction are tried — no other SFI, no other command.
 */
export const HISTORY_RECORDS = Array.from({ length: 20 }, (_, index) => index + 1);
export function readHistoryRecord(record: number): string {
  return toHex([0x00, 0xb2, record, 0x0c, 0x00]);
}

/**
 * The exact commands the allowlist admits — the only shapes that may leave the phone. A command is permitted only
 * if its bytes equal one of these. There is no history sweep and no family of read instructions to reason about: a
 * diagnostic that reads a fixed, named set needs nothing wider, and a narrow allowlist is one that cannot be
 * argued round. SELECT (A4) is a read that chooses a file; B5/B3/F2 are the proprietary reads above. No write,
 * update, debit, top-up or authenticate command is on the list, so none can be sent.
 */
const ALLOWED = new Set(COMMANDS.map((entry) => entry.command.replace(/\s+/g, '').toUpperCase()));

/**
 * The one extra shape the owner's addition admits: READ RECORD by number in short file 1 — CLA 00, INS B2, any
 * record number, P2 0C, and a single Le byte (`00 B2 nn 0C 00`). B2 is an ISO read; P2 0C fixes it to "record nn of
 * SFI 1, returned whole". No other P2 (so no other SFI, no "first/next record" modes) and no data field are allowed.
 */
const RECORD_SHAPE = /^00B2[0-9A-F]{2}0C[0-9A-F]{2}$/;

/** Why a command may not be sent, or null when it is one of the allowed reads. */
export function readOnlyRefusal(apdu: Uint8Array): string | null {
  const hex = toHex(apdu);
  if (ALLOWED.has(hex)) return null;
  if (RECORD_SHAPE.test(hex)) return null;
  return `${hex} is not one of the allowed read commands`;
}

/** An answer from the card: the bytes before the status word, and the status word itself, both as hex. */
export interface CardAnswer {
  data: string;
  sw: string;
}

export const isOk = (answer: CardAnswer): boolean => answer.sw === '9000';

/**
 * The balance in rupiah: the first four bytes, least significant first (the references reverse them and read hex).
 * Null unless the card answered 9000 with at least four bytes.
 */
export function parseBalance(answer: CardAnswer): number | null {
  if (!isOk(answer) || answer.data.length < 8) return null;
  const bytes = fromHex(answer.data.slice(0, 8));
  return bytes[0]! + bytes[1]! * 0x100 + bytes[2]! * 0x10000 + bytes[3]! * 0x1000000;
}

/** The 16-digit card number: the first eight bytes read as hex digits. Null unless they are all decimal digits. */
export function parseCardNumber(answer: CardAnswer): string | null {
  if (!isOk(answer) || answer.data.length < 16) return null;
  const digits = answer.data.slice(0, 16);
  return /^\d{16}$/.test(digits) ? digits : null;
}

/** All but the last four digits hidden, in groups of four, as the screen shows it. */
export function maskCardNumber(digits: string): string {
  const shown = digits.slice(-4);
  const hidden = '•'.repeat(Math.max(0, digits.length - 4)) + shown;
  return hidden.replace(/(.{4})(?=.)/g, '$1 ');
}

/** "Rp 12.345" — the whole-rupiah figure a card holds. */
export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
}

/**
 * A best-effort read of a record's bytes, shown beside the raw hex and marked a guess, never instead of it: the shape
 * of an entry is not known, so this only points at bytes that could be a date, an amount or a type. It looks for a
 * BCD date (YYMMDD, 2015–2039, optionally with hhmmss after it), a four-byte Unix timestamp either way round, a
 * four-byte amount either way round, and reports the first byte as a possible one-byte type flag. All of it is a
 * suggestion for the owner to confirm against a real entry — raw is what matters.
 */
export function guessRecord(hex: string): string[] {
  let bytes: Uint8Array;
  try {
    bytes = fromHex(hex);
  } catch {
    return [];
  }
  if (bytes.length === 0 || bytes.every((byte) => byte === 0x00) || bytes.every((byte) => byte === 0xff)) return [];
  const guesses: string[] = [];
  const bcd = (byte: number) => ((byte >> 4) > 9 || (byte & 0x0f) > 9 ? null : (byte >> 4) * 10 + (byte & 0x0f));

  for (let at = 0; at + 3 <= bytes.length; at += 1) {
    const [yy, mm, dd] = [bcd(bytes[at]!), bcd(bytes[at + 1]!), bcd(bytes[at + 2]!)];
    if (yy === null || mm === null || dd === null) continue;
    if (yy < 15 || yy > 39 || mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    let when = `20${pad(yy)}-${pad(mm)}-${pad(dd)}`;
    const [hh, mi, ss] = [bcd(bytes[at + 3] ?? -1), bcd(bytes[at + 4] ?? -1), bcd(bytes[at + 5] ?? -1)];
    if (hh !== null && hh < 24 && mi !== null && mi < 60 && ss !== null && ss < 60) when += ` ${pad(hh)}:${pad(mi)}:${pad(ss)}`;
    guesses.push(`date (BCD) at byte ${at}: ${when}`);
  }

  const low = Date.UTC(2015, 0, 1) / 1000;
  const high = Date.UTC(2040, 0, 1) / 1000;
  for (let at = 0; at + 4 <= bytes.length; at += 1) {
    const big = word(bytes, at, true);
    const little = word(bytes, at, false);
    if (big >= low && big < high) guesses.push(`date (Unix big-endian) at byte ${at}: ${new Date(big * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    if (little >= low && little < high) guesses.push(`date (Unix little-endian) at byte ${at}: ${new Date(little * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    if (big > 0 && big <= 100_000_000) guesses.push(`amount? (big-endian) at byte ${at}: ${formatRupiah(big)}`);
    if (little > 0 && little <= 100_000_000) guesses.push(`amount? (little-endian) at byte ${at}: ${formatRupiah(little)}`);
  }

  guesses.push(`first byte as a type flag: ${toHex([bytes[0]!])}`);
  return guesses;
}

const pad = (value: number) => String(value).padStart(2, '0');
const word = (bytes: Uint8Array, at: number, big: boolean) => {
  const [a, b, c, d] = [bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!];
  return big ? ((a << 24) >>> 0) + (b << 16) + (c << 8) + d : ((d << 24) >>> 0) + (c << 16) + (b << 8) + a;
};
