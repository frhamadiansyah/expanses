import { type CarryRow, CORETAX_SECTIONS, type CoretaxField, hartaLabel, utangLabel } from '@expanses/core';
import { useApp } from '../../app/context';
import { Card, cx, Money } from '../../ui';
import { carryPillLabel, type ScreenSection } from './report-rows';

const PILL: Record<string, string> = {
  new: 'bg-emerald-100 text-emerald-800',
  removed: 'bg-red-100 text-red-800',
  changed: 'bg-amber-100 text-amber-800',
  same: 'bg-slate-100 text-slate-600',
};

/** One table of the form: its rows, what the codes mean, and what changed since last year. */
export function SectionTable({ section, carry }: { section: ScreenSection; carry: CarryRow[] }) {
  const { ws } = useApp();
  const isUtang = section.section === 'utang';
  const carryOf = new Map(carry.map((row) => [row.key, row]));
  // Only the fields this table actually asks for are shown, in the order the form lists them.
  // Utang has no field definition of its own, so the check is inline: a separate boolean would
  // not tell the compiler that the section cannot be 'utang' here.
  const fields: readonly CoretaxField[] = section.section === 'utang' ? [] : CORETAX_SECTIONS[section.section].fields;

  return (
    <Card className="space-y-2 overflow-x-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{section.label}</h2>
        <span className="text-sm text-slate-600">
          {isUtang ? 'Owed ' : 'Worth '}
          <Money minor={section.valueMinor} currency={ws.baseCurrency} className="font-semibold text-slate-900" />
          {!isUtang && section.costMinor > 0 && (
            <>
              {' · cost '}
              <Money minor={section.costMinor} currency={ws.baseCurrency} />
            </>
          )}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1">Kode</th>
            <th className="py-1">Nama</th>
            {!isUtang && <th className="py-1">Tahun perolehan</th>}
            {fields.map((field) => (
              <th key={field.key} className="py-1">
                {field.label}
              </th>
            ))}
            {!isUtang && <th className="py-1 text-right">Harga perolehan</th>}
            <th className="py-1 text-right">{isUtang ? 'Jumlah' : 'Nilai'}</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {section.rows.map((row) => {
            const change = carryOf.get(row.key);
            return (
              <tr key={row.key}>
                <td className="py-1 whitespace-nowrap">
                  <span className="font-medium">{row.code}</span>
                  <span className="block text-xs text-slate-500">{isUtang ? utangLabel(row.code) : hartaLabel(row.code)}</span>
                </td>
                <td className="py-1">
                  {row.name}
                  {row.note && <span className="block text-xs text-slate-400">{row.note}</span>}
                </td>
                {!isUtang && <td className="tabular py-1">{row.acquiredYear ?? '—'}</td>}
                {fields.map((field) => (
                  <td key={field.key} className={cx('py-1', !row.fields[field.key] && field.required && 'text-red-700')}>
                    {row.fields[field.key] || (field.required ? 'Needed' : '—')}
                  </td>
                ))}
                {!isUtang && (
                  <td className="py-1 text-right">
                    <Money minor={row.costMinor} currency={ws.baseCurrency} />
                  </td>
                )}
                <td className="py-1 text-right">
                  <Money minor={row.valueMinor} currency={ws.baseCurrency} />
                </td>
                <td className="py-1 text-right">
                  {change && change.status !== 'same' && (
                    <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', PILL[change.status])}>{carryPillLabel(change.status)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
