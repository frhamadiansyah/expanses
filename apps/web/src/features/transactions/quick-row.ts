import { expenseLines, groupedMajorString, minorToMajorString, parseLooseAmount, parseLooseDate, type PaymentOption, type PostingLine } from '@expanses/core';
import type { AccountRow, CardRow, DraftRow, TransactionView } from '@expanses/db';
import { canPayWith } from '../../lib/account-types';
import { classify } from './classify';

/**
 * One purchase as a row of cells: what the list edits in place and the table types into.
 *
 * Only a plain purchase fits in a row — one category, one account, in that account's own currency.
 * Anything more (a split, income, a transfer, a price in another currency) opens the full form.
 */

/** Cells as typed. Dates and amounts stay text until they are read, so a half-typed cell is not lost. */
export interface QuickValues {
  date: string;
  description: string;
  amount: string;
  accountId: string;
  cardId: string;
  categoryId: string;
}

export interface QuickRead {
  occurredOn: string;
  description: string;
  amountMinor: number;
  currency: string;
  accountId: string;
  cardId: string | null;
  categoryId: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** 15 Sep in the current year, 15 Sep 2025 in any other: short, and read back the same way. */
export function shortDate(iso: string, today: string): string {
  if (!ISO.test(iso)) return iso;
  const day = `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? day : `${day} ${iso.slice(0, 4)}`;
}

/** Whether a recorded transaction can be edited as a row, rather than needing the full form. */
export function isQuickEditable(tx: TransactionView): boolean {
  if (tx.status !== 'posted' || tx.originalCurrency) return false;
  if (classify(tx).type !== 'expense') return false;
  const expenses = tx.entries.filter((e) => e.accountKind === 'expense');
  const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
  const rest = tx.entries.length - expenses.length - money.length;
  return expenses.length === 1 && money.length === 1 && rest === 0 && money[0]!.amountMinor < 0;
}

export function quickFromTransaction(tx: TransactionView, today: string): QuickValues {
  const expense = tx.entries.find((e) => e.accountKind === 'expense')!;
  const money = tx.entries.find((e) => e.accountKind === 'asset' || e.accountKind === 'liability')!;
  return {
    date: shortDate(tx.occurredOn, today),
    description: tx.description,
    amount: minorToMajorString(expense.amountMinor, money.currency),
    accountId: money.accountId,
    cardId: tx.cardId ?? '',
    categoryId: expense.accountId,
  };
}

/**
 * A draft's cells. The amount cell is typed, read and recorded in the paying account's currency, so a figure read in
 * another one (a purchase abroad, in the merchant's figure) is left out of it: shown there it would be recorded as
 * the account's own money. Review is where that figure is kept and its charge asked.
 */
export function quickFromDraft(draft: DraftRow, today: string, accounts: readonly AccountRow[]): QuickValues {
  const settled = accounts.find((a) => a.id === draft.accountId)?.currency;
  const own = !settled || settled === draft.currency;
  return {
    date: ISO.test(draft.occurredOn) ? shortDate(draft.occurredOn, today) : draft.occurredOn,
    description: draft.description,
    amount: own && draft.amountMinor > 0 ? minorToMajorString(draft.amountMinor, draft.currency) : '',
    accountId: draft.accountId ?? '',
    cardId: draft.cardId ?? '',
    categoryId: draft.categoryAccountId ?? '',
  };
}

/**
 * The amount cell grouped as the rows beside it print their figures ("320.000", "1.234,56"), still a cell to type
 * in: it reads back to the same money (`parseLooseAmount` takes a dot every three as grouping). A cell that does not
 * read as an amount is left as it was typed.
 */
export function groupedAmountCell(values: QuickValues, currency: string): QuickValues {
  const minor = parseLooseAmount(values.amount, currency);
  return minor === null ? values : { ...values, amount: groupedMajorString(minor, currency) };
}

/**
 * Whether a draft row's empty amount cell says nothing about the draft's figure: the cell never showed it
 * (`quickFromDraft`), so saving the row with the cell still empty must not write the figure away.
 */
export function keepsReadFigure(draft: DraftRow, values: QuickValues, today: string, accounts: readonly AccountRow[]): boolean {
  return draft.amountMinor !== 0 && values.amount.trim() === '' && quickFromDraft(draft, today, accounts).amount === '';
}

/** Reads the cells: either everything a purchase needs, or the list of what is missing, in cell order. */
export function readQuick(values: QuickValues, accounts: readonly AccountRow[], today: string, baseCurrency: string): { read: QuickRead; needs: [] } | { read: null; needs: string[] } {
  const account = accounts.find((a) => a.id === values.accountId);
  const currency = account?.currency ?? baseCurrency;
  const occurredOn = parseLooseDate(values.date, today);
  const amountMinor = parseLooseAmount(values.amount, currency);
  const needs: string[] = [];
  if (!occurredOn) needs.push('date');
  if (!values.description.trim()) needs.push('description');
  if (amountMinor === null) needs.push('amount');
  if (!account) needs.push('paid with');
  if (!accounts.some((a) => a.id === values.categoryId && a.kind === 'expense')) needs.push('category');
  if (needs.length > 0 || !occurredOn || amountMinor === null || !account) return { read: null, needs };
  return {
    read: { occurredOn, description: values.description.trim(), amountMinor, currency, accountId: account.id, cardId: values.cardId || null, categoryId: values.categoryId },
    needs: [],
  };
}

/**
 * What the ledger is given for a row. A purchase moved off a card leaves the card's own details behind;
 * one still on a card keeps what the row cannot show, such as its MCC.
 */
export function quickToInput(read: QuickRead, accounts: readonly AccountRow[]): {
  occurredOn: string;
  description: string;
  lines: PostingLine[];
  cardId?: string | null;
  mcc?: null;
  originalCurrency?: null;
  originalAmountMinor?: null;
} {
  const base = {
    occurredOn: read.occurredOn,
    description: read.description,
    lines: expenseLines({ categoryAccountId: read.categoryId, paymentAccountId: read.accountId, amountMinor: read.amountMinor, currency: read.currency }),
  };
  const onCard = accounts.find((a) => a.id === read.accountId)?.subtype === 'credit_card';
  if (!onCard) return { ...base, cardId: null, mcc: null, originalCurrency: null, originalAmountMinor: null };
  return { ...base, cardId: read.cardId };
}

/**
 * Accounts to pay with, as one list.
 *
 * An account with a single card is one choice, showing its digits; an account with none is one choice, itself. An
 * account carrying several cards offers **each card and nothing else**: the digits answer both questions at once.
 * The account alone — a row with no card label beside its primary and supplementary — was offered from 21 September
 * so a shared statement could be recorded without naming a card; the owner asked for it to go (15 October), since
 * it read as a third, plain card that does not exist.
 *
 * `keep` is the value a row already names, as a `paymentKey`. An older purchase recorded against such an account
 * with no card keeps its account alone as its current value, so it still shows what paid it; nothing else gets it.
 */
export function paymentOptions(accounts: readonly AccountRow[], cards: readonly CardRow[], keep = ''): PaymentOption[] {
  return accounts.flatMap((account): PaymentOption[] => {
    const own = cards.filter((card) => card.accountId === account.id);
    if (own.length < 2) {
      return [{ accountId: account.id, cardId: null, accountName: account.name, last4: own[0]?.last4 ?? null, holderName: null }];
    }
    const each = own.map((card): PaymentOption => ({ accountId: account.id, cardId: card.id, accountName: account.name, last4: card.last4, holderName: card.holderName }));
    if (keep !== account.id) return each;
    return [...each, { accountId: account.id, cardId: null, accountName: account.name, last4: null, holderName: null }];
  });
}

export const paymentKey = (accountId: string, cardId: string | null | undefined) => (cardId ? `${accountId}:${cardId}` : accountId);

/**
 * A placeholder — an account another member's purchase is posted against here, which this device's own list leaves
 * out (household sharing spec §4.4) — is never offered as a way to pay: only the one the row already names stays, as
 * its current value (final review, minor 2). `listed` is what this device lists; `current` the account the row names.
 */
export function withoutPlaceholders(options: readonly PaymentOption[], listed: ReadonlySet<string>, current: string): PaymentOption[] {
  return options.filter((option) => listed.has(option.accountId) || option.accountId === current);
}

/** How a row reads the placeholder it names: who paid, never an account of yours ("Dewi (IDR)"). */
export function placeholderLabel(memberName: string): string {
  return `Paid by ${memberName}`;
}

/**
 * The paid-with choices for one row: everything that can pay, and — always — the account the row already names.
 *
 * The cell says what paid, so it offers only what can: never a locked deposit, never a house. But a purchase
 * already recorded against one of those is a fact, and a cell that cannot show its own value reads as an error
 * and invites being saved over. `current` is that value as a `paymentKey` — the account, and the card on it if one
 * is named — kept whatever it is; pass an empty string for a row being typed from scratch, which has nothing to keep.
 */
export function payerOptions(accounts: readonly AccountRow[], cards: readonly CardRow[], current: string): PaymentOption[] {
  const [currentAccount = ''] = current.split(':');
  return paymentOptions(
    accounts.filter((account) => canPayWith(account, currentAccount)),
    cards,
    current,
  );
}

/**
 * Rows pasted from a spreadsheet, as cells. Text with no tab and no line break is an ordinary paste
 * into one cell and gives nothing back. A row that is blank throughout is skipped. Which cell is which is
 * `pastedCells`' work.
 */
export function parsePastedRows(text: string): string[][] {
  if (!/[\t\n]/.test(text.trim())) return [];
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.split('\t').map(cleanPastedCell))
    .filter((cells) => cells.some(Boolean));
}

/**
 * A cell as its words alone. Notion copies a relation or a link as "Name (https://www.notion.so/…)" or as
 * "[Name](https://…)": the link is left out, so the name is what is matched — in every column.
 */
export function cleanPastedCell(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\(\s*https?:\/\/[^)]*\)/gi, '$1')
    .replace(/\s*\(\s*https?:\/\/[^)]*\)/gi, '')
    .trim();
}

/**
 * Whether a paste is Notion's whole rows rather than their cells: its text has no tab (as "# Title", then the titles)
 * and its HTML is links to Notion pages. Read as cells it would land as notes; the table says how to copy cells instead.
 */
export function isNotionPageLinks(text: string, html: string): boolean {
  if (text.includes('\t') || !html) return false;
  return /<a\b[^>]*href=["']https?:\/\/(?:[a-z0-9-]+\.)?notion\.(?:so|com|site)\//i.test(html);
}

/** The line a Notion paste of whole rows gets, in place of rows made of its titles. */
export const NOTION_ROWS_LINE = 'Copied Notion rows, not cells — select the cells (click one, Shift-click the last) and copy again';

/**
 * A Paid with cell that is a card's last four digits — "4417", or after a mask: "····4417", "xxxx 4417", "**** 4417".
 * Null for anything else.
 */
export function lastFourOf(text: string): string | null {
  return /^(?:[·•.*xX]+\s*)?(\d{4})$/.exec(text.trim())?.[1] ?? null;
}

/**
 * The one way to pay whose last four are these digits: a card's own, else the account's number (the digits the app
 * already shows beside it, `numbers`). Several, or none, is no answer — the cell is left for the owner, never guessed.
 */
export function matchLastFour(digits: string, options: readonly PaymentOption[], numbers: Readonly<Record<string, string>> = {}): string | null {
  const hits = options.filter((option) => (option.last4 ?? numbers[option.accountId] ?? null) === digits);
  return hits.length === 1 ? paymentKey(hits[0]!.accountId, hits[0]!.cardId) : null;
}

/** One pasted row's cells, named. */
export interface PastedCells {
  date: string;
  description: string;
  amount: string;
  paid: string;
  category: string;
}

type PastedColumn = keyof PastedCells | 'countsAs';

/**
 * The columns a paste with no header row is read in: the order the table shows them, so a sheet laid out as the
 * table reads straight in. `row` is the list's (and the narrow table's) Date, Description, Amount, Paid with,
 * Category; `desk` the wide Cashflow's Date, Note, Category, Paid with, Amount — and with a sixth column, the one
 * before the amount is its Counts as, which is the category's own and is not read.
 */
export const PASTE_COLUMNS: Record<'row' | 'desk', readonly PastedColumn[]> = {
  row: ['date', 'description', 'amount', 'paid', 'category'],
  desk: ['date', 'description', 'category', 'paid', 'amount'],
};
const DESK_SIX: readonly PastedColumn[] = ['date', 'description', 'category', 'paid', 'countsAs', 'amount'];

/** A header row's names, in English and Indonesian, any case. */
const HEADER_NAMES: Record<string, PastedColumn> = {
  date: 'date',
  tanggal: 'date',
  tgl: 'date',
  note: 'description',
  notes: 'description',
  description: 'description',
  keterangan: 'description',
  // Notion's title column.
  name: 'description',
  title: 'description',
  category: 'category',
  kategori: 'category',
  'sub categories': 'category',
  'sub category': 'category',
  subcategory: 'category',
  subcategories: 'category',
  'sub-category': 'category',
  'sub-categories': 'category',
  'paid with': 'paid',
  account: 'paid',
  akun: 'paid',
  card: 'paid',
  bank: 'paid',
  amount: 'amount',
  jumlah: 'amount',
  nominal: 'amount',
  'counts as': 'countsAs',
};

const headerOf = (cell: string): PastedColumn | null => HEADER_NAMES[cell.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;

/**
 * A first row that names columns is a header — every cell in it a column's name, or at least two of them with others
 * the app does not know (left out): its names say which cell is which, in any order, and it is not a row to keep.
 */
function headerColumns(cells: readonly string[]): (PastedColumn | null)[] | null {
  const named = cells.map(headerOf);
  const known = named.filter((column) => column !== null).length;
  const filled = cells.filter(Boolean).length;
  return known > 0 && (known === filled || known >= 2) ? named : null;
}

/**
 * Pasted rows as named cells. A header row maps them by name; with none, they are read in `layout`'s visible order
 * (`PASTE_COLUMNS`), the wide table's six columns when the paste has six. Nothing is guessed: a cell sits where its
 * column says, and one that cannot be read is left for the row to show as missing.
 */
export function pastedCells(rows: readonly (readonly string[])[], layout: 'row' | 'desk'): PastedCells[] {
  if (rows.length === 0) return [];
  const header = headerColumns(rows[0]!);
  const body = header ? rows.slice(1) : rows;
  const wide = Math.max(...rows.map((cells) => cells.length));
  const columns: readonly (PastedColumn | null)[] = header ?? (layout === 'desk' && wide >= 6 ? DESK_SIX : PASTE_COLUMNS[layout]);
  return body.map((cells) => {
    const named: PastedCells = { date: '', description: '', amount: '', paid: '', category: '' };
    columns.forEach((column, i) => {
      // The first column of a name wins, should a header name one twice.
      if (column && column !== 'countsAs' && !named[column]) named[column] = cells[i] ?? '';
    });
    return named;
  });
}

/** Cells as pasted, into row values: a date read where it can be, the account and category matched by name. */
export function valuesFromCells(
  cells: PastedCells,
  resolve: { paid: (text: string) => string | null; category: (text: string) => string | null },
  today: string,
): QuickValues {
  const iso = parseLooseDate(cells.date, today);
  const [accountId = '', cardId = ''] = (resolve.paid(cells.paid) ?? '').split(':');
  return { date: iso ? shortDate(iso, today) : cells.date, description: cells.description, amount: cells.amount, accountId, cardId, categoryId: resolve.category(cells.category) ?? '' };
}
