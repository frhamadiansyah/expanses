import { noteSuggestions, type NoteSuggestion } from '@expanses/db';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../app/context';

/**
 * How far the on-screen keyboard reaches up from the bottom of the window, read from the visual viewport — the
 * part of the page still showing above it. Zero where there is no keyboard, which on a desktop is always.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const view = window.visualViewport;
    if (!view) return;
    const measure = () => setInset(Math.max(0, Math.round(window.innerHeight - view.height - view.offsetTop)));
    measure();
    view.addEventListener('resize', measure);
    view.addEventListener('scroll', measure);
    return () => {
      view.removeEventListener('resize', measure);
      view.removeEventListener('scroll', measure);
    };
  }, []);
  return inset;
}

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
  const inset = useKeyboardInset();
  const want = typed.trim();
  const found = useQuery({
    queryKey: ['note-suggestions', ws.workspaceId, ws.bookId ?? '', kind, want.toLowerCase()],
    queryFn: () => noteSuggestions(database, ws, want, kind ?? 'expense'),
    enabled: open && kind !== null && want.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const rows = open && kind !== null && want.length >= 2 ? (found.data ?? []) : [];
  if (rows.length === 0) return null;

  return createPortal(
    <div
      role="listbox"
      aria-label="Suggested notes"
      className="fixed inset-x-0 z-50 flex border-t-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-bar)] md:hidden"
      style={{
        bottom: inset,
        backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: inset === 0 ? 'env(safe-area-inset-bottom)' : undefined,
      }}
    >
      {rows.map((suggestion, i) => {
        const category = suggestion.categoryId ? categoryName(suggestion.categoryId) : undefined;
        return (
          <Fragment key={suggestion.description}>
            {i > 0 && <span aria-hidden className="my-[10px] w-[0.5px] shrink-0 bg-[var(--ph-hair)]" />}
            <button
              type="button"
              role="option"
              aria-selected={false}
              aria-label={category ? `${suggestion.description}, ${category}` : suggestion.description}
              // Down, not click: a click would take the focus off Note first and fold the keyboard away under the tap.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onPick(suggestion)}
              className="ph-focus-inset flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center px-2 py-1 text-center active:bg-[var(--ph-fill)]"
            >
              <span className="w-full truncate text-[15px] leading-5 text-[var(--ph-ink)]">
                <Marked text={suggestion.description} typed={want} />
              </span>
              {category && <span className="w-full truncate text-[11px] leading-[14px] text-[var(--ph-ink-3)]">{category}</span>}
            </button>
          </Fragment>
        );
      })}
    </div>,
    document.body,
  );
}
