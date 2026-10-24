import { INDONESIAN_BANKS } from '@expanses/core';

/**
 * The drawn faces Wallet gives the money it holds (docs/card-art, approved 23 Oct 2026): which account gets which, and
 * what each kind of face carries.
 *
 * A credit card keeps its catalogue art. Everything else in the stack — a bank account, a digital wallet, a prepaid
 * e-money card, a PayLater line — used to be a plain face coloured from its name; now a name the owner's banks and apps
 * are known by finds the face drawn for it, and `CardFace` lays the account's print over that art. A name nothing here
 * knows keeps the plain face.
 *
 * What a face carries follows its kind, as a real one does: a debit card its chip and contactless mark, a prepaid card
 * the contactless mark alone, a wallet and a PayLater line neither — and a PayLater line no number, since there is none.
 */
export type FaceKind = 'debit' | 'emoney' | 'ewallet' | 'paylater' | 'membership';
// 'membership' is a points programme's card (programme-art), found by programmeFaceRef, never by a name here: it is
// whole as drawn — brand and all — with no chip, contactless mark, network or digits laid over it.

/** One of a bank's debit card tiers: its short word (what the account keeps), its label, and the face drawn for it. */
export interface FaceTier {
  id: string;
  label: string;
  key: string;
}

export interface Face {
  /** The art's key in `FACES` (faces.generated.ts); a tier of a bank is the bank's key and the tier's word. */
  key: string;
  kind: FaceKind;
  /** The bank's or app's name as its card prints it top-left — "mandiri", "BCA", "gopay" — never the account's name. */
  mark: string;
  tiers?: readonly FaceTier[];
}

/** What a card in Wallet hands `CardFace`: the face to draw, at the account's tier, and what kind of card it is. */
export type FaceRef = Pick<Face, 'key' | 'kind' | 'mark'>;

/** The banks whose debit cards come in tiers that look nothing alike, in the bank's own words for them. */
export const TIERS: Readonly<Record<string, readonly FaceTier[]>> = {
  mandiri: [
    { id: 'standard', label: 'Standard', key: 'mandiri' },
    { id: 'gold', label: 'Gold', key: 'mandiri-gold' },
    { id: 'platinum', label: 'Platinum', key: 'mandiri-platinum' },
    { id: 'prioritas', label: 'Prioritas', key: 'mandiri-prioritas' },
  ],
  bca: [
    { id: 'blue', label: 'Paspor blue', key: 'bca' },
    { id: 'gold', label: 'Paspor gold', key: 'bca-gold' },
    { id: 'platinum', label: 'Paspor platinum', key: 'bca-platinum' },
    { id: 'prioritas', label: 'Prioritas', key: 'bca-prioritas' },
  ],
  bsi: [
    { id: 'silver', label: 'Silver', key: 'bsi' },
    { id: 'gold', label: 'Gold', key: 'bsi-gold' },
    { id: 'platinum', label: 'Platinum', key: 'bsi-platinum' },
  ],
  cimb: [
    { id: 'standard', label: 'Standard', key: 'cimb' },
    { id: 'preferred', label: 'Preferred', key: 'cimb-preferred' },
  ],
};

/**
 * The banks with a debit face, by the name the tax report's bank list stores: that list's `also` names (BCA, Mandiri,
 * Jenius, blu…) find the face too, so a bank is matched the one way it is typed. A bank on that list with no face —
 * BCA Syariah, Bank DKI — is kept as a name that matches nothing, so "BCA Syariah" is not drawn as BCA.
 */
const BANK_FACES: Readonly<Record<string, { key: string; mark: string }>> = {
  'Bank Central Asia': { key: 'bca', mark: 'BCA' },
  'Bank Mandiri': { key: 'mandiri', mark: 'mandiri' },
  'Bank Rakyat Indonesia': { key: 'bri', mark: 'BRI' },
  'Bank Negara Indonesia': { key: 'bni', mark: 'BNI' },
  'Bank Tabungan Negara': { key: 'btn', mark: 'BTN' },
  'Bank Syariah Indonesia': { key: 'bsi', mark: 'BSI' },
  'CIMB Niaga': { key: 'cimb', mark: 'CIMB NIAGA' },
  'Bank Permata': { key: 'permata', mark: 'Permata Bank' },
  'Bank Danamon': { key: 'danamon', mark: 'Danamon' },
  'Maybank Indonesia': { key: 'maybank', mark: 'Maybank' },
  'Bank OCBC Indonesia': { key: 'ocbc', mark: 'OCBC' },
  'Panin Bank': { key: 'panin', mark: 'PaninBank' },
  'Bank SMBC Indonesia': { key: 'jenius', mark: 'Jenius' },
  'UOB Indonesia': { key: 'uob', mark: 'UOB' },
  'DBS Indonesia': { key: 'dbs', mark: 'DBS' },
  'Bank Sinarmas': { key: 'sinarmas', mark: 'bank sinarmas' },
  'Bank Muamalat': { key: 'muamalat', mark: 'Muamalat' },
  'BCA Digital': { key: 'blu', mark: 'blu' },
  'Bank Jago': { key: 'jago', mark: 'Jago' },
  SeaBank: { key: 'seabank', mark: 'SeaBank' },
  'Allo Bank': { key: 'allo', mark: 'allo bank' },
  'Bank Neo Commerce': { key: 'neo', mark: 'Neo Commerce' },
  Superbank: { key: 'superbank', mark: 'superbank' },
  'Krom Bank': { key: 'krom', mark: 'krom' },
};

