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

export function WorkspaceBadge({ book }: { book: { name: string; kind: string } | null }) {
  if (!book) return null;
  return (
    <span data-testid="workspace-badge" className={cx('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase', TINT[book.kind] ?? TINT.shared)}>
      {book.name}
    </span>
  );
}
