import { type ReactNode, useState } from 'react';
import { InfoButton } from '../budget/budget-rows';

/** A group's plain header with its explanation behind an ⓘ, shown under the header when asked for. */
export function InfoHeader({ title, info }: { title: string; info?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-[4px] pb-[6px]">
      <div className="flex items-center gap-[6px]">
        <h2 className="text-[11.5px] leading-[14px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{title}</h2>
        {info && <InfoButton label={title} open={open} onToggle={() => setOpen((was) => !was)} />}
      </div>
      {info && open && <p className="pt-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{info}</p>}
    </div>
  );
}
