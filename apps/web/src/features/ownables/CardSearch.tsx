import type { CatalogEntry } from '@expanses/catalog';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { InsetGroup, InsetRow, SearchField } from '../../ui/native';
import { searchCatalog } from '../cards/catalog-picker';

/**
 * Every card that answers the search, grouped by the bank that issues it, so the list reads the way a wallet does:
 * banks in order, and each bank's products in order under it.
 */
export function byIssuer(entries: readonly CatalogEntry[]): [string, CatalogEntry[]][] {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) groups.set(entry.bank, [...(groups.get(entry.bank) ?? []), entry]);
  return [...groups].map(([bank, list]): [string, CatalogEntry[]] => [bank, [...list].sort((a, b) => a.name.localeCompare(b.name))]).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The new card form's Card row, opened: one search over the catalogue's cards, and the answer is a row.
 *
 * It is a step of whatever holds it — the Paid with sheet moves to it, the Add debt page opens it over the form —
 * and knows nothing of either: a card picked or a name typed is handed back, and the holder goes back to its form.
 * Search finds a bank or a product by any of their words, as the catalogue picker on a card's page does. A card the
 * catalogue does not carry is not a dead end: the last row takes what was typed as its name.
 */
export function CardSearch({
  entries,
  chosenId,
  initialQuery = '',
  onPick,
  onTyped,
}: {
  /** The cards on offer: credit cards for a credit card. */
  entries: readonly CatalogEntry[];
  /** The catalogue card the form holds now, marked in the list. */
  chosenId: string | null;
  /** What the search opens with: the name already typed, so changing it starts from it. */
  initialQuery?: string;
  onPick: (entry: CatalogEntry) => void;
  onTyped: (name: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const typed = query.trim();
  const groups = byIssuer(searchCatalog(entries, query));
  return (
    <>
      <div className="mb-[12px]">
        {/* The keyboard comes up with the step: searching is the only thing to do here. */}
        <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Bank or card name" aria-label="Search cards" autoFocus enterKeyHint="search" />
      </div>
      {/* The list is the answer to what is typed above it, so a screen reader hears it change, not only sees it. */}
      <div aria-live="polite">
        {groups.map(([bank, list]) => (
          <InsetGroup key={bank} header={bank}>
            {list.map((entry) => (
              <InsetRow
                key={entry.id}
                title={entry.name}
                label={entry.name}
                value={entry.id === chosenId ? <Check size={18} aria-hidden /> : undefined}
                valueTone="tint"
                chevron={false}
                onClick={() => onPick(entry)}
              />
            ))}
          </InsetGroup>
        ))}
        {typed !== '' && (
          <InsetGroup
            footer={
              <>
                {groups.length === 0 && `Nothing in the catalogue matches “${typed}”. `}A card not in the catalogue keeps the name as typed, and its earn rules
                are set up on the card's page.
              </>
            }
          >
            <InsetRow title={`Use “${typed}” as the name`} action onClick={() => onTyped(typed)} />
          </InsetGroup>
        )}
      </div>
    </>
  );
}
