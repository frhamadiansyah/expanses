import { MERCHANTS } from '@expanses/catalog';
import { mccName } from '@expanses/core';
import { archiveMerchantMcc, countPurchasesByPattern, listMerchantMccs, type MerchantMccRow, saveMerchantMcc } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Empty, ErrorBox } from '../../ui';
import {
  type CornerAction,
  DestructiveRow,
  Figure,
  InsetGroup,
  InsetRow,
  LargeTitle,
  type RecordColumn,
  RecordTable,
  SearchPill,
  SwitchRow,
  TextRow,
} from '../../ui/native';
import { MccRow, MccSearch } from './MccPicker';
import { type BundledRow, bundledRows, merchantOutcome, type MineRow, mineRows, normalisePattern, patternAsName, typicalFor } from './merchant-rows';

const describeMcc = (mcc: string | null) => (mcc === null ? 'Ignored: the typical MCC is not used' : `${mcc} ${mccName(mcc) ?? ''}`.trim());
/** A code and its kind as a row's second line reads them: "5814 · Fast food". */
const codeAndKind = (mcc: string) => [mcc, mccName(mcc)].filter(Boolean).join(' · ');
const purchasesText = (count: number) => `${count} purchase${count === 1 ? '' : 's'}`;
const statusWord = (row: BundledRow) => (row.status === 'typical' ? 'Typical' : row.status === 'yours' ? `Custom: ${row.yourMcc}` : 'Ignored');

interface MemoryRow extends MerchantMccRow {
  matches: number;
}

/** What the merchant sheet opens on: empty for +, or a merchant from either list. */
interface Opened {
  /** The owner's entry, when the merchant is one. */
  id?: string;
  /** The sheet's title: "New merchant", or the merchant's name. */
  title: string;
  pattern: string;
  mcc: string;
  useTypical: boolean;
}

/** The ground a native screen is laid on, and the column a desktop reads it in. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-4xl">{children}</div>
    </div>
  );
}

/**
 * Merchant memory and the bundled merchant list: which MCC a purchase gets from its description.
 *
 * The owner's merchants first, the researched typical codes under them; search and + in the corners. A save says
 * nothing: the row it lands in is the answer.
 * Adding and changing a merchant both happen in one sheet, so adding is never confused with searching.
 */
