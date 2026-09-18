import { assetFamily, type OwnableFamily, type OwnableFlow } from '@expanses/core';
import { Link, useRouter } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { usePhone } from '../../app/use-phone';
import { cx, Input, Kicker, RowHint } from '../../ui';
import { type HandOverRow, MORE_ROW_ID, type PickerRow, pickerRows } from './catalogue-view';

/**
 * Two levels and a search box: the family, then the thing, the way the category picker already works.
 *
 * The same component serves all three flows because they differ only in which rows they draw — the catalogue
 * answers that — and in the form that follows, which the caller passes in as children.
 *
 * A phone gets one screen at a time: the list, then the form, with a Back button that undoes exactly one step.
 * A wider screen keeps the list where it is and puts the form beside it, so choosing again is one click rather
 * than a click and a Back; desktop is never given the phone's smaller version of the same screen.
 */
export function OwnablePicker({
  flow,
  title,
  kicker,
  searchPlaceholder,
  hint,
  moreHint,
  chosen,
  onChoose,
  handOver = [],
  children,
}: {
  flow: OwnableFlow;
  /** The screen's own heading — "New account", "What do you own?", "New debt". */
  title: string;
  /** The small heading over the list, when the list is one named group. */
  kicker?: string;
  searchPlaceholder: string;
  /** The sentence under the list, saying what does not belong here. */
  hint?: ReactNode;
  /** The sentence above the "Something else" list, given the open family's name to put in it. */
  moreHint?: (familyLabel: string) => ReactNode;
  /** The item id whose form is open, or null while nobody has chosen. */
  chosen: string | null;
  onChoose: (id: string | null) => void;
  handOver?: HandOverRow[];
  /** The chosen item's form. */
  children?: ReactNode;
}) {
  const phone = usePhone();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<OwnableFamily | null>(null);
  const [more, setMore] = useState(false);

  const searching = query.trim() !== '';
  const rows = pickerRows({ flow, query, family: family ?? undefined, more });

  /**
   * One step back: out of the form, out of a search, out of "Something else", out of a family. Nothing else moves.
   *
   * A typed query is a step of its own, above the family it hides: without that, Back on a search result looks
   * broken — it would drop the family underneath while the results, which do not depend on it, stayed put.
   */
  const back = () => {
    if (chosen) onChoose(null);
    else if (searching) setQuery('');
    else if (more) setMore(false);
    else if (family) setFamily(null);
  };
  const canGoBack = Boolean(chosen || searching || more || family);

  function choose(id: string) {
    if (id === MORE_ROW_ID) {
      setMore(true);
      return;
    }
    // A family row opens that family; anything else is a thing, and opens its form.
    if (flow === 'asset' && !searching && !family && !more) {
      setFamily(id as OwnableFamily);
      return;
    }
    onChoose(id);
  }

  const list = (
    <div className="space-y-2">
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
      {/* Above the list, not under it: on this screen it says what the rows below all have in common. */}
      {more && family && !searching && moreHint && <RowHint>{moreHint(assetFamily(family).label)}</RowHint>}
      {kicker && !searching && !family && <Kicker>{kicker}</Kicker>}
      <RowList>
        {rows.map((row) => (
          <PickerButton key={row.id} row={row} onClick={() => choose(row.id)} />
        ))}
        {rows.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">Nothing here matches “{query.trim()}”.</p>}
      </RowList>
      {hint && !searching && !family && <RowHint>{hint}</RowHint>}
      {handOver.length > 0 && !searching && !family && (
        <RowList>
          {handOver.map((row) => {
            // A typed `Link` wherever the picker it hands over to has been built, so the router checks the path at
            // compile time; the rest stay a plain push until their route exists, which navigates just the same.
            const to = typedHandOver(row.to);
            return to ? <PickerLink key={row.id} row={row} to={to} /> : <PickerButton key={row.id} row={row} onClick={() => router.history.push(row.to)} />;
          })}
        </RowList>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-lg md:max-w-4xl">
      <div className="mb-4 flex items-center gap-2">
        {canGoBack ? (
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900"
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
        ) : (
          <span className="h-9 w-9 shrink-0 md:hidden" />
        )}
        <h1 className="text-xl font-semibold">{more ? 'Something else' : title}</h1>
      </div>
      {/* One screen at a time on a phone; both at once on anything wider, the list on the left. */}
      <div className={cx('gap-6', chosen ? 'md:grid md:grid-cols-2 md:items-start' : '')}>
        <div className={cx(phone && chosen && 'hidden')}>{list}</div>
        {chosen && <div className={cx(phone ? '' : 'mt-4 md:mt-0')}>{children}</div>}
      </div>
    </div>
  );
}

/** The card a run of picker buttons sits in. Its own, not the row kit's: these rows are two lines and a tile. */
function RowList({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">{children}</div>;
}

const PICKER_ROW =
  'flex min-h-14 w-full items-center gap-3 border-t border-slate-100 px-3 py-2 text-left first:border-t-0 hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-slate-900';

/** The tile, the label and the quiet line under it — the same whether the row acts or navigates. */
function PickerBody({ row }: { row: PickerRow }) {
  return (
    <>
      {/* Decoration: the label is what a screen reader and a test read this row by. */}
      <span aria-hidden className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base', row.tint)}>
        {row.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{row.label}</span>
        <span className="block truncate text-xs text-slate-500">{row.sub}</span>
      </span>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-slate-400" />
    </>
  );
}

function PickerButton({ row, onClick }: { row: PickerRow; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={PICKER_ROW}>
      <PickerBody row={row} />
    </button>
  );
}

/** The pickers that exist as routes today. A hand-over anywhere else falls back to a push until its route lands. */
const TYPED_HAND_OVER = ['/accounts/new', '/net-worth/assets/new', '/debts/new'] as const;
type TypedHandOver = (typeof TYPED_HAND_OVER)[number];
const typedHandOver = (to: string): TypedHandOver | null => TYPED_HAND_OVER.find((path) => path === to) ?? null;

function PickerLink({ row, to }: { row: PickerRow; to: TypedHandOver }) {
  return (
    <Link to={to} className={PICKER_ROW}>
      <PickerBody row={row} />
    </Link>
  );
}
