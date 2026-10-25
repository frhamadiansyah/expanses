import { CATALOG, type CatalogEntry } from '@expanses/catalog';
import { isoDate } from '@expanses/core';
import { applyCatalogEntry, type AccountRow, type RewardProgramRow } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { Sheet, SheetSearchButton } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { SearchPill } from '../../ui/native';
import { debitEntries, memberLevelsOf, searchCatalog } from './catalog-picker';

const LIST = 'overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li>button>.ph-row-body]:border-t-[0.5px] [&>li+li>button>.ph-row-body]:border-[var(--ph-hair)]';

function Row({ label, detail, current = false, icon, onClick }: { label: string; detail?: string; current?: boolean; icon?: React.ReactNode; onClick: () => void }) {
  return (
    <li>
      <button type="button" aria-label={label} aria-current={current ? 'true' : undefined} onClick={onClick} className="ph-focus-inset flex w-full items-center gap-[10px] pl-[14px] text-left active:bg-[var(--ph-fill)]">
        <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-[13px]">
          <span className="min-w-0 flex-1 truncate text-[17px] text-[var(--ph-ink)]">{label}</span>
          {detail ? <span aria-hidden className="shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">{detail}</span> : null}
          {current ? <Check size={17} aria-hidden className="shrink-0 text-[var(--ph-tint)]" /> : icon}
        </span>
      </button>
    </li>
  );
}

/**
 * A bank account's Card rewards, as one sheet: a searchable list of the catalogue's debit cards, where choosing one
 * links the account to its programme and closes the sheet. A card that is not listed is set up by hand on its page,
 * the list's last row; one already linked is marked, with the way to its page (the rules) before the list.
 */
export function CardRewardsSheet({ account, program, onDone, onClose, onError }: { account: AccountRow; program: RewardProgramRow | undefined; onDone: () => Promise<void>; onClose: () => void; onError: (error: unknown) => void }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [finding, setFinding] = useState(false);
  const [leveling, setLeveling] = useState<CatalogEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const openPage = () => {
    onClose();
    void navigate({ to: '/cards/$cardId', params: { cardId: account.id } });
  };

  const apply = async (entry: CatalogEntry, memberLevel: string | null) => {
    if (busy) return;
    setBusy(true);
    onError(null);
    const input = { cardAccountId: account.id, entry, today: isoDate(), memberLevel };
    try {
      try {
        await applyCatalogEntry(database, ws, { ...input, replaceManual: false });
      } catch (e) {
        // Rules kept by hand are replaced only once that is agreed.
        if (!(e instanceof Error) || !e.message.includes('set up by hand') || !window.confirm(`Replace the earn rules with the catalogue terms for ${entry.name}?`)) throw e;
        await applyCatalogEntry(database, ws, { ...input, replaceManual: true });
      }
      await onDone();
      onClose();
    } catch (e) {
      onError(e);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const choose = (entry: CatalogEntry) => {
    if (memberLevelsOf(entry).length > 0) setLeveling(entry);
    else void apply(entry, null);
  };

  if (leveling) {
    return (
      <Sheet grouped tall title={leveling.program.name} onClose={onClose} back={{ label: 'Card rewards', run: () => setLeveling(null) }}>
        <ul className={LIST} aria-label="Level">
          {memberLevelsOf(leveling).map((level) => (
            <Row key={level.key} label={level.name} detail={level.condition} onClick={() => void apply(leveling, level.key)} />
          ))}
        </ul>
      </Sheet>
    );
  }

  const matches = searchCatalog(debitEntries(CATALOG), query);
  const searchField = <SearchPill value={query} onChange={setQuery} onClose={() => { setQuery(''); setFinding(false); }} compact placeholder="Search" label="Search card rewards" />;
  return (
    <Sheet
      grouped
      tall
      title="Card rewards"
      onClose={onClose}
      closeHidden={finding}
      heading={finding ? searchField : undefined}
      action={<SheetSearchButton open={finding} onClick={() => { if (finding) setQuery(''); setFinding((was) => !was); }} />}
    >
      {program ? (
        <ul className={`${LIST} mb-3`}>
          <Row label="Open card page" icon={<span aria-hidden className="text-[17px] leading-none text-[var(--ph-chevron)]">{'›'}</span>} onClick={openPage} />
        </ul>
      ) : null}
      <ul className={LIST} aria-label="Debit cards">
        {matches.map((entry) => (
          <Row key={entry.id} label={entry.name} detail={entry.bank} current={program?.catalogEntryId === entry.id} onClick={() => choose(entry)} />
        ))}
        <Row label="Add manually" icon={<Plus size={17} aria-hidden className="shrink-0 text-[var(--ph-ink-2)]" />} onClick={openPage} />
      </ul>
    </Sheet>
  );
}