export function MerchantsPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [opened, setOpened] = useState<Opened | null>(null);
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<unknown>(null);

  const memory = useQuery({
    queryKey: ['merchant-mccs', ws.workspaceId],
    queryFn: async () => {
      const rows = await listMerchantMccs(database, ws);
      const counts = await countPurchasesByPattern(database, ws, rows.map((row) => row.pattern));
      return rows.map((row): MemoryRow => ({ ...row, matches: counts[row.pattern] ?? 0 }));
    },
  });

  async function save(entry: { id?: string; pattern: string; mcc: string | null }) {
    setError(null);
    try {
      await saveMerchantMcc(database, ws, entry);
      await invalidate();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }

  /** Forgets an entry; `ask` is false when the sheet's own switch already said what is meant. */
  async function forget(row: Pick<MerchantMccRow, 'id' | 'pattern'>, ask = true) {
    if (ask && !window.confirm(`Forget ${row.pattern}? Purchases go back to the typical or category MCC.`)) return false;
    setError(null);
    try {
      await archiveMerchantMcc(database, ws, row.id);
      await invalidate();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }

  const mine = memory.data ?? [];
  const nameOf = (pattern: string) => typicalFor(MERCHANTS.merchants, pattern)?.name ?? patternAsName(pattern);
  const openMine = (row: MemoryRow) => setOpened({ id: row.id, title: nameOf(row.pattern), pattern: row.pattern, mcc: row.mcc ?? '', useTypical: row.mcc !== null });
  const openTypical = (row: BundledRow) => {
    const entry = mine.find((own) => own.pattern === row.pattern);
    setOpened({ id: entry?.id, title: row.name, pattern: row.pattern, mcc: row.yourMcc ?? row.mcc, useTypical: row.status !== 'ignored' });
  };

  const typical = bundledRows(MERCHANTS.merchants, mine, search);
  const own = mineRows(mine, MERCHANTS.merchants, search);
  const query = search.trim();

  /* Search and + at every width: the search field takes the title's row, and + opens the sheet. */
  const actions: CornerAction[] = [
    { key: 'search', label: 'Search merchants', glyph: <Search size={20} aria-hidden />, pressed: searching, run: () => setSearching((was) => !was) },
    { key: 'add', label: 'New merchant', glyph: <Plus size={22} aria-hidden />, run: () => setOpened({ title: 'New merchant', pattern: '', mcc: '', useTypical: true }) },
  ];

  /* A phone shows the merchant and its code; a desktop keeps every column it has today, actions included. */
  const mineColumns: RecordColumn<MineRow<MemoryRow>>[] = [
    { key: 'pattern', heading: 'Merchant text', cell: (row) => row.entry.pattern },
    { key: 'mcc', heading: 'MCC', cell: (row) => describeMcc(row.entry.mcc) },
    { key: 'matches', heading: 'Matches', numeric: true, cell: (row) => <Figure>{purchasesText(row.entry.matches)}</Figure> },
    {
      key: 'actions',
      heading: 'Change it',
      cell: (row) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => openMine(row.entry)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void forget(row.entry)}>
            Remove
          </Button>
        </span>
      ),
    },
  ];

  const bundledColumns: RecordColumn<BundledRow>[] = [
    { key: 'name', heading: 'Merchant', cell: (row) => row.name },
    { key: 'status', heading: 'Now', cell: (row) => statusWord(row) },
    { key: 'pattern', heading: 'Matched on', cell: (row) => `“${row.pattern}”` },
    { key: 'mcc', heading: 'MCC', cell: (row) => describeMcc(row.mcc) },
    { key: 'basis', heading: 'Why', cell: (row) => row.basis },
    {
      key: 'actions',
      heading: 'Change it',
      cell: (row) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => openTypical(row)}>
            Use a different MCC
          </Button>
          {row.status !== 'ignored' && (
            <Button variant="ghost" onClick={() => void save({ pattern: row.pattern, mcc: null })}>
              Ignore
            </Button>
          )}
        </span>
      ),
    },
  ];

  const searchField = (
    <SearchPill
      value={search}
      onChange={setSearch}
      onClose={() => {
        setSearch('');
        setSearching(false);
      }}
      placeholder="Name, text or code"
      label="Search merchants"
    />
  );

  return (
    <Screen>
      <LargeTitle title="Merchants" back="Wallet" backTo="/wallet" actions={actions} field={searching ? searchField : undefined} />
      <ErrorBox error={error} />

      {memory.isSuccess && mine.length === 0 && !query ? (
        <InsetGroup header="Custom">
          <InsetRow title="No merchants yet" subtitle="Add one with +, or from a purchase's card details." chevron={false} />
        </InsetGroup>
      ) : own.length > 0 ? (
        <RecordTable
          header="Custom"
          records={own}
          columns={mineColumns}
          rowTestId={(row) => `merchant-${row.entry.pattern}`}
          detail={{ kind: 'screen', open: (row) => openMine(row.entry) }}
          shape={{
            key: (row) => row.entry.id,
            title: (row) => row.name,
            subtitle: (row) =>
              row.entry.mcc === null ? 'Typical code ignored' : `${codeAndKind(row.entry.mcc)} · ${purchasesText(row.entry.matches)}`,
            value: (row) => (row.entry.mcc === null ? 'Ignored' : null),
            valueTone: () => 'warn',
            covers: ['pattern', 'mcc', 'matches'],
          }}
        />
      ) : null}

      {typical.length > 0 && (
        <RecordTable
          header="Typical codes"
          records={typical}
          columns={bundledColumns}
          detail={{ kind: 'screen', open: openTypical }}
          shape={{
            key: (row) => row.pattern,
            title: (row) => row.name,
            subtitle: (row) => codeAndKind(row.mcc),
            value: () => null,
            covers: ['name', 'pattern', 'mcc'],
          }}
        />
      )}
      {query && own.length === 0 && typical.length === 0 && <Empty>No merchant matches that.</Empty>}

      {opened && (
        <MerchantSheet
          // A new key for each merchant opened, so the sheet's fields start from that merchant and nothing else.
          key={`${opened.id ?? ''}|${opened.pattern}`}
          opened={opened}
          onClose={() => setOpened(null)}
          onSave={async (entry) => (await save(entry)) && setOpened(null)}
          onForget={async (row, ask) => (await forget(row, ask)) && setOpened(null)}
        />
      )}
    </Screen>
  );
}

