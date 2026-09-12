import { isoDate } from '@expanses/core';
import { acceptLedgerValue, freezeReport, markFiled } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Money } from '../../ui';
import { useRowDifferences } from './queries';

const FIELD_LABELS: Record<string, string> = { costMinor: 'cost', valueMinor: 'value', balanceMinor: 'balance' };

/**
 * Freezing a year, and what to do when the ledger moves afterwards. A frozen report is a copy: the
 * figures stop following the ledger, so a later edit shows here rather than changing a filed return.
 */
export function FreezePanel({ taxYear, status }: { taxYear: number; status: 'draft' | 'frozen' | 'filed' }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const differences = useRowDifferences(taxYear);
  const [filedOn, setFiledOn] = useState(isoDate());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const rows = differences.data ?? [];

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Freezing {taxYear}</h2>

      {status === 'draft' && (
        <>
          <p className="text-sm text-slate-600">
            While this is a draft it follows your ledger, so it changes whenever you record something dated in {taxYear}. Freeze it when the figures are the ones you mean to file: the
            rows are copied, and anything you change afterwards shows up here instead of moving quietly.
          </p>
          <p className="text-xs text-slate-500">
            Before freezing, make sure every holding has a price for 31 December {taxYear}, and that anything held in another currency has its KMK rate.
          </p>
          <Button disabled={busy} onClick={() => void run(() => freezeReport(database, ws, taxYear))}>
            Freeze {taxYear}
          </Button>
        </>
      )}

      {status === 'frozen' && (
        <>
          <p className="text-sm text-slate-600">Frozen. The rows below are the copy; your ledger can move without touching them.</p>
          {rows.length === 0 && <p className="text-sm text-slate-500">Nothing has changed in the ledger since you froze it.</p>}
          {rows.length > 0 && (
            <div className="divide-y divide-slate-100 text-sm">
              {rows.map((difference) => (
                <div key={`${difference.rowKey}-${difference.field}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    {difference.name} · {FIELD_LABELS[difference.field]}
                    <span className="block text-xs text-slate-500">
                      Frozen at <Money minor={difference.savedMinor} currency={ws.baseCurrency} />, the ledger now says{' '}
                      <Money minor={difference.ledgerMinor} currency={ws.baseCurrency} />
                    </span>
                  </span>
                  <Button variant="secondary" disabled={busy} onClick={() => void run(() => acceptLedgerValue(database, ws, taxYear, difference.rowKey))}>
                    Use the ledger figure
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
            <Field label="Filed on">
              <Input type="date" value={filedOn} max={isoDate()} onChange={(e) => setFiledOn(e.target.value)} />
            </Field>
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => markFiled(database, ws, taxYear, filedOn))}>
              Mark as filed
            </Button>
          </div>
          <p className="text-xs text-slate-500">Marking it filed makes it read-only, and next year carries over from it.</p>
        </>
      )}

      {status === 'filed' && <p className="text-sm text-slate-600">Filed, and read-only. Next year's report carries over from these rows.</p>}

      <ErrorBox error={error} />
    </Card>
  );
}
