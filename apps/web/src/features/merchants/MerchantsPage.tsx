import { MERCHANTS } from '@expanses/catalog';
import { mccName } from '@expanses/core';
import { archiveMerchantMcc, countMatchingPurchases, countPurchasesByPattern, listMerchantMccs, type MerchantMccRow, saveMerchantMcc } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, cx, Empty, ErrorBox } from '../../ui';
import {
  type CornerAction,
  DestructiveRow,
  Figure,
  InsetGroup,
  InsetRow,
  LargeTitle,
  type RecordColumn,
  RecordTable,
  TextRow,
} from '../../ui/native';
import { MccPicker } from './MccPicker';
import { type BundledRow, bundledRows } from './merchant-rows';

const describeMcc = (mcc: string | null) => (mcc === null ? 'Ignored: the typical MCC is not used' : `${mcc} ${mccName(mcc) ?? ''}`.trim());
const purchasesText = (count: number) => `${count} purchase${count === 1 ? '' : 's'}`;
const statusWord = (row: BundledRow) => (row.status === 'typical' ? 'Typical' : row.status === 'yours' ? `Yours: ${row.yourMcc}` : 'Ignored');

interface MemoryRow extends MerchantMccRow {
  matches: number;
}

/** The ground a native screen is laid on, and the column a desktop reads it in. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <div className="mx-auto max-w-4xl">{children}</div>
    </div>
  );
}

/** Merchant memory and the bundled merchant list: which MCC a purchase gets from its description. */
export function MerchantsPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pattern, setPattern] = useState('');
  const [mcc, setMcc] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
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
    setMessage(null);
    try {
      const count = await countMatchingPurchases(database, ws, entry.pattern);
      await saveMerchantMcc(database, ws, entry);
      await invalidate();
      setMessage(`Saved. Estimates update for ${purchasesText(count)}, including past cycles.`);
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }

  const clear = () => {
    setEditingId(null);
    setPattern('');
    setMcc('');
  };

  const startEdit = (row: { id?: string; pattern: string; mcc: string | null }) => {
    setEditingId(row.id ?? null);
    setPattern(row.pattern);
    setMcc(row.mcc ?? '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (await save({ id: editingId ?? undefined, pattern, mcc: mcc || null })) clear();
  }

  async function remove(row: MerchantMccRow) {
    if (!window.confirm(`Forget ${row.pattern}? Purchases go back to the typical or category MCC.`)) return;
    setError(null);
    try {
      await archiveMerchantMcc(database, ws, row.id);
      await invalidate();
      if (editingId === row.id) clear();
    } catch (e) {
      setError(e);
    }
  }

  const rows = bundledRows(MERCHANTS.merchants, memory.data ?? [], search);
  const mine = memory.data ?? [];
  const editing = editingId === null ? null : (mine.find((row) => row.id === editingId) ?? null);
  const dirty = Boolean(editingId || pattern || mcc);

  /* The primary action is the corner button, not a dark rectangle at the foot of the form. Glyphs at every width. */
  const actions: CornerAction[] = [
    {
      key: 'save',
      label: editingId ? 'Save changes' : 'Save merchant',
      glyph: <Check size={22} aria-hidden />,
      run: () => void submit(),
      disabled: pattern.trim() === '',
    },
  ];
  if (dirty) actions.push({ key: 'cancel', label: 'Cancel', glyph: <X size={22} aria-hidden />, run: clear });

  /* A phone shows the merchant and its code; a desktop keeps every column it has today, actions included. */
  const mineColumns: RecordColumn<MemoryRow>[] = [
    { key: 'pattern', heading: 'Merchant text', cell: (row) => row.pattern },
    { key: 'mcc', heading: 'MCC', cell: (row) => describeMcc(row.mcc) },
    { key: 'matches', heading: 'Matches', numeric: true, cell: (row) => <Figure>{purchasesText(row.matches)}</Figure> },
    {
      key: 'actions',
      heading: 'Change it',
      cell: (row) => (
        <span className="flex gap-2">
          <Button variant="ghost" onClick={() => startEdit(row)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => void remove(row)}>
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
          <Button variant="ghost" onClick={() => startEdit({ pattern: row.pattern, mcc: row.yourMcc ?? row.mcc })}>
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

  return (
    <Screen>
      <LargeTitle
        title="Merchants & MCCs"
        back="All cards"
        backTo="/cards"
        actions={actions}
        subtitle="Banks give points by merchant category code (MCC). A purchase uses the MCC typed on it, else a merchant below, else a typical code for well-known merchants, else its category's MCC. Changes here apply to every card, including past cycles."
      />
      <ErrorBox error={error} />
      {message && <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-tint)]">{message}</p>}

      <form onSubmit={submit}>
        <InsetGroup header={editingId ? 'Edit this merchant' : 'Teach a merchant'}>
          <TextRow
            label="Merchant text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            required
            placeholder="mcdonald"
            hint="Matched as whole words in purchase descriptions, e.g. mcdonald."
          />
        </InsetGroup>
        <MccPicker label="MCC" value={mcc} onChange={setMcc} native hint="Leave empty to ignore a typical merchant with the same text." />
        {/*
         * The two row actions a desktop keeps in its table, given a place a thumb can reach: a row never holds a
         * button, so on a phone they belong to the merchant that is open rather than to every line of the list.
         */}
        {pattern.trim() !== '' && (
          <InsetGroup>
            <InsetRow
              title={<span className="text-[var(--ph-tint)]">Ignore the typical MCC</span>}
              subtitle="Purchases matching this text keep their category's own code."
              onClick={() => void save({ id: editingId ?? undefined, pattern, mcc: null }).then((ok) => ok && clear())}
              chevron={false}
            />
          </InsetGroup>
        )}
        {editing && (
          <InsetGroup>
            <DestructiveRow label={`Forget “${editing.pattern}”`} onClick={() => void remove(editing)} />
          </InsetGroup>
        )}
      </form>

      {memory.isSuccess && mine.length === 0 ? (
        <InsetGroup header="Your merchants">
          <InsetRow title="No merchants yet" subtitle="Teach one above, or from a purchase's card details." />
        </InsetGroup>
      ) : (
        <RecordTable
          header="Your merchants"
          records={mine}
          columns={mineColumns}
          /* Tapping a merchant opens it in the form above, which is where "Change it" lives on a phone. */
          detail={{ kind: 'screen', open: (row) => startEdit(row) }}
          shape={{
            key: (row) => row.id,
            title: (row) => row.pattern,
            subtitle: (row) => `${describeMcc(row.mcc)} · matches ${purchasesText(row.matches)}`,
            value: () => 'Edit',
            valueTone: () => 'tint',
            covers: ['pattern', 'mcc', 'matches'],
          }}
        />
      )}

      <InsetGroup header="Find a typical merchant">
        <TextRow label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="McDonald's, 5814, fuel" aria-label="Search typical merchants" />
      </InsetGroup>
      {rows.length === 0 ? (
        <Empty>No typical merchant matches that.</Empty>
      ) : (
        <RecordTable
          header="Typical merchant codes"
          records={rows}
          columns={bundledColumns}
          detail={{ kind: 'screen', open: (row) => startEdit({ pattern: row.pattern, mcc: row.yourMcc ?? row.mcc }) }}
          shape={{
            key: (row) => row.pattern,
            title: (row) => row.name,
            subtitle: (row) => `“${row.pattern}” · ${describeMcc(row.mcc)} · ${row.basis}`,
            value: (row) => statusWord(row),
            valueTone: (row) => (row.status === 'yours' ? 'tint' : row.status === 'ignored' ? 'warn' : 'ink-3'),
            covers: ['name', 'status', 'pattern', 'mcc', 'basis'],
          }}
        />
      )}
      <p className={cx('px-[4px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]')}>
        Researched typical MCCs (verified {MERCHANTS.verifiedOn}). The bank's acquirer can assign another code; check a statement or bank app if points look
        wrong.
      </p>
    </Screen>
  );
}
