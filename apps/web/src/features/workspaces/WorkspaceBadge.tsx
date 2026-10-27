import { cx } from '../../ui';

/**
 * Whose spending a row is, on a list that holds every workspace — an account's history, a card's statement.
 *
 * Shaded by kind rather than by name, from near black to a mid grey, so the same kind reads the same way wherever it
 * appears and no kind borrows a colour that means something else. An unknown kind falls back to the shared grey.
 */
const TINT: Record<string, string> = {
  personal: 'bg-[#1c1c1e] text-white',
  family: 'bg-[#48484a] text-white',
  business: 'bg-[#6c6c70] text-white',
  shared: 'bg-[#8e8e93] text-white',
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
export function WorkspaceDot({ book, size = 22 }: { book: { name: string; kind: string } | null; size?: number }) {
  return (
    <span
      aria-hidden
      className={cx('flex shrink-0 items-center justify-center rounded-full font-semibold uppercase', TINT[book?.kind ?? ''] ?? TINT.shared)}
      style={{ width: size, height: size, fontSize: size >= 30 ? 15 : size >= 26 ? 13 : 11 }}
    >
      {book?.name.trim().charAt(0) ?? '·'}
    </span>
  );
}
