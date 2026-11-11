import { type Database, schema } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/**
 * What holding the tab bar's ＋ does on the Cashflow page, chosen in Settings › Default. Everywhere else a hold is a
 * tap: the full Add form.
 *
 * Kept in the device's `settings` table beside the Default Paid with, one row for the device rather than one per
 * workspace: it is how a thumb is used, not anything about a workspace's money.
 */
export type HoldChoice = 'line' | 'scan' | 'paste' | 'menu' | 'off';

/** What a hold does once read against the page it is on. 'form' is the same as a tap. */
export type HoldAction = 'form' | 'line' | 'scan' | 'paste' | 'menu';

export const HOLD_PLUS_KEY = 'hold_plus_cashflow';
const DEFAULT_CHOICE: HoldChoice = 'line';

export const HOLD_CHOICES: readonly { value: HoldChoice; label: string }[] = [
  { value: 'line', label: 'One line' },
  { value: 'scan', label: 'Scan a receipt' },
  { value: 'paste', label: 'Paste a list' },
  { value: 'menu', label: 'Show the menu' },
  { value: 'off', label: 'Off' },
];

/** A stored value as a choice: anything unknown, or nothing, is the default. */
export function toHoldChoice(value: string | null | undefined): HoldChoice {
  return HOLD_CHOICES.some((choice) => choice.value === value) ? (value as HoldChoice) : DEFAULT_CHOICE;
}

export async function readHoldChoice(database: Database): Promise<HoldChoice> {
  const rows = await database.db.select().from(schema.settings);
  return toHoldChoice(rows.find((row) => row.key === HOLD_PLUS_KEY)?.value);
}

export async function writeHoldChoice(database: Database, choice: HoldChoice): Promise<void> {
  await database.db
    .insert(schema.settings)
    .values({ key: HOLD_PLUS_KEY, value: choice })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: choice } });
}

export function useHoldChoice() {
  const { database } = useApp();
  return useQuery({ queryKey: ['hold-plus'], queryFn: () => readHoldChoice(database) });
}

/**
 * The hold on this page: the chosen action on Cashflow's list (`/transactions`) alone; a tap everywhere else, with Off,
 * and in a read-only workspace, where the form already says why nothing can be added. Not read yet (the first moment
 * after the app opens) is a tap too, rather than a guess that might not be what was chosen.
 */
export function holdAction(choice: HoldChoice | undefined, pathname: string, readOnly: boolean): HoldAction {
  const onCashflow = pathname.replace(/\/+$/, '') === '/transactions';
  if (!onCashflow || readOnly || choice === undefined || choice === 'off') return 'form';
  return choice;
}
