import type { CatalogEntry } from '@expanses/catalog';
import { applyCatalogEntry, setCatalogCategoryChoice } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import type { CardPage, Run } from './card-page';

/**
 * Choosing a card from the catalogue and applying it, wherever the catalogue is offered: the setup steps, the card
 * product page, the earning rules. And the question every change to a catalogue card asks first.
 */
export function useCatalogChoice(page: CardPage | null, run: Run, options: { onFixedStatementDay?: (day: number) => void; onApplied?: () => void } = {}) {
  const { database, ws } = useApp();
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const confirmCustomise = () =>
    !page ||
    page.cp.catalog.status !== 'linked' ||
    window.confirm(`${page.card.name} follows the catalogue. Changing it makes it customised: catalogue updates stop applying automatically and wait for review. Continue?`);
  const chooseEntry = (entry: CatalogEntry) => {
    setCatalogId(entry.id);
    // Some issuers close every cardholder's statement on the same day.
    if (page && !page.cp.terms && entry.program.fixedStatementDay) options.onFixedStatementDay?.(entry.program.fixedStatementDay);
  };
  const applyEntry = (entry: CatalogEntry, memberLevel: string | null = null, categoryOption: string | null = null) => {
    if (!page) return;
    const manual = page.cp.rules.length;
    if (manual > 0 && !window.confirm(`Replace the ${manual} earn rule${manual === 1 ? '' : 's'} with the catalogue terms for ${entry.name}?`)) return;
    void run(async () => {
      const { programId } = await applyCatalogEntry(database, ws, { cardAccountId: page.card.id, entry, today: page.today, replaceManual: manual > 0, memberLevel });
      // The first pick runs from the start of the card, so every cycle already recorded is covered by it.
      if (categoryOption) await setCatalogCategoryChoice(database, ws, programId, categoryOption, page.today, page.today);
    }).then((applied) => {
      if (applied) options.onApplied?.();
    });
  };
  // A card linked to the catalogue or customised from it is changed through its catalogue terms instead.
  const canUseCatalog = !!page && (!page.cp.program || page.cp.catalog.status === null);
  return { catalogId, chooseEntry, applyEntry, confirmCustomise, canUseCatalog };
}
