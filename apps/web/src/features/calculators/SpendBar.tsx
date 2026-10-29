import { type EmergencyBase, emergencyOutgoingMinor, groupedMajorString, isoDate } from '@expanses/core';
import { useMemo } from 'react';
import { useApp } from '../../app/context';
import { KeyboardStrip } from '../../ui/native/KeyboardStrip';
import { usePeriodFlows } from '../networth/queries';
import { emergencySuggestions, type RangeFigures, retirementSuggestions, type SpendSuggestion, spendRanges } from './spend-suggestions';

/**
 * The spending the calculators offer to fill a figure from, read from the same flows the Financial health card and
 * the emergency goal use. Emergency counts what the goal counts (`emergencyOutgoingMinor`, loan principal included);
 * retirement counts spending alone, since principal is not a cost of living.
 */
export function useSpendSuggestions(kind: 'emergency' | 'retirement', base: EmergencyBase = 'essential'): SpendSuggestion[] {
  const today = isoDate();
  const ranges = useMemo(() => spendRanges(today), [today]);
  const lastMonth = usePeriodFlows(ranges.lastMonth).data;
  const last3 = usePeriodFlows(ranges.last3).data;
  const ytd = usePeriodFlows(ranges.ytd).data;
  const last12 = usePeriodFlows(ranges.last12).data;
  return useMemo(() => {
    const figures = (f: typeof lastMonth): RangeFigures | undefined =>
      f && { byMonth: f.byMonth, totalMinor: kind === 'emergency' ? emergencyOutgoingMinor(f, base) : f.spendingMinor };
    const data = { lastMonth: figures(lastMonth), last3: figures(last3), ytd: figures(ytd), last12: figures(last12) };
    return kind === 'emergency' ? emergencySuggestions(data, today) : retirementSuggestions(data, today);
  }, [kind, base, lastMonth, last3, ytd, last12, today]);
}

/** The bar over the keyboard while its amount row has focus: one segment per figure, a tap fills the amount. */
export function SpendBar({ open, suggestions, onPick }: { open: boolean; suggestions: SpendSuggestion[]; onPick: (typed: string) => void }) {
  const { ws } = useApp();
  return (
    <KeyboardStrip
      label="Spending to fill from"
      cells={
        open
          ? suggestions.map((s) => {
              const typed = groupedMajorString(s.minor, ws.baseCurrency);
              return { key: s.key, label: `${s.caption}, ${typed}`, caption: s.caption, title: typed, onPick: () => onPick(typed) };
            })
          : []
      }
    />
  );
}
