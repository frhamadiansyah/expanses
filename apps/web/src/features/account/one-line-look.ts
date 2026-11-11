import { type Database, schema } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';

/**
 * How One line looks on Cashflow, chosen in Settings › Default. 'card' is a white card above the keyboard with the row
 * as it will be saved and a round field under it; 'plain' is one flat bar on the keyboard with the field alone.
 *
 * Kept in the device's `settings` table, one row for the device, as the hold's choice is (`hold-plus.ts`).
 */
export type OneLineLook = 'card' | 'plain';

export const ONE_LINE_LOOK_KEY = 'one_line_look';
const DEFAULT_LOOK: OneLineLook = 'card';

export const ONE_LINE_LOOKS: readonly { value: OneLineLook; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'plain', label: 'Plain' },
];

/** A stored value as a look: anything unknown, or nothing, is the card. */
export function toOneLineLook(value: string | null | undefined): OneLineLook {
  return ONE_LINE_LOOKS.some((look) => look.value === value) ? (value as OneLineLook) : DEFAULT_LOOK;
}

export async function readOneLineLook(database: Database): Promise<OneLineLook> {
  const rows = await database.db.select().from(schema.settings);
  return toOneLineLook(rows.find((row) => row.key === ONE_LINE_LOOK_KEY)?.value);
}

export async function writeOneLineLook(database: Database, look: OneLineLook): Promise<void> {
  await database.db
    .insert(schema.settings)
    .values({ key: ONE_LINE_LOOK_KEY, value: look })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: look } });
}

export function useOneLineLook() {
  const { database } = useApp();
  return useQuery({ queryKey: ['one-line-look'], queryFn: () => readOneLineLook(database) });
}
