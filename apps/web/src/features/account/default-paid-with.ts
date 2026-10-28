import type { PaymentOption } from '@expanses/core';
import { type AccountRow, type CardRow, type Database, schema } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts } from '../../lib/queries';
import { useCards } from '../cards/card-queries';
import { paymentKey, paymentOptions } from '../transactions/quick-row';

/**
 * The Default Paid with: where a plain blank New transaction starts its Paid with row.
 *
 * Kept in the device's `settings` table, one row per workspace — accounts belong to a workspace, so a default
 * for one is no default for another — and written only by the Default page's ✓. A per-purchase change of Paid
 * never comes back here.
 */
export const defaultPaidWithKey = (workspaceId: string): string => `default_paid_with:${workspaceId}`;

/** The stored choice, as a `paymentKey` (an account, or `account:card`), or null while there is none. */
export async function readDefaultPaidWith(database: Database, workspaceId: string): Promise<string | null> {
  const rows = await database.db.select().from(schema.settings);
  return rows.find((row) => row.key === defaultPaidWithKey(workspaceId))?.value || null;
}

/** Saves the choice; null is saved as an empty value, which reads back as None. */
export async function writeDefaultPaidWith(database: Database, workspaceId: string, key: string | null): Promise<void> {
  const value = key ?? '';
  await database.db
    .insert(schema.settings)
    .values({ key: defaultPaidWithKey(workspaceId), value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

/**
 * Everything a purchase can be paid with, as the New transaction form's Paid with offers it in Expense mode: money
 * kept for spending and credit cards, a card per plastic where an account carries several. Archived accounts and
 * locked deposits are not among them.
 */
export function payableOptions(accounts: readonly AccountRow[], cards: readonly CardRow[]): PaymentOption[] {
  return paymentOptions(moneyHolders(accounts).filter((account) => canPayWith(account)), cards);
}

/**
 * The stored choice read against what can be paid with now: the option it names, or null when there is none, or
 * the account has since been archived, locked, removed or lost its card. Resolved at read time, so a default that
 * stopped being valid quietly reads as None and the form opens empty, exactly as it does without one.
 */
export function resolveDefaultPaidWith(stored: string | null | undefined, options: readonly PaymentOption[]): PaymentOption | null {
  if (!stored) return null;
  return options.find((option) => paymentKey(option.accountId, option.cardId) === stored) ?? null;
}

/** The raw stored key for this workspace. */
export function useStoredDefaultPaidWith() {
  const { database, ws } = useApp();
  return useQuery({ queryKey: ['default-paid-with', ws.workspaceId], queryFn: () => readDefaultPaidWith(database, ws.workspaceId) });
}

/** What can be paid with right now, and whether it has been read yet. */
export function usePayableOptions(): { options: PaymentOption[]; accounts: AccountRow[]; ready: boolean } {
  const accounts = useAccounts();
  const cards = useCards();
  const options = accounts.data && cards.data ? payableOptions(accounts.data, cards.data as CardRow[]) : [];
  return { options, accounts: accounts.data ?? [], ready: accounts.isSuccess && cards.isSuccess };
}
