import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Sheet } from '../../app/Sheet';
import { RowGlyph } from './FormRow';

export interface Choice {
  value: string;
  label: string;
  /** The quiet line at the right: a currency, a date. */
  caption?: string;
  /** The row's own drawing, in the circle every row of the add form leads with. */
  glyph: ReactNode;
}

export interface ChoiceGroup {
  /** Left off for a list of one group. */
  title?: string;
  choices: readonly Choice[];
}

/**
 * One list to choose from, as the Paid with list is drawn: the circle, the name, a caption, and a ✓ on the one
 * already chosen. The rows a card opens by a ›, so every choice on the form is made the same way — a native select
 * in a boxed row read as a different control, and drew the browser's own focus box around itself.
 */
export function ChoiceSheet({
  title,
  groups,
  value,
  footer,
  onPick,
  onClose,
}: {
  title: string;
  groups: readonly ChoiceGroup[];
  value: string;
  /** A sentence about the choice, under the list: the place to say what choosing it does. */
  footer?: ReactNode;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet grouped title={title} onClose={onClose}>
      <div className="flex flex-col gap-[18px]">
        {groups
          .filter((group) => group.choices.length > 0)
          .map((group, index) => (
            <section key={group.title ?? index} aria-label={group.title}>
              {group.title && <h3 className="mb-[6px] px-[14px] text-[12px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase">{group.title}</h3>}
              <ul className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>li+li>button>.ph-row-body]:border-t-[0.5px] [&>li+li>button>.ph-row-body]:border-[var(--ph-hair)]">
                {group.choices.map((choice) => (
                  <li key={choice.value || 'none'}>
                    <button
                      type="button"
                      aria-label={choice.label}
                      aria-pressed={value === choice.value}
                      onClick={() => {
                        onPick(choice.value);
                        onClose();
                      }}
                      className="ph-focus-inset flex w-full items-center gap-[10px] pl-[10px] text-left active:bg-[var(--ph-fill)]"
                    >
                      <RowGlyph>{choice.glyph}</RowGlyph>
                      <span className="ph-row-body flex min-h-12 min-w-0 flex-1 items-center gap-3 pr-[14px]">
                        <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--ph-ink)]">{choice.label}</span>
                        {choice.caption && (
                          <span aria-hidden className="shrink-0 text-[12.5px] text-[var(--ph-ink-3)]">
                            {choice.caption}
                          </span>
                        )}
                        {value === choice.value && <Check size={18} aria-label="Chosen" className="shrink-0 text-[var(--ph-ink)]" />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        {footer && <p className="px-[14px] text-[12.5px] leading-4 text-[var(--ph-ink-3)]">{footer}</p>}
      </div>
    </Sheet>
  );
}
