import { type DebtDirection, type DebtStatus, type DueState, dueLabel, dueStateFor, statusFor } from '@expanses/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { debtProfiles } from '../schema-debts';

export interface PersonLoanRow {
  accountId: string;
  reason: string | null;
  /** The day the first money moved on this account. */
  openedOn: string;
  originalMinor: number;
  balanceMinor: number;
  repaidMinor: number;
  dueOn: string | null;
  dueState: DueState;
  /** The due date in words: "Due in 6 days", "11 days overdue". Empty when there is no date. */
  dueLabel: string;
  status: DebtStatus;
  currency: string;
}

export interface PersonDebtRow {
  personName: string;
  direction: DebtDirection;
  currency: string;
  totalMinor: number;
  loans: PersonLoanRow[];
  /** The worst state across their open loans, for the pill on the card. */
  dueState: DueState;
}

export interface PeopleDebts {
  owedToYou: PersonDebtRow[];
  youOwe: PersonDebtRow[];
  settled: PersonDebtRow[];
}

const DIRECTION_BY_SUBTYPE: Record<string, DebtDirection> = { receivable: 'lent', payable: 'borrowed' };
/** Worst first, so a person card shows the state that needs attention soonest. */
const DUE_ORDER: DueState[] = ['overdue', 'due_soon', 'none'];

const worst = (states: DueState[]): DueState => DUE_ORDER.find((state) => states.includes(state)) ?? 'none';

/**
 * Every person the workspace owes or is owed by, one card each however many loans they hold.
 * Balances come from the ledger, so a voided transaction simply stops counting.
 */
export async function peopleDebts(database: Database, ws: WorkspaceContext, onDate: string): Promise<PeopleDebts> {
  const profiles = await database.db
    .select()
    .from(debtProfiles)
    .where(eq(debtProfiles.workspaceId, ws.workspaceId))
    .orderBy(asc(debtProfiles.personName), asc(debtProfiles.createdAt));
  if (profiles.length === 0) return { owedToYou: [], youOwe: [], settled: [] };

  const accountIds = profiles.map((profile) => profile.accountId);
  const accountRows = await database.db
    .select({ id: accounts.id, subtype: accounts.subtype, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, accountIds)));
  const accountById = new Map(accountRows.map((row) => [row.id, row]));

  const lines = await database.db
    .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, occurredOn: transactions.occurredOn })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(entries.accountId, accountIds)));

  const loans: (PersonLoanRow & { personName: string; direction: DebtDirection })[] = [];
  for (const profile of profiles) {
    const account = accountById.get(profile.accountId);
    if (!account) continue;
    const direction = DIRECTION_BY_SUBTYPE[account.subtype] ?? 'lent';
    const own = lines.filter((line) => line.accountId === profile.accountId && line.occurredOn <= onDate);
    // A receivable rises on a loan and falls on a repayment; a payable does the opposite.
    const sign = direction === 'lent' ? 1 : -1;
    const originalMinor = own.filter((line) => line.amountMinor * sign > 0).reduce((total, line) => total + line.amountMinor * sign, 0);
    const balanceMinor = own.reduce((total, line) => total + line.amountMinor * sign, 0);
    const status = statusFor(balanceMinor, profile.status);
    const openedOn = own.map((line) => line.occurredOn).sort()[0] ?? profile.createdAt.slice(0, 10);
    loans.push({
      personName: profile.personName,
      direction,
      accountId: profile.accountId,
      reason: profile.reason,
      openedOn,
      originalMinor,
      balanceMinor: Math.max(0, balanceMinor),
      repaidMinor: originalMinor - Math.max(0, balanceMinor),
      dueOn: profile.dueOn,
      dueState: dueStateFor(profile.dueOn, onDate, status),
      dueLabel: dueLabel(profile.dueOn, onDate, status),
      status,
      currency: account.currency ?? ws.baseCurrency,
    });
  }

  const byPerson = new Map<string, PersonDebtRow>();
  for (const loan of loans) {
    const { personName, direction, ...row } = loan;
    // One card per person per direction: money you lent Andi is not netted against money he lent you.
    const key = `${direction}:${personName}`;
    const card = byPerson.get(key) ?? { personName, direction, currency: row.currency, totalMinor: 0, loans: [], dueState: 'none' as DueState };
    card.loans.push(row);
    card.totalMinor += row.balanceMinor;
    card.dueState = worst(card.loans.map((one) => one.dueState));
    byPerson.set(key, card);
  }

  const cards = [...byPerson.values()];
  const open = (card: PersonDebtRow) => card.loans.some((loan) => loan.status === 'open');
  return {
    owedToYou: cards.filter((card) => card.direction === 'lent' && open(card)),
    youOwe: cards.filter((card) => card.direction === 'borrowed' && open(card)),
    settled: cards.filter((card) => !open(card)),
  };
}

