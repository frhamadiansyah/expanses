import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { useState } from 'react';
import { usePhone } from '../../app/use-phone';
import { Panel } from '../../ui/native';
import { DayReorder, movedBy, reorderAttrs, ReorderScope } from '../transactions/DayReorder';
import type { PayFirstRow } from './plan-view';
import { PayFirstRowView } from './PayFirstRowView';

/**
 * The pay-first list put in order by hand (spec §4.1): late debts stay pinned on top with no handle, the rest move by
 * their ≡ handle (or press and hold on a phone), with Move up / Move down for a keyboard and a screen reader — exactly
 * as Wallet's reorder does. Every move saves the order of the rest.
 */
export function ByHandList({ rows, onOrder }: { rows: readonly PayFirstRow[]; onOrder: (order: string[]) => void }) {
  const phone = usePhone();
  const [said, setSaid] = useState('');
  const late = rows.filter((row) => row.place === null);
  const rest = rows.filter((row) => row.place !== null);
  const keys = rest.map((row) => row.debt.key);

  const move = (key: string, by: -1 | 1) => {
    const next = movedBy(keys, key, by);
    if (!next) return;
    onOrder(next);
    const name = rest.find((row) => row.debt.key === key)?.debt.name ?? 'Debt';
    setSaid(`${name}, ${next.indexOf(key) + 1} of ${next.length}`);
  };

  return (
    <Panel pad={false} footer="Drag a debt by its handle to move it.">
      {late.length > 0 && (
        <ul>
          {late.map((row, index) => (
            <li key={row.debt.key} data-testid="pay-first-row" data-name={row.debt.name} className="relative">
              {index > 0 && <Hair />}
              <PayFirstRowView row={row} trailing={<span className="w-[38px] shrink-0" aria-hidden />} />
            </li>
          ))}
        </ul>
      )}
      <ReorderScope enabled>
        <DayReorder enabled phone={phone} onMove={(_moved, next) => onOrder(next)} className="relative">
          {rest.map((row, index) => (
            <li key={row.debt.key} {...reorderAttrs(row.debt.key)} data-testid="pay-first-row" data-name={row.debt.name} className="relative bg-[var(--ph-surface)]">
              {(index > 0 || late.length > 0) && <Hair />}
              <PayFirstRowView
                row={row}
                trailing={
                  <>
                    <span className="sr-only focus-within:not-sr-only focus-within:flex focus-within:shrink-0 focus-within:items-center focus-within:gap-[2px]">
                      <button type="button" className="ph-focus rounded p-[6px] text-[var(--ph-ink-2)] disabled:opacity-40" aria-label={`Move ${row.debt.name} up`} disabled={index === 0} onClick={() => move(row.debt.key, -1)}>
                        <ChevronUp size={18} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="ph-focus rounded p-[6px] text-[var(--ph-ink-2)] disabled:opacity-40"
                        aria-label={`Move ${row.debt.name} down`}
                        disabled={index === rest.length - 1}
                        onClick={() => move(row.debt.key, 1)}
                      >
                        <ChevronDown size={18} aria-hidden />
                      </button>
                    </span>
                    <button
                      type="button"
                      data-reorder-handle=""
                      aria-label={`Reorder ${row.debt.name}`}
                      title="Drag to reorder"
                      className="ph-focus -mr-[6px] flex h-[44px] w-[38px] shrink-0 cursor-grab touch-none items-center justify-center rounded text-[var(--ph-ink-3)] active:cursor-grabbing"
                      onKeyDown={(event) => {
                        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                        event.preventDefault();
                        move(row.debt.key, event.key === 'ArrowUp' ? -1 : 1);
                      }}
                    >
                      <GripVertical size={20} aria-hidden />
                    </button>
                  </>
                }
              />
            </li>
          ))}
        </DayReorder>
      </ReorderScope>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </Panel>
  );
}

export function Hair() {
  return <span aria-hidden className="pointer-events-none absolute top-0 right-[16px] left-[52px] bg-[var(--ph-hair)]" style={{ height: 0.5 }} />;
}
