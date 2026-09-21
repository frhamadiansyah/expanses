import { type CarryRow, CORETAX_SECTIONS, type CoretaxField, hartaLabel, utangLabel } from '@expanses/core';
import { useApp } from '../../app/context';
import { Money } from '../../ui';
import { Figure, Panel, RecordTable } from '../../ui/native';
import { carryPillLabel, type ScreenSection } from './report-rows';

/**
 * One table of the form: its rows, what the codes mean, and what changed since last year.
 *
 * The five numeric columns overlapped illegibly at 390 px, and this is the case `RecordTable` names: **nothing
 * here opens anything**, so a phone has no detail screen to hold the columns a row would drop. Losing a column
 * is worse than scrolling one, so the table stays a table at every width inside its own sideways scroller —
 * `detail: { kind: 'none' }` is how that is said, and the shape is given so the option stays open.
 */
export function SectionTable({ section, carry }: { section: ScreenSection; carry: CarryRow[] }) {
  const { ws } = useApp();
  const isUtang = section.section === 'utang';
  const carryOf = new Map(carry.map((row) => [row.key, row]));
  // Only the fields this table actually asks for are shown, in the order the form lists them.
  // Utang has no field definition of its own, so the check is inline: a separate boolean would
  // not tell the compiler that the section cannot be 'utang' here.
  const fields: readonly CoretaxField[] = section.section === 'utang' ? [] : CORETAX_SECTIONS[section.section].fields;
  const labelOf = (code: string) => (isUtang ? utangLabel(code) : hartaLabel(code));

  return (
    <Panel
      header={section.label}
      trailing={
        <>
          {isUtang ? 'Owed ' : 'Worth '}
          <Money minor={section.valueMinor} currency={ws.baseCurrency} />
          {!isUtang && section.costMinor > 0 && (
            <>
              {' · cost '}
              <Money minor={section.costMinor} currency={ws.baseCurrency} />
            </>
          )}
        </>
      }
      pad={false}
    >
      <RecordTable
        records={section.rows}
        detail={{ kind: 'none' }}
        shape={{
          key: (row) => row.key,
          title: (row) => row.name,
          subtitle: (row) => `${row.code} · ${labelOf(row.code)}`,
          value: (row) => <Money minor={row.valueMinor} currency={ws.baseCurrency} />,
        }}
        columns={[
          {
            key: 'code',
            heading: 'Kode',
            cell: (row) => (
              <>
                <span className="font-medium">{row.code}</span>
                <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{labelOf(row.code)}</span>
              </>
            ),
          },
          {
            key: 'name',
            heading: 'Nama',
            cell: (row) => (
              <>
                {row.name}
                {row.note && <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{row.note}</span>}
              </>
            ),
          },
          ...(isUtang ? [] : [{ key: 'acquired', heading: 'Tahun perolehan', cell: (row: ScreenSection['rows'][number]) => <Figure>{row.acquiredYear ?? '—'}</Figure> }]),
          ...fields.map((field) => ({
            key: field.key,
            heading: field.label,
            cell: (row: ScreenSection['rows'][number]) =>
              row.fields[field.key] ? (
                <span>{row.fields[field.key]}</span>
              ) : (
                <span className={field.required ? 'text-[var(--ph-alarm)]' : undefined}>{field.required ? 'Needed' : '—'}</span>
              ),
          })),
          ...(isUtang
            ? []
            : [
                {
                  key: 'cost',
                  heading: 'Harga perolehan',
                  numeric: true,
                  cell: (row: ScreenSection['rows'][number]) => (
                    <Figure>
                      <Money minor={row.costMinor} currency={ws.baseCurrency} />
                    </Figure>
                  ),
                },
              ]),
          {
            key: 'value',
            heading: isUtang ? 'Jumlah' : 'Nilai',
            numeric: true,
            cell: (row) => (
              <Figure>
                <Money minor={row.valueMinor} currency={ws.baseCurrency} />
              </Figure>
            ),
          },
          {
            key: 'change',
            heading: '',
            cell: (row) => {
              const change = carryOf.get(row.key);
              return change && change.status !== 'same' ? (
                <span className="text-[12.5px] leading-[16px] font-semibold whitespace-nowrap text-[var(--ph-warn)]">{carryPillLabel(change.status)}</span>
              ) : null;
            },
          },
        ]}
      />
    </Panel>
  );
}
