import type { ReactNode } from 'react';
import { InsetRow, type InsetRowProps } from './InsetList';
import { Figure } from './RecordTable';

/** R1: the figure in its own currency, leading; the ≈ line beneath it (nothing beneath in the base currency). */
export function ApproxFigure({ figure, beneath }: { figure: ReactNode; beneath: string | null }) {
  return (
    <span className="block text-right">
      <Figure>{figure}</Figure>
      {beneath && <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{beneath}</span>}
    </span>
  );
}

/**
 * A parent that sums its children and holds nothing itself: one row, its ≈ total (or the missing rate named, in
 * the warning tone), opening to wherever its children are listed. Pockets use it now; securities after them.
 */
export function GroupedRow({
  figure,
  ...row
}: Omit<InsetRowProps, 'value' | 'valueTone'> & { figure: { text: string; complete: boolean } }) {
  return <InsetRow {...row} value={<Figure tone={figure.complete ? 'ink' : 'warn'}>{figure.text}</Figure>} valueTone={figure.complete ? 'ink' : 'warn'} />;
}
