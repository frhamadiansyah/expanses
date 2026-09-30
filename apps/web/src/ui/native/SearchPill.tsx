import { Search, X } from 'lucide-react';

/**
 * The search field a screen draws in its own title row: a pill with the magnifier, the field, and a way out.
 *
 * One definition, because two screens draw the same control — Cashflow and the pickers: on a phone the list's own
 * search box stands down and this takes the title's place, so the field is where a thumb already is and the page
 * below it never moves. It is a corner's 44 px tall for the same reason.
 */
export function SearchPill({
  value,
  onChange,
  onClose,
  placeholder,
  label = placeholder,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  placeholder: string;
  /** What a screen reader hears on the field itself; the placeholder by default. */
  label?: string;
  /** The segmented control's own 32 px, for a field that takes a tab row's place in a sheet and must not change it. */
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center rounded-full bg-[var(--ph-corner)] ${compact ? 'h-8 gap-2 px-3' : 'h-11 gap-2.5 px-4'}`}>
      <Search size={compact ? 15 : 18} className="shrink-0 text-[var(--ph-ink-3)]" aria-hidden />
      <input
        // biome-ignore lint/a11y/noAutofocus: the field was asked for by tapping search, so it should be ready to type in
        autoFocus
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-base focus:outline-none"
      />
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className={`flex shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)] ${compact ? 'ph-tap -mr-1 h-7 w-7' : '-mr-2 h-9 w-9'}`}
      >
        <X size={compact ? 15 : 18} aria-hidden />
      </button>
    </div>
  );
}