/** The wallets, prepaid cards and PayLater lines, each by the names it is called. */
const APP_FACES: readonly { key: string; kind: FaceKind; mark: string; names: readonly string[] }[] = [
  { key: 'ovo', kind: 'ewallet', mark: 'OVO', names: ['OVO'] },
  { key: 'shopeepay', kind: 'ewallet', mark: 'ShopeePay', names: ['ShopeePay', 'Shopee Pay', 'Shopee'] },
  { key: 'gopay', kind: 'ewallet', mark: 'gopay', names: ['GoPay', 'Go-Pay', 'Gojek'] },
  { key: 'dana', kind: 'ewallet', mark: 'DANA', names: ['DANA'] },
  { key: 'linkaja', kind: 'ewallet', mark: 'LinkAja', names: ['LinkAja', 'Link Aja'] },
  { key: 'emoney', kind: 'emoney', mark: 'mandiri e-money', names: ['Mandiri e-money', 'e-money', 'emoney', 'e money'] },
  { key: 'flazz', kind: 'emoney', mark: 'Flazz', names: ['Flazz', 'BCA Flazz'] },
  { key: 'brizzi', kind: 'emoney', mark: 'BRIZZI', names: ['Brizzi', 'BRI Brizzi'] },
  { key: 'tapcash', kind: 'emoney', mark: 'TapCash', names: ['TapCash', 'Tap Cash', 'BNI TapCash'] },
  { key: 'jakcard', kind: 'emoney', mark: 'JakCard', names: ['JakCard', 'Jak Card'] },
  { key: 'kredivo', kind: 'paylater', mark: 'Kredivo', names: ['Kredivo'] },
  { key: 'akulaku', kind: 'paylater', mark: 'Akulaku', names: ['Akulaku', 'Akulaku PayLater'] },
  { key: 'spaylater', kind: 'paylater', mark: 'SPayLater', names: ['SPayLater', 'SPay Later', 'Shopee PayLater', 'Shopee Pay Later'] },
  { key: 'gopaylater', kind: 'paylater', mark: 'gopaylater', names: ['GoPayLater', 'GoPay Later', 'Gojek PayLater'] },
];

/** Every name that finds a face, or is known not to: lowercased, with the face it finds (null for a bank with none). */
const NAMES: readonly { name: string; face: Face | null }[] = [
  ...INDONESIAN_BANKS.flatMap((bank) => {
    const found = BANK_FACES[bank.name];
    const face: Face | null = found ? { key: found.key, kind: 'debit', mark: found.mark, tiers: TIERS[found.key] } : null;
    return [bank.name, ...bank.also].map((name) => ({ name: name.toLowerCase(), face }));
  }),
  ...APP_FACES.flatMap((app) => app.names.map((name) => ({ name: name.toLowerCase(), face: { key: app.key, kind: app.kind, mark: app.mark } }))),
];

// Only the characters a `u` pattern lets be escaped: a hyphen outside a class needs none, and may not have one.
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `name` is in `text` as a whole word or phrase, not as part of a longer word: "gopay" is not in "gopaylater". */
function names(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

/**
 * The face one piece of text names, or null: the longest known name found whole in it wins, so "BCA Digital" is blu
 * rather than BCA, and "Mandiri e-money" the prepaid card rather than the bank's debit card. Letter case never matters.
 */
export function faceNamed(text: string | null | undefined, kinds: readonly FaceKind[] = ['debit', 'emoney', 'ewallet']): Face | null {
  const want = text?.trim();
  if (!want) return null;
  let best: { name: string; face: Face | null } | null = null;
  for (const candidate of NAMES) {
    if (candidate.name.length <= (best?.name.length ?? 0)) continue;
    if (names(want, candidate.name)) best = candidate;
  }
  return best?.face && kinds.includes(best.face.kind) ? best.face : null;
}

/**
 * The face for an account, from the names it is known by in order — its bank (the tax report's Nama institusi), then
 * its own name — and null when none of them names one, which keeps the plain face.
 */
export function faceFor(texts: readonly (string | null | undefined)[], kinds?: readonly FaceKind[]): Face | null {
  for (const text of texts) {
    const face = faceNamed(text, kinds);
    if (face) return face;
  }
  return null;
}

/** The art key for a face at a tier: the tier's own, or the face's when the tier is unset or not one the bank has. */
export function tieredKey(face: Face, tier: string | null | undefined): string {
  return face.tiers?.find((t) => t.id === tier)?.key ?? face.key;
}

/** The word printed where a holder's name goes on a face that has no holder: what the card is. */
export function holderLine(kind: FaceKind): string | null {
  switch (kind) {
    case 'emoney':
      return 'E-MONEY';
    case 'ewallet':
      return 'E-WALLET';
    case 'paylater':
      return 'PAYLATER';
    default:
      return null;
  }
}
