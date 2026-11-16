import {
  type CardAnswer,
  COMMANDS,
  fromHex,
  guessRecord,
  HISTORY_RECORDS,
  isOk,
  parseBalance,
  parseCardNumber,
  readHistoryRecord,
  readOnlyRefusal,
} from './apdu';

/**
 * One tap of an e-money card, run from here so the rule about what is sent can be tested without a card: SELECT the
 * application, read the balance and the card number (and the card attribute, shown raw), then — the owner's
 * addition — one standard ISO READ RECORD on short file 1, records 1–20, stopping at the first that is not 9000.
 * Read-only throughout, on the owner's own card, with no authentication bypassed; nothing is stored and nothing is
 * sent anywhere. The result lives on the screen that asked for it.
 */

/** The phone's side of a tap: one command out, one answer back. Throws once the card is gone. */
export interface CardLink {
  transmit(apdu: string): Promise<CardAnswer>;
}

/** One command and what came of it. `refused` means it was never sent. */
export interface Exchange {
  label: string;
  command: string;
  sw: string;
  data: string;
  refused?: string;
}

/** One history record that answered 9000, with its best-effort parse (a guess, never instead of the raw hex). */
export interface HistoryRecord {
  record: number;
  data: string;
  guesses: string[];
}

export interface CardRead {
  cardNumber: string | null;
  balance: number | null;
  exchanges: Exchange[];
  /** Records of SFI 1 that answered 9000, in order read. Empty when a standard read cannot reach the history. */
  history: HistoryRecord[];
  /** Why the read did not get as far as the balance, when it did not (e.g. not an e-money card). */
  note: string | null;
}

export interface ReadOptions {
  onProgress?: (done: number, total: number, label: string) => void;
}

/**
 * Sends the four commands in order and collects the answers. SELECT must succeed first; if it does not, the card is
 * not an e-money card (or was taken away) and the rest is not attempted. Each command is checked against the
 * allowlist before it leaves — a belt the Swift gate already wears — so a command that is somehow not on the list is
 * recorded as refused rather than sent.
 */
export async function readEmoneyCard(link: CardLink, { onProgress }: ReadOptions = {}): Promise<CardRead> {
  const exchanges: Exchange[] = [];
  const history: HistoryRecord[] = [];
  let cardNumber: string | null = null;
  let balance: number | null = null;
  let note: string | null = null;
  const total = COMMANDS.length + HISTORY_RECORDS.length;

  /** Sends a command only if it passes the allowlist; returns null when the card was lost (and sets `note`). */
  async function send(label: string, command: string, done: number): Promise<CardAnswer | null> {
    onProgress?.(done, total, label);
    const refusal = readOnlyRefusal(fromHex(command));
    if (refusal) {
      exchanges.push({ label, command, sw: '', data: '', refused: refusal });
      return null;
    }
    try {
      const answer = await link.transmit(command);
      exchanges.push({ label, command, ...answer });
      return answer;
    } catch (error) {
      note = error instanceof Error ? error.message : 'The card was lost.';
      return null;
    }
  }

  // The fixed reads: SELECT first, then balance, card number and attribute.
  for (let index = 0; index < COMMANDS.length; index += 1) {
    const { label, command } = COMMANDS[index]!;
    const answer = await send(label, command, index + 1);
    if (!answer) return { cardNumber, balance, exchanges, history, note };
    if (index === 0 && !isOk(answer)) {
      // SELECT failed: a card that is not e-money answers 6A82 (no such application) or 6D00 (no such command).
      note = `The application could not be selected (${answer.sw || 'no answer'}); this does not look like an e-money card.`;
      return { cardNumber, balance, exchanges, history, note };
    }
    if (label === 'Balance') balance = parseBalance(answer);
    if (label === 'Card number') cardNumber = parseCardNumber(answer);
  }

  // The owner's addition: one READ RECORD on SFI 1, records 1–20, stopping at the first status word that is not 9000.
  for (let index = 0; index < HISTORY_RECORDS.length; index += 1) {
    const record = HISTORY_RECORDS[index]!;
    const answer = await send(`History record ${record}`, readHistoryRecord(record), COMMANDS.length + index + 1);
    if (!answer) break; // the card was lost — note is set
    if (!isOk(answer)) break; // 6A83 (record not found), 6B00, 6A82 (no such file): the history ends here
    history.push({ record, data: answer.data, guesses: guessRecord(answer.data) });
  }

  return { cardNumber, balance, exchanges, history, note };
}
