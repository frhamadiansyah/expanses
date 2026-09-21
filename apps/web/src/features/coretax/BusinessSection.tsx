import type { BusinessScheme } from '@expanses/core';
import { archiveIncomeSource, saveIncomeSource } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { DestructiveRow, Figure, InsetGroup, InsetRow, Panel, RecordTable, SelectRow, SwitchRow, TextRow } from '../../ui/native';
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
    (account) => SPENDABLE_SUBTYPES.includes(account.subtype) && account.archivedAt === null,
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

  /** The event is optional: the row that saves is a `type="button"` inside a real `<form>`, which keeps Enter working. */
  async function save(event?: FormEvent) {
    event?.preventDefault();
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
    <Panel
      header="Business and freelance"
      footer={`Turnover for ${taxYear}, taken from the sales in each business wallet. This is the one section where the app works out tax rather than adding up what a slip said.`}
      pad={false}
    >
      <ErrorBox error={error ?? report.error} />

      {nothingYet && !open && (
        <p className="mb-[14px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">
          No business set up yet. Point one at the wallet you run it through and every sale you record there becomes its turnover.
        </p>
      )}

      {(data?.problems.length ?? 0) > 0 && (
        <ul className="mb-[14px] px-[4px] text-[13px] leading-[17px]">
          {data!.problems.map((problem) => (
            <li
              key={`${problem.sourceId}:${problem.message}`}
              className={problem.level === 'blocking' ? 'text-[var(--ph-warn)]' : 'text-[var(--ph-ink-3)]'}
            >
              {problem.message}
            </li>
          ))}
        </ul>
      )}

      {data?.umkm.map((umkm) => (
        <div key={umkm.sourceId} data-testid="umkm-row">
          {/*
           * The business's name is a row, not the group's header: a header is drawn in capitals, and a name is a
           * name. The tax owed is that row's second line, which is what the figure belongs to.
           */}
          <InsetGroup header={SCHEME_LABELS.umkm_final}>
            <InsetRow
              title={umkm.name}
              subtitle={
                <>
                  tax for the year <Money minor={umkm.taxMinor} currency={ws.baseCurrency} />
                </>
              }
              chevron={false}
            />
          </InsetGroup>

          <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
            Turnover <Money minor={umkm.grossMinor} currency={ws.baseCurrency} /> · not taxed{' '}
            <Money minor={umkm.exemptMinor} currency={ws.baseCurrency} /> · taxed <Money minor={umkm.taxableMinor} currency={ws.baseCurrency} />
            {umkm.crossedInMonth !== null && ` · the exempt part ran out in ${MONTHS[umkm.crossedInMonth - 1]}`}
          </p>

          <RecordTable
            header="Month by month"
            records={umkm.months}
            detail={{ kind: 'none' }}
            shape={{
              key: (month) => String(month.month),
              title: (month) => MONTHS[month.month - 1] ?? '',
              value: (month) => <Money minor={month.turnoverMinor} currency={ws.baseCurrency} />,
            }}
            columns={[
              { key: 'month', heading: 'Month', cell: (month) => MONTHS[month.month - 1] ?? '' },
              {
                key: 'turnover',
                heading: 'Turnover',
                numeric: true,
                cell: (month) => (
                  <Figure>
                    <Money minor={month.turnoverMinor} currency={ws.baseCurrency} />
                  </Figure>
                ),
              },
              {
                key: 'cumulative',
                heading: 'Running total',
                numeric: true,
                cell: (month) => (
                  <Figure>
                    <Money minor={month.cumulativeMinor} currency={ws.baseCurrency} />
                  </Figure>
                ),
              },
              {
                key: 'taxable',
                heading: 'Taxed',
                numeric: true,
                cell: (month) => (
                  <Figure>
                    <Money minor={month.taxableMinor} currency={ws.baseCurrency} />
                  </Figure>
                ),
              },
              {
                key: 'tax',
                heading: '0,5%',
                numeric: true,
                cell: (month) => (
                  <Figure>
                    <Money minor={month.taxMinor} currency={ws.baseCurrency} />
                  </Figure>
                ),
              },
            ]}
          />

          <InsetGroup>
            <DestructiveRow label="Remove" onClick={() => void remove(umkm.sourceId)} />
          </InsetGroup>
        </div>
      ))}

      {data?.nppn.map((nppn) => (
        <div key={nppn.sourceId} data-testid="nppn-row">
          <InsetGroup header={SCHEME_LABELS.nppn}>
            <InsetRow
              title={nppn.name}
              subtitle={
                <>
                  net income <Money minor={nppn.netMinor} currency={ws.baseCurrency} />
                </>
              }
              chevron={false}
            />
          </InsetGroup>

          <p className="mb-[18px] px-[4px] text-[13px] leading-[17px] text-[var(--ph-ink-2)]">
            Turnover <Money minor={nppn.grossMinor} currency={ws.baseCurrency} />
            {nppn.normaRateBps !== null && ` · norma ${(nppn.normaRateBps / 100).toLocaleString('id-ID')}%`}
            {' · added to your taxable income and taxed progressively, so no tax is worked out here'}
          </p>

          <InsetGroup>
            <DestructiveRow label="Remove" onClick={() => void remove(nppn.sourceId)} />
          </InsetGroup>
        </div>
      ))}

      {!open && (
        <InsetGroup>
          <InsetRow title="Add a business" chevron={false} onClick={() => setOpen(true)} />
        </InsetGroup>
      )}

      {open && (
        <form onSubmit={save}>
          <InsetGroup header="A new business">
            <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Warung, freelance, affiliate" />
            <SelectRow label="How it is taxed" value={scheme} onChange={(e) => setScheme(e.target.value as BusinessScheme)}>
              <option value="umkm_final">UMKM final 0,5% of turnover</option>
              <option value="nppn">Norma (NPPN) — a percentage of turnover is net income</option>
            </SelectRow>
            <SelectRow
              label="Business wallet"
              hint="Sales you record in this account are its turnover. Keep it apart from the family wallet."
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Choose an account</option>
              {wallets.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </SelectRow>
            {scheme === 'nppn' && (
              <TextRow
                label="Norma percentage"
                hint="From the KLU table for your trade and city. It differs by trade, so nothing is preset."
                value={normaPercent}
                onChange={(e) => setNormaPercent(e.target.value)}
                inputMode="decimal"
                placeholder="50"
              />
            )}
            {scheme === 'nppn' && (
              <TextRow label="KLU code" hint="Optional, for your own reference." value={kluCode} onChange={(e) => setKluCode(e.target.value)} placeholder="73100" />
            )}
            {scheme === 'umkm_final' && (
              <SwitchRow
                label="The first slice of the year's turnover is not taxed. Turn this off once that no longer applies to you."
                checked={thresholdApplies}
                onChange={setThresholdApplies}
              />
            )}
          </InsetGroup>

          {/* Save is a row inside the form, so Enter in a field saves too; Cancel is in its own group, a row away. */}
          <InsetGroup>
            <InsetRow title="Save business" chevron={false} onClick={() => void save()} />
          </InsetGroup>
          <InsetGroup>
            <InsetRow title="Cancel" chevron={false} onClick={reset} />
          </InsetGroup>
        </form>
      )}

      <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
        The only figures the app works out itself. Everywhere else it adds up what you recorded from a slip, but nobody withholds UMKM for
        you and no slip carries a norma percentage. Check both against what you actually paid.
      </p>
    </Panel>
  );
}
