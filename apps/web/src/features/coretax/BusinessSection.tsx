import type { BusinessScheme } from '@expanses/core';
import { archiveIncomeSource, saveIncomeSource } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, ErrorBox, Field, Input, Money, Select } from '../../ui';
import { useBusinessReport } from './queries';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SCHEME_LABELS: Record<BusinessScheme, string> = {
  umkm_final: 'UMKM final 0,5%',
  nppn: 'Norma (NPPN)',
};

/**
 * Business and freelance income, read off the sales already recorded in each business wallet.
 *
 * This is the one section where the app works out tax rather than adding up what a slip said, and it
 * says so: UMKM is a 0,5% nobody withholds for you, and norma turns turnover into net income at a
 * percentage only the owner can supply.
 */
export function BusinessSection({ taxYear }: { taxYear: number }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const report = useBusinessReport(taxYear);
  const accounts = useAccounts();
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scheme, setScheme] = useState<BusinessScheme>('umkm_final');
  const [accountId, setAccountId] = useState('');
  const [normaPercent, setNormaPercent] = useState('');
  const [kluCode, setKluCode] = useState('');
  const [thresholdApplies, setThresholdApplies] = useState(true);

  const wallets = (accounts.data ?? []).filter(
    (account) => ['bank', 'cash', 'savings'].includes(account.subtype) && account.archivedAt === null,
  );
  const data = report.data;
  const nothingYet = (data?.umkm.length ?? 0) === 0 && (data?.nppn.length ?? 0) === 0;

  function reset() {
    setEditingId(null);
    setName('');
    setScheme('umkm_final');
    setAccountId('');
    setNormaPercent('');
    setKluCode('');
    setThresholdApplies(true);
    setOpen(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const percent = normaPercent.trim() === '' ? null : Math.round(Number(normaPercent) * 100);
      if (scheme === 'nppn' && (percent === null || !Number.isFinite(percent))) {
        throw new Error('Norma needs the percentage for your KLU');
      }
      await saveIncomeSource(database, ws, {
        id: editingId ?? undefined,
        name,
        scheme,
        accountId,
        normaRateBps: percent,
        kluCode: kluCode || null,
        thresholdApplies,
      });
      await invalidate();
      reset();
    } catch (e) {
      setError(e);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await archiveIncomeSource(database, ws, id);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Business and freelance</h2>
        <span className="text-xs text-slate-500">Turnover for {taxYear}, taken from the sales in each business wallet</span>
      </div>

      <ErrorBox error={error ?? report.error} />

      {nothingYet && !open && (
        <p className="text-xs text-slate-500">
          No business set up yet. Point one at the wallet you run it through and every sale you record there becomes its turnover.
        </p>
      )}

      {(data?.problems.length ?? 0) > 0 && (
        <ul className="space-y-1">
          {data!.problems.map((problem) => (
            <li
              key={`${problem.sourceId}:${problem.message}`}
              className={problem.level === 'blocking' ? 'text-xs text-amber-700' : 'text-xs text-slate-600'}
            >
              {problem.message}
            </li>
          ))}
        </ul>
      )}

      {data?.umkm.map((umkm) => (
        <div key={umkm.sourceId} data-testid="umkm-row" className="border-t border-slate-100 pt-3 first:border-t-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {umkm.name} <span className="text-xs font-normal text-slate-500">{SCHEME_LABELS.umkm_final}</span>
            </span>
            <span className="text-xs text-slate-600">
              tax for the year <Money minor={umkm.taxMinor} currency={ws.baseCurrency} className="font-semibold text-slate-900" />
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Turnover <Money minor={umkm.grossMinor} currency={ws.baseCurrency} /> · not taxed{' '}
            <Money minor={umkm.exemptMinor} currency={ws.baseCurrency} /> · taxed <Money minor={umkm.taxableMinor} currency={ws.baseCurrency} />
            {umkm.crossedInMonth !== null && ` · the exempt part ran out in ${MONTHS[umkm.crossedInMonth - 1]}`}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">Month</th>
                  <th className="py-1 text-right">Turnover</th>
                  <th className="py-1 text-right">Running total</th>
                  <th className="py-1 text-right">Taxed</th>
                  <th className="py-1 text-right">0,5%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {umkm.months.map((month) => (
                  <tr key={month.month} className={month.turnoverMinor === 0 ? 'text-slate-400' : undefined}>
                    <td className="py-1">{MONTHS[month.month - 1]}</td>
                    <td className="tabular py-1 text-right">
                      <Money minor={month.turnoverMinor} currency={ws.baseCurrency} />
                    </td>
                    <td className="tabular py-1 text-right">
                      <Money minor={month.cumulativeMinor} currency={ws.baseCurrency} />
                    </td>
                    <td className="tabular py-1 text-right">
                      <Money minor={month.taxableMinor} currency={ws.baseCurrency} />
                    </td>
                    <td className="tabular py-1 text-right">
                      <Money minor={month.taxMinor} currency={ws.baseCurrency} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-1 flex gap-2">
            <Button variant="secondary" onClick={() => remove(umkm.sourceId)}>
              Remove
            </Button>
          </div>
        </div>
      ))}

      {data?.nppn.map((nppn) => (
        <div key={nppn.sourceId} data-testid="nppn-row" className="border-t border-slate-100 pt-3 first:border-t-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {nppn.name} <span className="text-xs font-normal text-slate-500">{SCHEME_LABELS.nppn}</span>
            </span>
            <span className="text-xs text-slate-600">
              net income <Money minor={nppn.netMinor} currency={ws.baseCurrency} className="font-semibold text-slate-900" />
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Turnover <Money minor={nppn.grossMinor} currency={ws.baseCurrency} />
            {nppn.normaRateBps !== null && ` · norma ${(nppn.normaRateBps / 100).toLocaleString('id-ID')}%`}
            {' · added to your taxable income and taxed progressively, so no tax is worked out here'}
          </p>
          <div className="mt-1 flex gap-2">
            <Button variant="secondary" onClick={() => remove(nppn.sourceId)}>
              Remove
            </Button>
          </div>
        </div>
      ))}

      {!open && (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add a business
        </Button>
      )}

      {open && (
        <form onSubmit={save} className="space-y-3 border-t border-slate-100 pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Warung, freelance, affiliate" />
            </Field>
            <Field label="How it is taxed">
              <Select value={scheme} onChange={(e) => setScheme(e.target.value as BusinessScheme)}>
                <option value="umkm_final">UMKM final 0,5% of turnover</option>
                <option value="nppn">Norma (NPPN) — a percentage of turnover is net income</option>
              </Select>
            </Field>
            <Field label="Business wallet" hint="Sales you record in this account are its turnover. Keep it apart from the family wallet.">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Choose an account</option>
                {wallets.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
            {scheme === 'nppn' && (
              <Field label="Norma percentage" hint="From the KLU table for your trade and city. It differs by trade, so nothing is preset.">
                <Input value={normaPercent} onChange={(e) => setNormaPercent(e.target.value)} inputMode="decimal" placeholder="50" />
              </Field>
            )}
            {scheme === 'nppn' && (
              <Field label="KLU code" hint="Optional, for your own reference.">
                <Input value={kluCode} onChange={(e) => setKluCode(e.target.value)} placeholder="73100" />
              </Field>
            )}
          </div>

          {scheme === 'umkm_final' && (
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={thresholdApplies} onChange={(e) => setThresholdApplies(e.target.checked)} className="mt-0.5" />
              <span>
                The first slice of the year's turnover is not taxed. Turn this off once that no longer applies to you.
              </span>
            </label>
          )}

          <div className="flex gap-2">
            <Button type="submit">Save business</Button>
            <Button type="button" variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <p className="text-xs text-slate-500">
        The only figures the app works out itself. Everywhere else it adds up what you recorded from a slip, but nobody withholds UMKM for
        you and no slip carries a norma percentage. Check both against what you actually paid.
      </p>
    </Card>
  );
}
