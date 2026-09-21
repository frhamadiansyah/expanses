import type { ReactNode } from 'react';
import { cx } from '../../ui';
import { GROUP_RADIUS } from '../../ui/native';

/**
 * A group's surface, for the things that are not rows.
 *
 * `InsetGroup` hands each of its children a place in the group, so it takes rows and only rows — a chart, a
 * gauge, a ratio tile or a form nobody has converted yet cannot be one of its children. This is the group's own
 * fill and radius, from the kit's tokens, replacing the ringed `Card` the kit exists to remove. Nothing of
 * `InsetGroup` is reimplemented: no header, no separators, no positions.
 *
 * It is drawn here once and imported by every net-worth, loans and debts screen rather than copied into each,
 * and it is the second such copy in the app — `EventDetailPage` has the first. The kit wants this shape.
 */
export function Panel({
  header,
  trailing,
  footer,
  children,
  className,
  wide = false,
  pad = true,
  testId,
}: {
  /** The header, drawn **outside and above** the surface, exactly as a group's is. */
  header?: ReactNode;
  trailing?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** A panel that genuinely wants the full column — a desktop grid's cell, a table. */
  wide?: boolean;
  /** False when what is inside draws its own rows, which carry the row padding themselves. */
  pad?: boolean;
  testId?: string;
}) {
  return (
    <section className={cx('w-full', wide ? '' : 'md:max-w-2xl')} style={{ marginBottom: 18 }}>
      {header && <PanelHeader title={header} trailing={trailing} />}
      <div
        data-testid={testId}
        className={cx('w-full overflow-hidden bg-[var(--ph-surface)]', pad && 'p-[13px]', className)}
        style={{ borderRadius: GROUP_RADIUS }}
      >
        {children}
      </div>
      {footer && <p className="px-[4px] pt-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{footer}</p>}
    </section>
  );
}

/** A group header for the things that are not groups: the same 11.5 px uppercase line, outside whatever follows. */
export function PanelHeader({ title, trailing }: { title: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-[4px] pb-[6px]">
      <h2 className="text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{title}</h2>
      {trailing && <span className="tabular shrink-0 text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{trailing}</span>}
    </div>
  );
}

/** The ground a net-worth screen is laid on: the kit's grey, bled out to the layout's own padding. */
export const SCREEN = 'ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8';
