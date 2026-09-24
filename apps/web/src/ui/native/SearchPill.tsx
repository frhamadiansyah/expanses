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
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  placeholder: string;
  /** What a screen reader hears on the field itself; the placeholder by default. */
  label?: string;
}) {
  return (
    <div className="flex h-11 items-center gap-2.5 rounded-full bg-[var(--ph-corner)] px-4">
      <Search size={18} className="shrink-0 text-[var(--ph-ink-3)]" aria-hidden />
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
        className="-mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  );
}