/**
 * New merchant (+) and a merchant opened from either list: the name a purchase is matched on, its code, and — where
 * a typical code exists for that name — whether it is used. ✓ saves; the owner's own merchant can be forgotten.
 *
 * The MCC row opens a step inside the same sheet — ‹ back to the merchant — to find a code by name or digits. The
 * form stays mounted underneath while the step is up, so nothing typed is lost and no field takes the focus again.
 */
function MerchantSheet({
  opened,
  onClose,
  onSave,
  onForget,
}: {
  opened: Opened;
  onClose: () => void;
  onSave: (entry: { id?: string; pattern: string; mcc: string | null }) => Promise<unknown>;
  onForget: (row: { id: string; pattern: string }, ask: boolean) => Promise<unknown>;
}) {
  const [pattern, setPattern] = useState(opened.pattern);
  const [mcc, setMcc] = useState(opened.mcc);
  const [useTypical, setUseTypical] = useState(opened.useTypical);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const typical = typicalFor(MERCHANTS.merchants, pattern);
  const outcome = merchantOutcome({ id: opened.id, pattern, mcc, useTypical }, MERCHANTS.merchants);
  const normalised = normalisePattern(pattern);
  const ignored = typical !== null && !useTypical;

  async function confirm() {
    if (!outcome || busy) return;
    setBusy(true);
    try {
      if (outcome.kind === 'save') await onSave(outcome.entry);
      else if (outcome.kind === 'forget') await onForget({ id: outcome.id, pattern: normalised }, false);
      else onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      grouped
      title={finding ? 'MCC' : opened.title}
      onClose={onClose}
      back={finding ? { label: opened.title, run: () => setFinding(false) } : undefined}
      confirm={finding ? undefined : { label: opened.id || opened.pattern ? 'Save changes' : 'Save merchant', disabled: !outcome || busy, run: () => void confirm() }}
      // Medium until the keyboard comes, then as tall as Paid with stands, whose foot reaches the keyboard (seen on the simulator).
      tall
      expanded={finding}
    >
      {finding && (
        <MccSearch
          value={mcc}
          onPick={(code) => {
            setMcc(code);
            setFinding(false);
          }}
        />
      )}
      <form
        hidden={finding}
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <InsetGroup>
          <TextRow label="Merchant" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Name" autoFocus={opened.pattern === ''} autoComplete="off" required />
          {/* Ignored, the merchant has no code of its own to choose, so the row steps aside. */}
          {!ignored && <MccRow value={mcc} onOpen={() => setFinding(true)} />}
        </InsetGroup>
        {typical && (
          <InsetGroup>
            <SwitchRow label="Use typical code" checked={useTypical} onChange={setUseTypical} />
          </InsetGroup>
        )}
        {opened.id && (
          <InsetGroup>
            <DestructiveRow label="Forget this merchant" onClick={() => void onForget({ id: opened.id as string, pattern: opened.pattern }, true)} />
          </InsetGroup>
        )}
      </form>
    </Sheet>
  );
}
