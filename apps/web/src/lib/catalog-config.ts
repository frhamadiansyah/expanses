import type { CatalogEntry } from '@expanses/catalog';

/** Address that receives catalogue change reports. Null until one is chosen; the report button stays hidden. */
export const CATALOG_REPORT_EMAIL: string | null = null;

export const shouldShowReport = (email: string | null): email is string => typeof email === 'string' && email.trim().length > 0;

/** A prefilled email identifying the entry, with blanks for the change and its source. It carries nothing from the user's ledger. */
export function reportMailto(email: string, entry: CatalogEntry): string {
  const subject = `Catalogue change: ${entry.name} (${entry.id} v${entry.entryVersion})`;
  const body = [
    `Card: ${entry.name}`,
    `Entry: ${entry.id}`,
    `Entry version: ${entry.entryVersion}`,
    `Verified on: ${entry.verifiedOn}`,
    '',
    'What changed:',
    '',
    '',
    'Source link (bank page or PDF):',
    '',
  ].join('\n');
  return `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
