import { cx } from '../../ui';

/**
 * Whose spending a row is, on a list that holds every workspace — an account's history, a card's statement.
 *
 * Shaded by kind rather than by name, from near black to a mid grey (the dark theme turns that round, `--ws-*`), so the same kind reads the same way wherever it
 * appears and no kind borrows a colour that means something else. An unknown kind falls back to the shared grey.
 */
const TINT: Record<string, string> = {
  personal: 'bg-[var(--ws-personal)] text-[var(--ws-glyph)]',
  family: 'bg-[var(--ws-family)] text-[var(--ws-glyph)]',
  business: 'bg-[var(--ws-business)] text-[var(--ws-glyph)]',
  shared: 'bg-[var(--ws-shared)] text-[var(--ws-glyph)]',
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

/**
 * Whose an account is, on the household's Net worth: the member's first letter, white and bold on the member's own
 * colour (`ownerRing`, so each person keeps one colour on both phones), laid on the corner of the account's circle as
 * `WorkspaceBadge corner` is. One's own accounts wear one's own letter, so every row says whose it is. The letter is
 * drawn, not written, and the mark is hidden from a screen reader: the row says whose it is in words.
 */
export function MemberBadge({ name, colour, size = 'row' }: { name: string; colour: string | null; size?: 'row' | 'hero' }) {
  const letter = name.trim().charAt(0).toUpperCase() || '·';
  return (
    <span
      aria-hidden
      data-testid="member-badge"
      data-letter={letter}
      title={name}
      className={cx(
        'absolute -right-1 -bottom-1 inline-flex items-center justify-center rounded-full leading-none font-bold text-white ring-2 ring-[var(--ph-surface)] before:content-[attr(data-letter)]',
        size === 'hero' ? 'h-[18px] w-[18px] text-[10px]' : 'h-4 w-4 text-[9px]',
      )}
      style={{ background: colour ?? 'var(--ws-shared)' }}
    />
  );
}
