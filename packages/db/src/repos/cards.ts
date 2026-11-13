import { uuidv7 } from '@expanses/core';
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db, Tx } from '../database';
import { accounts } from '../schema';
import { type AccountRow, createAccountTx } from './accounts';
import { cardIdentity, cards } from '../schema-cards';
import { markAccountDirtyTx, markAccountFamilyDirtyTx } from '../sync/capture';

export class CardError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CardError';
  }
}

export interface CardRow {
  id: string;
  accountId: string;
  last4: string | null;
  holderName: string | null;
  isPrimary: boolean;
  /** Put away: listed only when `listCards` is asked `withArchived`, for what an older row named. */
  archived?: boolean;
}

export interface CardIdentityRow {
  accountId: string;
  issuer: string | null;
}

const FOUR_DIGITS = /^\d{4}$/;

/** The bank behind a card account. */
export async function saveCardIdentity(database: Database, ws: WorkspaceContext, input: { accountId: string; issuer: string | null }): Promise<void> {
  await database.db
    .insert(cardIdentity)
    .values({ accountId: input.accountId, workspaceId: ws.workspaceId, issuer: input.issuer })
    .onConflictDoUpdate({ target: cardIdentity.accountId, set: { issuer: input.issuer } });
}

export async function listCardIdentities(database: Database, ws: WorkspaceContext): Promise<CardIdentityRow[]> {
  return database.db
    .select({ accountId: cardIdentity.accountId, issuer: cardIdentity.issuer })
    .from(cardIdentity)
    .where(eq(cardIdentity.workspaceId, ws.workspaceId));
}

/** The issuers a workspace already uses, so the picker offers them beside the catalogue's own. */
export async function listIssuers(database: Database, ws: WorkspaceContext): Promise<string[]> {
  const rows = await database.db
    .select({ issuer: cardIdentity.issuer })
    .from(cardIdentity)
    .where(eq(cardIdentity.workspaceId, ws.workspaceId));
  return [...new Set(rows.flatMap((row) => (row.issuer ? [row.issuer] : [])))].sort();
}

/**
 * The plastic in a workspace, or on one account. A digital wallet's row is never among them: it holds the last four
 * digits of the wallet's phone number (`setWalletLast4`), which is no card — so no card list, card chooser, statement
 * or duplicate check ever counts it as one.
 *
 * Archived cards are left out unless asked for `withArchived`: a list of transactions asks, so a row that named a card
 * since put away still reads that card's digits rather than none, or another card's.
 */
export async function listCards(database: Database, ws: WorkspaceContext, accountId?: string, options: { withArchived?: boolean } = {}): Promise<CardRow[]> {
  const rows = await database.db
    .select({ id: cards.id, accountId: cards.accountId, last4: cards.last4, holderName: cards.holderName, isPrimary: cards.isPrimary, archivedAt: cards.archivedAt })
    .from(cards)
    .innerJoin(accounts, eq(accounts.id, cards.accountId))
    .where(
      and(
        eq(cards.workspaceId, ws.workspaceId),
        ...(options.withArchived ? [] : [isNull(cards.archivedAt)]),
        ne(accounts.subtype, 'ewallet'),
        ...(accountId ? [eq(cards.accountId, accountId)] : []),
      ),
    )
    .orderBy(asc(cards.isPrimary), asc(cards.createdAt));
  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    last4: row.last4,
    holderName: row.holderName,
    isPrimary: row.isPrimary === 1,
    // Said only when archived cards were asked for: everywhere else every card listed is in use.
    ...(options.withArchived ? { archived: row.archivedAt !== null } : {}),
  }));
}

/**
 * The last four digits of each digital wallet's phone number, by account. A wallet is usually tied to a phone number,
 * and those digits tell two wallets of one app apart the way a card's tell two cards apart. They are kept as the
 * wallet's one primary `cards` row, which `listCards` leaves out.
 */
export async function listWalletLast4(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  const rows = await database.db
    .select({ accountId: cards.accountId, last4: cards.last4 })
    .from(cards)
    .innerJoin(accounts, eq(accounts.id, cards.accountId))
    .where(and(eq(cards.workspaceId, ws.workspaceId), isNull(cards.archivedAt), isNotNull(cards.last4), eq(accounts.subtype, 'ewallet')))
    .orderBy(asc(cards.isPrimary), asc(cards.createdAt));
  // Ordered so the primary, and then the newest, is the one that stays.
  return Object.fromEntries(rows.map((row) => [row.accountId, row.last4!]));
}

