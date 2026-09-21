import type { ReactNode } from 'react';
import { cx } from '../index';
import { useWide } from './InsetList';
import { planPanel } from './surface';

/**
 * A group's surface, for the things that are not rows — with its header outside and above it, as a group's is.
 *
 * `InsetGroup` clones its children to place them in the group, so it holds rows and only rows. A chart, a
 * gauge, a health tile, a card face or a form still on the old shapes is none of them, and every screen that
 * had one of those was reaching for the ringed `Card` the kit exists to remove. This is the same white, the
 * same radius and the same rhythm, with nothing of `InsetGroup` reimplemented: no separators, no positions.
 *
 * It is a primitive because it was already written twice — once inside `EventDetailPage` and once in
 * `features/networth/Panel.tsx`. The recurring fault on this project is a second copy of something that already
 * exists, so the shape lives here and both callers import it.
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
  const plan = planPanel({ wide: useWide(wide), pad });
  return (
    <section className={cx('w-full', plan.column && 'md:max-w-2xl')} style={{ marginBottom: plan.gap }}>
      {header && <PanelHeader title={header} trailing={trailing} />}
      <div
        data-testid={testId}
        className={cx('w-full overflow-hidden bg-[var(--ph-surface)]', className)}
        style={{ borderRadius: plan.radius, padding: plan.padding }}
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
      {trailing && (
        <span className="tabular shrink-0 text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{trailing}</span>
      )}
    </div>
  );
}

/** The ground a native screen is laid on: the kit's grey, bled out to the layout's own padding. */
export const SCREEN = 'ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8';
