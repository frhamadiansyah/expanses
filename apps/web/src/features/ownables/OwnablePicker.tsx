import { assetFamily, type OwnableFamily, type OwnableFlow } from '@expanses/core';
import { type ReactNode, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { usePhone } from '../../app/use-phone';
import { cx } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SearchField } from '../../ui/native';
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

  /*
   * The two sentences that sit around the list. `moreHint` explains what "Something else" is showing; `hint`
   * says what does not belong on this screen at all. Both belong to the group, so they are its header and its
   * footer — the kit's own places for them — rather than paragraphs floating above and below a card. A search
   * narrows the list to what was typed, and neither sentence is about that, so both stand down while one runs.
   */
  const listHeader = !searching && !family ? kicker : undefined;
  const listFooter = searching
    ? undefined
    : more && family && moreHint
      ? moreHint(assetFamily(family).label)
      : !family
        ? hint
        : undefined;

  const list = (
    <>
      <div className="mb-[12px]">
        <SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
      </div>
      {/* The list is the answer to what is typed above it, so a screen reader hears it change, not only sees it. */}
      <div aria-live="polite">
        <InsetGroup header={listHeader} footer={listFooter}>
          {rows.length > 0 ? (
            rows.map((row) => <PickerInsetRow key={row.id} row={row} onClick={() => choose(row.id)} />)
          ) : (
            <InsetRow title={`Nothing here matches “${query.trim()}”.`} chevron={false} />
          )}
        </InsetGroup>
      </div>
      {handOver.length > 0 && !searching && !family && (
        <InsetGroup>
          {handOver.map((row) => {
            // A typed `Link` wherever the picker it hands over to has been built, so the router checks the path at
            // compile time; the rest stay a plain push until their route exists, which navigates just the same.
            const to = typedHandOver(row.to);
            return to ? <PickerInsetRow key={row.id} row={row} to={to} /> : <PickerInsetRow key={row.id} row={row} onClick={() => router.history.push(row.to)} />;
          })}
        </InsetGroup>
      )}
    </>
  );

  return (
    <div className={SCREEN}>
      {/* The step back is an undo of one step, not a destination, so it is named for what it does. */}
      <LargeTitle title={more ? 'Something else' : title} back={canGoBack ? 'Back' : undefined} onBack={back} />
      {/* One screen at a time on a phone; both at once on anything wider, the list on the left. */}
      <div className={cx('gap-6', chosen ? 'md:grid md:grid-cols-2 md:items-start' : '')}>
        <div className={cx(phone && chosen && 'hidden')}>{list}</div>
        {chosen && <div className={cx(phone ? '' : 'mt-4 md:mt-0')}>{children}</div>}
      </div>
    </div>
  );
}

/**
 * A choice, as a row: the emoji that names its family, what it is, the line under it, and a chevron.
 *
 * The kit draws the circle behind the emoji in its own neutral fill. The family's tint was a Tailwind class,
 * and `iconColour` wants a colour — reading one from the other would mean a second copy of the tint table, so
 * the emoji, which is what actually identifies the family, carries it alone.
 */
function PickerInsetRow({ row, onClick, to }: { row: PickerRow; onClick?: () => void; to?: TypedHandOver }) {
  return <InsetRow icon={row.icon} title={row.label} subtitle={row.sub} chevron onClick={onClick} to={to} />;
}

/** The pickers that exist as routes today. A hand-over anywhere else falls back to a push until its route lands. */
const TYPED_HAND_OVER = ['/accounts/new', '/net-worth/assets/new', '/debts/new'] as const;
type TypedHandOver = (typeof TYPED_HAND_OVER)[number];
const typedHandOver = (to: string): TypedHandOver | null => TYPED_HAND_OVER.find((path) => path === to) ?? null;

