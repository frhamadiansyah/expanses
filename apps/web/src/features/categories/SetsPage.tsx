import { MoreHorizontal, Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { CornerButton, CornerMenu, InsetGroup, InsetRow, PushedTitle, SCREEN, type CornerAction, type GroupChild } from '../../ui/native';
import { ALERT_ROW, NoticeAlert } from '../../ui/native/NoticeAlert';
import { categoryMark } from './CategoryIcon';
import { useBooks } from '../workspaces/queries';
import { useCategorySetMembership, useCategorySets } from './set-queries';
import { useCategoryActions } from './use-category-actions';

/**
 * The sets: categories an event draws on, kept out of the monthly tree. Each set is a group under its own name, its
 * categories rows that open their own page. The box's first row names the set, with ＋ to add a category and ••• for
 * the set's own changes.
 */
export function SetsPage() {
  const accounts = useAccounts().data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const sets = useCategorySets();
  const actions = useCategoryActions();
  const { ws } = useApp();
  // The other open workspaces a set can be copied into; none, and the row is not offered.
  const others = (useBooks().data ?? []).filter((book) => book.id !== ws.bookId);
  const [copying, setCopying] = useState<{ id: string; name: string } | null>(null);
  const [moving, setMoving] = useState<{ id: string; name: string } | null>(null);
  const [asking, setAsking] = useState<{ id: string; name: string; bookId: string; bookName: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Sets"
        back="Categories"
        backTo="/categories"
        actions={[{ key: 'add', label: 'Add set', glyph: <Plus size={22} aria-hidden />, run: actions.addSet }]}
      />
      <ErrorBox error={actions.error} />
      {note && (
        <p data-testid="set-copied" className="px-[4px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-tint)]">
          {note}
        </p>
      )}

      <div data-testid="category-sets">
        {sets.isSuccess && sets.data.length === 0 && <Empty>No sets yet.</Empty>}
        {(sets.data ?? []).map((set) => {
          const inSet = accounts.filter((account) => membership[account.id] === set.id && account.archivedAt === null);
          return (
            <div key={set.id} data-testid={`set-${set.name}`}>
              <InsetGroup>
                <SetHeader
                  name={set.name}
                  onAdd={() => actions.addToSet(set.id, set.name)}
                  menu={[
                    { key: 'rename', label: 'Rename', name: `Rename ${set.name}`, run: () => actions.renameSet(set.id, set.name) },
                    ...(others.length > 0
                      ? [
                          { key: 'copy', label: 'Copy to another workspace', name: `Copy ${set.name} to another workspace`, run: () => setCopying({ id: set.id, name: set.name }) },
                          { key: 'move', label: 'Move to another workspace', name: `Move ${set.name} to another workspace`, run: () => setMoving({ id: set.id, name: set.name }) },
                        ]
                      : []),
                    { key: 'remove', label: 'Remove set', name: `Remove ${set.name}`, destructive: true, run: () => actions.removeSet(set.id, set.name) },
                  ]}
                />
                {inSet.map((category) => {
                  const { Glyph, colour } = categoryMark(category.id, accounts);
                  return (
                    <InsetRow
                      key={category.id}
                      icon={<Glyph size={15} strokeWidth={2.2} />}
                      iconColour={colour}
                      title={category.name}
                      to="/categories/$categoryId"
                      params={{ categoryId: category.id }}
                    />
                  );
                })}
              </InsetGroup>
            </div>
          );
        })}
      </div>
      {moving && !asking && (
        <Sheet title={`Move ${moving.name}`} onClose={() => setMoving(null)}>
          <div data-testid="move-set-targets" className="overflow-hidden rounded-[18px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
            {others.map((book) => (
              <button
                key={book.id}
                type="button"
                data-testid="move-set-target"
                onClick={() => setAsking({ ...moving, bookId: book.id, bookName: book.name })}
                className="ph-focus-inset flex min-h-[46px] w-full items-center justify-center text-[17px] text-[var(--ph-ink)] active:bg-[var(--ph-fill)]"
              >
                {book.name}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {asking && (
        <NoticeAlert
          title="Move set"
          text="Its categories, and the events using it, move with it."
          closeLabel="Not now"
          onClose={() => {
            setAsking(null);
            setMoving(null);
          }}
          actions={
            <button
              type="button"
              onClick={async () => {
                const from = asking;
                setAsking(null);
                setMoving(null);
                setNote(null);
                if (await actions.moveSet(from.id, from.bookId)) setNote(`Moved to ${from.bookName}`);
              }}
              className={`${ALERT_ROW} font-semibold`}
            >
              Move
            </button>
          }
        />
      )}
      {copying && (
        <Sheet title={`Copy ${copying.name}`} onClose={() => setCopying(null)}>
          <div data-testid="copy-set-targets" className="overflow-hidden rounded-[18px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
            {others.map((book) => (
              <button
                key={book.id}
                type="button"
                data-testid="copy-set-target"
                onClick={async () => {
                  const from = copying;
                  setCopying(null);
                  setNote(null);
                  if (await actions.copySet(from.id, book.id)) setNote(`Copied to ${book.name}`);
                }}
                className="ph-focus-inset flex min-h-[46px] w-full items-center justify-center text-[17px] text-[var(--ph-ink)] active:bg-[var(--ph-fill)]"
              >
                {book.name}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** A set's first row: its name, then the round ＋ and ••• at the right. Placed by `InsetGroup` like any row. */
function SetHeader({ name, onAdd, menu, position }: GroupChild & { name: string; onAdd: () => void; menu: CornerAction[] }) {
  return (
    <div className="relative flex min-h-[52px] items-center gap-[8px] px-[16px]">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 right-[16px] left-[16px] h-[0.5px] bg-[var(--ph-hair)]" />}
      <h2 className="min-w-0 flex-1 truncate text-[17px] leading-[22px] font-semibold text-[var(--ph-ink)]">{name}</h2>
      <CornerButton label={`Add a category to ${name}`} onClick={onAdd} size={30} grey>
        <Plus size={16} aria-hidden />
      </CornerButton>
      <CornerMenu label={`More for ${name}`} glyph={<MoreHorizontal size={16} aria-hidden />} actions={menu} size={30} grey float />
    </div>
  );
}