/**
 * Records, changes or (with null or blanks) clears the last four digits of a digital wallet's phone number.
 *
 * Unlike a card's, they are never refused as typed twice: two wallets on one phone — two apps, one number — carry the
 * same digits, and that is the truth of it. They live on one row per wallet, changed in place: no transaction ever names
 * a wallet's row, so there is nothing an older value must stay with, and archived rows would only pile up. The account
 * is marked changed, so a wallet shared in a net-worth group sends its item again, under the name with its new digits.
 */
export async function setWalletLast4(database: Database, ws: WorkspaceContext, accountId: string, last4: string | null): Promise<void> {
  const digits = last4?.trim() || null;
  if (digits !== null && !FOUR_DIGITS.test(digits)) throw new CardError('LAST4', 'Last four digits are four numbers, like 1467');
  await database.transaction(async (tx) => {
    const [account] = await tx
      .select({ subtype: accounts.subtype })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new CardError('NOT_FOUND', 'That account is not in this workspace');
    if (account.subtype !== 'ewallet') throw new CardError('NOT_A_WALLET', 'Only a digital wallet keeps the last four digits of a phone number');

    const held = await tx
      .select({ id: cards.id, last4: cards.last4 })
      .from(cards)
      .where(and(eq(cards.workspaceId, ws.workspaceId), eq(cards.accountId, accountId), isNull(cards.archivedAt)))
      .orderBy(desc(cards.isPrimary), asc(cards.createdAt));
    const [kept, ...extra] = held;
    if (kept?.last4 === digits && extra.length === 0) return;
    if (kept) await tx.update(cards).set({ last4: digits, isPrimary: 1 }).where(eq(cards.id, kept.id));
    else if (digits !== null) await insertWalletRowTx(tx, ws, accountId, digits);
    // Only ever one: any other row a wallet carries (from an earlier build) is put away.
    for (const row of extra) await tx.update(cards).set({ archivedAt: new Date().toISOString() }).where(eq(cards.id, row.id));
    markAccountDirtyTx(tx, accountId);
  });
}

/** The kinds of account whose number a bank names: a bank account and a savings account. */
export const NUMBERED_SUBTYPES: readonly string[] = ['bank', 'savings'];

/**
 * Records, changes or (with null or blanks) clears the last four digits of a bank account's number — how its alerts and
 * statements name it ("rek ****1234"). Its cards keep their own digits; these are the account's.
 */
export async function setAccountNumberLast4(database: Database, ws: WorkspaceContext, accountId: string, last4: string | null): Promise<void> {
  const digits = last4?.trim() || null;
  if (digits !== null && !FOUR_DIGITS.test(digits)) throw new CardError('LAST4', 'Last four digits are four numbers, like 1467');
  await database.transaction(async (tx) => {
    const [account] = await tx
      .select({ subtype: accounts.subtype })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new CardError('NOT_FOUND', 'That account is not in this workspace');
    if (!NUMBERED_SUBTYPES.includes(account.subtype)) throw new CardError('NOT_A_BANK', 'Only a bank or savings account keeps the last four digits of its number');
    if (!(await numberColumnExists(tx))) return;
    await tx.run(sql`UPDATE accounts SET number_last4 = ${digits} WHERE id = ${accountId}`);
    // A joint pocket's face carries its account's digits too.
    await markAccountFamilyDirtyTx(tx, accountId);
  });
}

/*
 * The column is read and written by name, never through the table's schema: a database stopped before 0080 has no
 * number_last4, and every insert the schema writes would name it. Asked once per handle, and only a yes is kept.
 */
const numberColumn = new WeakMap<object, boolean>();
export async function numberColumnExists(tx: Db): Promise<boolean> {
  if (numberColumn.get(tx)) return true;
  const rows = await tx.values<[number]>(sql`SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'number_last4'`);
  if (rows.length > 0) numberColumn.set(tx, true);
  return rows.length > 0;
}

