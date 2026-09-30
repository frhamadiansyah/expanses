import { noteSuggestions, type NoteSuggestion } from '@expanses/db';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { KeyboardStrip } from '../../ui/native/KeyboardStrip';

/** The note with the typed part in bold, where it matches: at the start of the note or of one of its words. */
function Marked({ text, typed }: { text: string; typed: string }) {
  const want = typed.trim().toLowerCase();
  const lower = text.toLowerCase();
  let at = lower.startsWith(want) ? 0 : lower.indexOf(` ${want}`);
  if (at > 0) at += 1;
  if (!want || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b className="font-semibold">{text.slice(at, at + want.length)}</b>
      {text.slice(at + want.length)}
    </>
  );
}

/**
 * Notes written before that match what is being typed in Note, offered in a strip over the keyboard the way iOS
 * offers its own words there: up to three cells, each the note and, under it, the category it was last filed
 * under. A tap takes the note (and the category, when none is chosen yet) without the field losing focus.
 *
 * On a phone it rides the top of the keyboard; with no keyboard on screen (a desktop) it sits at the foot of the
 * window instead, which is where a hardware keyboard's owner looks for nothing, so it is drawn only on a phone.
 */
export function NoteSuggestions({
  typed,
  kind,
  open,
  categoryName,
  onPick,
}: {
  typed: string;
  /** Which kind of category a pick may bring; null for a transfer or a trade, which get no suggestions. */
  kind: 'expense' | 'income' | null;
  open: boolean;
  categoryName: (id: string) => string | undefined;
  onPick: (suggestion: NoteSuggestion) => void;
}) {
  const { database, ws } = useApp();
  const want = typed.trim();
  const found = useQuery({
    queryKey: ['note-suggestions', ws.workspaceId, ws.bookId ?? '', kind, want.toLowerCase()],
    queryFn: () => noteSuggestions(database, ws, want, kind ?? 'expense'),
    enabled: open && kind !== null && want.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const rows = open && kind !== null && want.length >= 2 ? (found.data ?? []) : [];
  return (
    <KeyboardStrip
      label="Suggested notes"
      cells={rows.map((suggestion) => {
        const category = suggestion.categoryId ? categoryName(suggestion.categoryId) : undefined;
        return {
          key: suggestion.description,
          label: category ? `${suggestion.description}, ${category}` : suggestion.description,
          title: <Marked text={suggestion.description} typed={want} />,
          detail: category,
          onPick: () => onPick(suggestion),
        };
      })}
    />
  );
}
