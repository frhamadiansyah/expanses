/**
 * What a capture is, and what reading it produced.
 *
 * A capture arrives as text (a notification's app, title and body) or as the lines Apple Vision read off an image,
 * each with the place it was found. Nothing here knows about a database or a screen: the reader is a function from
 * what was captured to what it says, and every value it produces carries how sure it is and which line it came from,
 * because the owner is the one who decides.
 */

/** Where a capture came from. A photo is a receipt; a screen is a screenshot the phone took for the owner. */
export type CaptureKind = 'notification' | 'screen' | 'photo' | 'shared-image';

/** One line of recognized text, with its place on the image: `x, y, w, h` in 0–1, `y` measured from the top. */
export interface CaptureLine {
  text: string;
  box: [number, number, number, number];
  height: number;
}

/** One capture, exactly as it was handed over, before anything has been read out of it. */
export interface RawCapture {
  id: string;
  kind: CaptureKind;
  /** When the phone noticed it: ISO 8601 with an offset. */
  capturedAt: string;
  /** A notification's app name or bundle id; null for an image. */
  app: string | null;
  title: string | null;
  body: string | null;
  /** For an image, what was read off it — in reading order. Empty for text captures. */
  lines: CaptureLine[];
  /** The image in the app's own storage, when there is one. */
  imageFile: string | null;
}

/** Which way the money went. */
export type MoveType = 'spent' | 'received' | 'topup' | 'refund';

/**
 * One read value: what was read, how sure the reader is (0–100), and the line it came from — an index into
 * `lines` for an image, null for text that has no lines of its own.
 */
export interface Field<T> {
  value: T;
  confidence: number;
  line: number | null;
}

/** What one capture says. `skipped` is set when nothing is read at all, and why. */
export interface Reading {
  skipped: null | 'promo' | 'unreadable';
  amount: Field<{ minor: number; currency: string | null }> | null;
  /** ISO date-time; the date alone when the capture printed no time. */
  occurredAt: Field<string> | null;
  type: Field<MoveType>;
  /** The merchant, the recipient, the sender — whichever the capture named. */
  name: Field<string> | null;
  /** The masked digits of an account, as the capture printed them after the mask: `"1234"`. */
  accountHint: string | null;
  /**
   * What the capture says paid, under its payment-method label — "Credit Card NUSA (6175)" — and the last four digits
   * printed in it, when it printed them. Null when the capture names no payment method.
   */
  paymentMethod: { text: string; last4: string | null } | null;
}

/** A learned place for one field: the label it sat under, and roughly where on the image it was. */
export interface Anchor {
  label: string | null;
  region: [number, number, number, number] | null;
}

/** What a source has learned about its own layout. */
export type Template = Partial<Record<'amount' | 'name' | 'date', Anchor>>;

/**
 * The words one language recognizes.
 *
 * Every list is lower-case and matched without case. They are data, not logic: adding a language is adding a file, and
 * no bank, wallet or merchant name belongs in any of them.
 */
export interface WordList {
  /** Money leaving: "bayar", "paid". */
  spent: string[];
  /** Money arriving: "masuk", "received". */
  received: string[];
  /** Money put in from a card or a bank: "top up", "isi saldo". */
  topup: string[];
  refund: string[];
  /**
   * Phrases that hold a direction word and are not a direction: "terima kasih" is thanks, not money received, and a
   * "credit card" is how a payment was made, not money credited. They are blanked out before direction is read.
   */
  notDirection: string[];
  /** An offer rather than a movement: "cashback", "voucher". */
  promo: string[];
  /** The balance words: a figure on such a line is never the amount. */
  balance: string[];
  /** Labels whose next figure is the amount: "total", "nominal". */
  amountLabels: string[];
  /** Labels whose next words are the other side's name: "merchant", "penerima". */
  nameLabels: string[];
  /** Words that introduce a name: "ke", "to". */
  nameLeadIns: string[];
  /** Labels whose value is what paid — a card, a balance: "payment method", "sumber dana". */
  paymentLabels: string[];
  /** Words that say a payment method is a card: "credit card", "kartu". */
  cardWords: string[];
  /** Labels of a number that names a person rather than an account: "ID", "no. hp". A mask beside one is no account. */
  idLabels: string[];
  /** Shorthands after a figure: "rb" = a thousand, "k" = a thousand. */
  thousand: string[];
  /** "jt" = a million, "m" = a million. */
  million: string[];
}
