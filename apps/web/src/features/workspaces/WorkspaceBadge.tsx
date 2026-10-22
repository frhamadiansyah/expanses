import { cx } from '../../ui';

/**
 * Whose spending a row is, on a list that holds every workspace — an account's history, a card's statement.
 *
 * Tinted by kind rather than by name, so the same kind reads the same way wherever it appears. An unknown kind
 * falls back to the shared tint rather than losing its colour.
 */
const TINT: Record<string, string> = {
  personal: 'bg-sky-100 text-sky-800',
  business: 'bg-violet-100 text-violet-800',
  family: 'bg-amber-100 text-amber-800',
  shared: 'bg-emerald-100 text-emerald-800',
};

/**
 * The workspace's round with its first letter, tinted by kind — not a pill of capitals after the name, which fought the
 * name for the line and cut a long one short. `corner`: laid on the corner of the row's category icon (the caller's
 * box is `relative`); otherwise drawn inline after the name, where a row has no icon. The full name is in it for a
 * screen reader and a tooltip; the letter is drawn, not written, so the text a reader hears is the name alone.
 */
export function WorkspaceBadge({ book, corner = false }: { book: { name: string; kind: string } | null; corner?: boolean }) {
  if (!book) return null;
  const letter = book.name.trim().charAt(0).toUpperCase() || '·';
  return (
    <span
      data-testid="workspace-badge"
      data-letter={letter}
      title={book.name}
      className={cx(
        'inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] leading-none font-bold before:content-[attr(data-letter)]',
        corner ? 'absolute -right-1 -bottom-1 ring-2 ring-[var(--ph-surface)]' : 'ml-1.5 align-[1px]',
        TINT[book.kind] ?? TINT.shared,
      )}
    >
      <span className="sr-only">{book.name}</span>
    </span>
  );
}

/**
 * The same tint, worn as a 22px round with the workspace's first letter — what a switcher row and the identity
 * block show, where there is room for a mark but not for a second copy of the name.
 */
export function WorkspaceDot({ book }: { book: { name: string; kind: string } | null }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase',
        TINT[book?.kind ?? ''] ?? TINT.shared,
      )}
    >
      {book?.name.trim().charAt(0) ?? '·'}
    </span>
  );
}