export interface RecentPersonRow {
  accountId: string;
  personName: string;
  direction: DebtDirection;
  currency: string;
  /** The last day money moved on their account: what "recent" means here. */
  lastOn: string;
}

/** Who to offer as a chip under With: people already on the books, the most recently used first. */
export async function recentPeople(database: Database, ws: WorkspaceContext, limit = 8): Promise<RecentPersonRow[]> {
  const profiles = await database.db
    .select({ accountId: debtProfiles.accountId, personName: debtProfiles.personName, createdAt: debtProfiles.createdAt })
    .from(debtProfiles)
    .where(eq(debtProfiles.workspaceId, ws.workspaceId));
  if (profiles.length === 0) return [];

  const accountIds = profiles.map((profile) => profile.accountId);
  const accountRows = await database.db
    .select({ id: accounts.id, subtype: accounts.subtype, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, accountIds)));
  const accountById = new Map(accountRows.map((row) => [row.id, row]));

  // The newest posted movement on each account; a person nothing has happened on yet has none.
  const movement = await database.db
    .select({ accountId: entries.accountId, lastOn: sql<string>`max(${transactions.occurredOn})` })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), inArray(entries.accountId, accountIds)))
    .groupBy(entries.accountId);
  const lastMovedOn = new Map(movement.map((row) => [row.accountId, row.lastOn]));

  return profiles
    .map((profile) => {
      const account = accountById.get(profile.accountId);
      return {
        accountId: profile.accountId,
        personName: profile.personName,
        direction: DIRECTION_BY_SUBTYPE[account?.subtype ?? ''] ?? 'lent',
        currency: account?.currency ?? ws.baseCurrency,
        // No movement yet: fall back to the day the profile was opened.
        lastOn: lastMovedOn.get(profile.accountId) ?? profile.createdAt.slice(0, 10),
      };
    })
    .sort((a, b) => (a.lastOn === b.lastOn ? a.personName.localeCompare(b.personName) : a.lastOn < b.lastOn ? 1 : -1))
    .slice(0, limit);
}

export interface DebtHistoryRow {
  transactionId: string;
  occurredOn: string;
  kind: 'lend' | 'repayment' | 'forgive';
  amountMinor: number;
  interestMinor: number;
}

/** What happened on one person's account, oldest first. Voided transactions are left out. */
export async function debtHistory(database: Database, ws: WorkspaceContext, accountId: string): Promise<DebtHistoryRow[]> {
  const [account] = await database.db
    .select({ subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) return [];
  const sign = (DIRECTION_BY_SUBTYPE[account.subtype] ?? 'lent') === 'lent' ? 1 : -1;

  const own = await database.db
    .select({ transactionId: entries.transactionId, amountMinor: entries.amountMinor, occurredOn: transactions.occurredOn, description: transactions.description })
    .from(entries)
    .innerJoin(transactions, eq(entries.transactionId, transactions.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), eq(transactions.status, 'posted'), eq(entries.accountId, accountId)))
    .orderBy(asc(transactions.occurredOn), asc(entries.id));
  if (own.length === 0) return [];

  // Interest rides on the same transaction as the repayment it belongs to, on an income or expense line.
  const others = await database.db
    .select({ transactionId: entries.transactionId, amountMinor: entries.amountMinor, kind: accounts.kind })
    .from(entries)
    .innerJoin(accounts, eq(entries.accountId, accounts.id))
    .where(and(eq(entries.workspaceId, ws.workspaceId), inArray(entries.transactionId, own.map((row) => row.transactionId))));

  return own.map((row) => {
    const signed = row.amountMinor * sign;
    const sides = others.filter((other) => other.transactionId === row.transactionId);
    const forgiven = signed < 0 && sides.some((side) => side.kind === 'expense' && side.amountMinor > 0);
    const interest = sides
      .filter((side) => side.kind === 'income' || side.kind === 'expense')
      .filter(() => !forgiven)
      .reduce((total, side) => total + Math.abs(side.amountMinor), 0);
    return {
      transactionId: row.transactionId,
      occurredOn: row.occurredOn,
      kind: signed > 0 ? 'lend' : forgiven ? 'forgive' : 'repayment',
      amountMinor: Math.abs(signed),
      interestMinor: signed < 0 && !forgiven ? interest : 0,
    };
  });
}
