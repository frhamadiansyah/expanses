import { uuidv7 } from '@expanses/core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts } from '../schema';
import { type AccountRow, createAccountTx } from './accounts';
import { cardIdentity, cards } from '../schema-cards';

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

export async function listCards(database: Database, ws: WorkspaceContext, accountId?: string): Promise<CardRow[]> {
  const rows = await database.db
    .select()
    .from(cards)
    .where(
      and(
        eq(cards.workspaceId, ws.workspaceId),
        isNull(cards.archivedAt),
        ...(accountId ? [eq(cards.accountId, accountId)] : []),
      ),
    )
    .orderBy(asc(cards.isPrimary), asc(cards.createdAt));
  return rows.map((row) => ({ id: row.id, accountId: row.accountId, last4: row.last4, holderName: row.holderName, isPrimary: row.isPrimary === 1 }));
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
