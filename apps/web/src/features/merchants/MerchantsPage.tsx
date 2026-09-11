import { MERCHANTS } from '@expanses/catalog';
import { mccName } from '@expanses/core';
import { archiveMerchantMcc, countMatchingPurchases, countPurchasesByPattern, listMerchantMccs, type MerchantMccRow, saveMerchantMcc } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, Field, Input, PageHeader } from '../../ui';
import { MccPicker } from './MccPicker';
import { bundledRows } from './merchant-rows';

const describeMcc = (mcc: string | null) => (mcc === null ? 'Ignored: the typical MCC is not used' : `${mcc} ${mccName(mcc) ?? ''}`.trim());
const purchasesText = (count: number) => `${count} purchase${count === 1 ? '' : 's'}`;

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
      return rows.map((row) => ({ ...row, matches: counts[row.pattern] ?? 0 }));
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

  const startEdit = (row: { id?: string; pattern: string; mcc: string | null }) => {
    setEditingId(row.id ?? null);
    setPattern(row.pattern);
    setMcc(row.mcc ?? '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await save({ id: editingId ?? undefined, pattern, mcc: mcc || null })) {
      setEditingId(null);
      setPattern('');
      setMcc('');
    }
  }

  async function remove(row: MerchantMccRow) {
    if (!window.confirm(`Forget ${row.pattern}? Purchases go back to the typical or category MCC.`)) return;
    setError(null);
    try {
      await archiveMerchantMcc(database, ws, row.id);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const rows = bundledRows(MERCHANTS.merchants, memory.data ?? [], search);

  return (
    <div className="space-y-4">
      <PageHeader title="Merchants & MCCs" action={<Link to="/cards" className="text-sm underline">All cards</Link>} />
      <p className="text-sm text-slate-600">
        Banks give points by merchant category code (MCC). A purchase uses the MCC typed on it, else a merchant below, else a typical code for well-known
        merchants, else its category's MCC. Changes here apply to every card, including past cycles.
      </p>
      <ErrorBox error={error} />
      {message && <p className="text-sm text-emerald-700">{message}</p>}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-600">Your merchants</h2>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
          <Field label="Merchant text" hint="Matched as whole words in purchase descriptions, e.g. mcdonald.">
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} required />
          </Field>
          <MccPicker label="MCC" value={mcc} onChange={setMcc} hint="Leave empty to ignore a typical merchant with the same text." />
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit">{editingId ? 'Save changes' : 'Save merchant'}</Button>
            {(editingId || pattern || mcc) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingId(null);
                  setPattern('');
                  setMcc('');
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
        {memory.isSuccess && memory.data.length === 0 && <Empty>No merchants yet. Teach one here, or from a purchase's card details.</Empty>}
        <ul className="mt-3 divide-y divide-slate-100">
          {(memory.data ?? []).map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{row.pattern}</div>
                <div className="text-xs text-slate-500">
                  {describeMcc(row.mcc)} · matches {purchasesText(row.matches)}
                </div>
              </div>
              <Button variant="ghost" onClick={() => startEdit(row)}>
                Edit
              </Button>
              <Button variant="ghost" onClick={() => void remove(row)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-600">Typical merchant codes</h2>
        <p className="mb-3 text-xs text-slate-500">
          Researched typical MCCs (verified {MERCHANTS.verifiedOn}). The bank's acquirer can assign another code; check a statement or bank app if points look
          wrong.
        </p>
        <Field label="Search typical merchants">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="McDonald's, 5814, fuel" />
        </Field>
        <ul className="mt-3 divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.pattern} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {row.name}{' '}
                  <span
                    className={cx(
                      'rounded px-1.5 py-0.5 text-xs',
                      row.status === 'typical' && 'bg-slate-100 text-slate-700',
                      row.status === 'yours' && 'bg-emerald-100 text-emerald-800',
                      row.status === 'ignored' && 'bg-amber-100 text-amber-800',
                    )}
                  >
                    {row.status === 'typical' ? 'Typical' : row.status === 'yours' ? `Yours: ${row.yourMcc}` : 'Ignored'}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  “{row.pattern}” · {describeMcc(row.mcc)} · {row.basis}
                </div>
              </div>
              <Button variant="ghost" onClick={() => startEdit({ pattern: row.pattern, mcc: row.yourMcc ?? row.mcc })}>
                Use a different MCC
              </Button>
              {row.status !== 'ignored' && (
                <Button variant="ghost" onClick={() => void save({ pattern: row.pattern, mcc: null })}>
                  Ignore
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
