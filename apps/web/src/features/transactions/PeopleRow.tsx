import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';

/** One person in the row: the key tells them apart, the name is the label and the initial. */
export interface Circle {
  key: string;
  name: string;
}

/**
 * People as one sideways row of initial circles: no wrapping, no scrollbar, a soft fade where it runs on. A picked
 * person is filled ink with a check. The With sheet and the receipt page both draw it, so a person looks the same
 * wherever they are chosen.
 */
export function PeopleRow({
  people,
  picked,
  onToggle,
  scrollTo,
  testId,
}: {
  people: readonly Circle[];
  picked: (key: string) => boolean;
  onToggle: (key: string) => void;
  /** The key of somebody just added: the row scrolls to bring them into view. */
  scrollTo?: string;
  testId?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollTo) return;
    const circle = [...(row.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find((el) => el.dataset.key === scrollTo);
    circle?.scrollIntoView?.({ inline: 'end', block: 'nearest' });
  }, [scrollTo]);
  return (
    <div
      ref={row}
      className="-mx-1 flex snap-x gap-[14px] overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(90deg,#000_calc(100%-34px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid={testId}
    >
      {people.map((person) => {
        const on = picked(person.key);
        return (
          <button key={person.key} data-key={person.key} type="button" aria-label={person.name} aria-pressed={on} onClick={() => onToggle(person.key)} className="ph-tap w-[62px] shrink-0 snap-start text-center">
            <span
              className={`relative mx-auto flex h-[54px] w-[54px] items-center justify-center rounded-full text-[20px] font-semibold ${on ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--ph-fill)] text-[var(--ph-ink-2)]'}`}
            >
              {person.name.trim().charAt(0).toUpperCase() || '?'}
              {on && (
                <span aria-hidden className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--ph-surface)] text-[var(--ph-ink)] ring-[1.5px] ring-[var(--ph-ink)]">
                  <Check size={11} strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="mt-1 block truncate text-[12.5px] leading-4 text-[var(--ph-ink)]">{person.name}</span>
          </button>
        );
      })}
    </div>
  );
}