/**
 * The money accounts whose number is kept only as the tax report's "Account number" (the kas row's `acct`): a broker's
 * cash account, whose Settings asks for its number there and nowhere else (`setAccountNumberLast4` refuses it).
 */
const TAX_NUMBERED_SUBTYPES: readonly string[] = ['fund'];

/** The last four digits of a whole number as typed ("0072-1938-5046" → "5046"), or null with fewer than four. */
function lastFourOf(number: string | null | undefined): string | null {
  const digits = (number ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * Each money account's number digits, by account id: what its rows and pickers show as "···· 1234" when no card paid.
 * A bank or savings account's are its own (0080). A fund account's are read off its tax report's account number, the
 * one place its number is typed — display only: nothing is written, so nothing new travels between phones, and a
 * bank alert is still filed only by a bank account's own digits.
 */
export async function accountNumberLast4s(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  const digits: Record<string, string> = {};
  const types = sql.join(TAX_NUMBERED_SUBTYPES.map((subtype) => sql`${subtype}`), sql`, `);
  const taxed = await database.db.values<[string, string]>(
    sql`SELECT a.id, p.coretax_fields_json FROM accounts a JOIN asset_profiles p ON p.account_id = a.id
        WHERE a.workspace_id = ${ws.workspaceId} AND a.subtype IN (${types}) AND a.archived_at IS NULL`,
  );
  for (const [id, json] of taxed) {
    let acct: unknown;
    try {
      acct = (JSON.parse(json) as { acct?: unknown }).acct;
    } catch {
      continue; // a profile whose fields cannot be read shows no digits
    }
    const last4 = typeof acct === 'string' ? lastFourOf(acct) : null;
    if (last4) digits[id] = last4;
  }
  if (!(await numberColumnExists(database.db))) return digits;
  const rows = await database.db.values<[string, string]>(
    sql`SELECT id, number_last4 FROM accounts WHERE workspace_id = ${ws.workspaceId} AND number_last4 IS NOT NULL AND archived_at IS NULL`,
  );
  return { ...digits, ...Object.fromEntries(rows) };
}

/** A wallet's one row for its phone digits: never a card, so never through `addCard`. */
async function insertWalletRowTx(tx: Tx, ws: WorkspaceContext, accountId: string, last4: string): Promise<void> {
  await tx.insert(cards).values({
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    accountId,
    last4,
    holderName: null,
    isPrimary: 1,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Adds a physical card to an account.
 *
 * Last four digits repeat across banks — a Mandiri card and a BCA card can both end 1467 — so they
 * are unique per issuer rather than per workspace, which is the only reading under which they
 * identify anything.
 */
export async function addCard(
  database: Database,
  ws: WorkspaceContext,
  input: { accountId: string; last4?: string | null; holderName?: string | null; isPrimary?: boolean },
): Promise<string> {
  const last4 = input.last4?.trim() || null;
  if (last4 !== null && !FOUR_DIGITS.test(last4)) throw new CardError('LAST4', 'Last four digits are four numbers, like 1467');

  const [account] = await database.db
    .select({ id: accounts.id, subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, input.accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) throw new CardError('NOT_FOUND', 'That account is not in this workspace');
  // A wallet's phone digits are kept by `setWalletLast4`, never as a card.
  if (account.subtype !== 'credit_card' && account.subtype !== 'bank') throw new CardError('NOT_A_CARD', 'Only a credit card or a bank account carries cards');

  if (last4 !== null) {
    const issuerOf = new Map((await listCardIdentities(database, ws)).map((row) => [row.accountId, row.issuer]));
    const issuer = issuerOf.get(input.accountId) ?? null;
    for (const existing of await listCards(database, ws)) {
      if (existing.last4 !== last4) continue;
      if ((issuerOf.get(existing.accountId) ?? null) === issuer) {
        throw new CardError('DUPLICATE', `A card ending ${last4} is already recorded${issuer ? ` for ${issuer}` : ''}`);
      }
    }
  }

  const id = uuidv7();
  await database.db.insert(cards).values({
    id,
    workspaceId: ws.workspaceId,
    accountId: input.accountId,
    last4,
    holderName: input.holderName?.trim() || null,
    isPrimary: input.isPrimary ? 1 : 0,
    archivedAt: null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

/**
 * Opens an account and records what is known about the card on it, as one step.
 *
 * The name is the owner's own, as it always was. The bank is optional — applying a catalogue entry
 * fills it in later — and the plastic is recorded only when there is something to record.
 *
 * The duplicate check runs before the transaction opens: inside one, only the transaction handle may
 * be used, and a read through the database handle there deadlocks.
 */
export async function createCardAccount(
  database: Database,
  ws: WorkspaceContext,
  input: {
    name: string;
    subtype: 'credit_card' | 'bank';
    currency: string;
    issuer?: string | null;
    last4?: string | null;
    holderName?: string | null;
    openingBalanceMinor?: number;
    openedOn?: string;
    openingRateToBase?: number;
  },
): Promise<AccountRow> {
  const issuer = input.issuer?.trim() || null;
  const last4 = input.last4?.trim() || null;
  const holderName = input.holderName?.trim() || null;
  if (last4 !== null && !FOUR_DIGITS.test(last4)) throw new CardError('LAST4', 'Last four digits are four numbers, like 1467');

  if (last4 !== null) {
    const issuerOf = new Map((await listCardIdentities(database, ws)).map((row) => [row.accountId, row.issuer]));
    for (const existing of await listCards(database, ws)) {
      if (existing.last4 === last4 && (issuerOf.get(existing.accountId) ?? null) === issuer) {
        throw new CardError('DUPLICATE', `A card ending ${last4} is already recorded${issuer ? ` for ${issuer}` : ''}`);
      }
    }
  }

  return database.transaction(async (tx) => {
    const account = await createAccountTx(tx, ws, {
      name: input.name,
      kind: input.subtype === 'credit_card' ? 'liability' : 'asset',
      subtype: input.subtype,
      currency: input.currency,
      openingBalanceMinor: input.openingBalanceMinor,
      openedOn: input.openedOn,
      openingRateToBase: input.openingRateToBase,
    });
    if (issuer !== null) {
      await tx.insert(cardIdentity).values({ accountId: account.id, workspaceId: ws.workspaceId, issuer });
    }
    if (last4 !== null || holderName !== null) {
      await tx.insert(cards).values({
        id: uuidv7(),
        workspaceId: ws.workspaceId,
        accountId: account.id,
        last4,
        holderName,
        isPrimary: 1,
        archivedAt: null,
        createdAt: new Date().toISOString(),
      });
    }
    return account;
  });
}

export async function archiveCard(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.db
    .update(cards)
    .set({ archivedAt: new Date().toISOString() })
    .where(and(eq(cards.workspaceId, ws.workspaceId), eq(cards.id, id)));
}

/**
 * Puts right a card's last four digits and whose card it is. Which plastic is primary is untouched. The digits are
 * unique per issuer, as `addCard` keeps them; the card itself is not its own duplicate.
 */
export async function updateCard(
  database: Database,
  ws: WorkspaceContext,
  input: { cardId: string; last4?: string | null; holderName?: string | null },
): Promise<void> {
  const last4 = input.last4?.trim() || null;
  if (last4 !== null && !FOUR_DIGITS.test(last4)) throw new CardError('LAST4', 'Last four digits are four numbers, like 1467');
  const [own] = await database.db
    .select({ id: cards.id, accountId: cards.accountId })
    .from(cards)
    .where(and(eq(cards.id, input.cardId), eq(cards.workspaceId, ws.workspaceId), isNull(cards.archivedAt)));
  if (!own) throw new CardError('NOT_FOUND', 'That card is not in this workspace');

  if (last4 !== null) {
    const issuerOf = new Map((await listCardIdentities(database, ws)).map((row) => [row.accountId, row.issuer]));
    const issuer = issuerOf.get(own.accountId) ?? null;
    for (const existing of await listCards(database, ws)) {
      if (existing.id === own.id || existing.last4 !== last4) continue;
      if ((issuerOf.get(existing.accountId) ?? null) === issuer) {
        throw new CardError('DUPLICATE', `A card ending ${last4} is already recorded${issuer ? ` for ${issuer}` : ''}`);
      }
    }
  }
  await database.db
    .update(cards)
    .set({ last4, holderName: input.holderName?.trim() || null })
    .where(and(eq(cards.workspaceId, ws.workspaceId), eq(cards.id, own.id)));
}
