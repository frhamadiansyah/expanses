import { type CategoryNeed, mccName, needOf } from '@expanses/core';
import {
  type AccountRow,
  addSetCategory,
  archiveAccount,
  clearCategoryMcc,
  clearCategoryNeed,
  createAccount,
  createCategorySet,
  deleteCategorySet,
  listCategoryMccs,
  renameAccount,
  renameCategorySet,
  saveCategoryMcc,
  saveCategoryNeed,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { isCategoryOf, useAccounts, useInOpenBook, useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { type CornerAction, ActionLine, InsetGroup, InsetRow, LargeTitle, LineAction, Panel, PanelHeader, SCREEN, SegmentedControl } from '../../ui/native';
import { categoryMcc } from './category-mcc';
import { useCategoryNeeds } from './need-queries';
import { useCategorySetMembership, useCategorySets } from './set-queries';

/** What card code a category carries, and where it came from. The quiet ink the kit gives a subtitle. */
function MccNote({ mcc, source }: { mcc: string | null; source?: string | null }) {
  return (
    <span className="tabular shrink-0 text-[12.5px] leading-[20px] text-[var(--ph-ink-3)]" title={mcc ? (mccName(mcc) ?? undefined) : undefined}>
      {mcc ? `MCC ${mcc}${source === 'yours' ? ' (yours)' : source === 'parent' ? ' (from parent)' : ''}` : 'No card MCC'}
    </span>
  );
}

/** Essential or lifestyle, and where the answer came from. Quiet ink, like the MCC beside it. */
function NeedNote({ name, need, source }: { name: string; need: CategoryNeed; source: 'yours' | 'parent' | null }) {
  return (
    <span data-testid={`need-${name}`} className="shrink-0 text-[12.5px] leading-[20px] text-[var(--ph-ink-3)]">
      {need === 'lifestyle' ? 'Lifestyle' : 'Essential'}
      {source === 'parent' ? ' (from parent)' : ''}
    </span>
  );
}

export function CategoriesPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [error, setError] = useState<unknown>(null);

  const membership = useCategorySetMembership().data ?? {};
  const inOpenBook = useInOpenBook();
  // The monthly tree only, and only the open book's: a set's categories are managed on the event that draws on them.
  const categories = (accounts.data ?? []).filter(isCategoryOf(kind)).filter((account) => membership[account.id] === undefined && inOpenBook(account));
  const sets = useCategorySets().data ?? [];
  const needs = useCategoryNeeds();
  const overrides = useQuery({ queryKey: ['category-mccs', ws.workspaceId], queryFn: () => listCategoryMccs(database, ws) });
  const allCategories = (accounts.data ?? []).filter((a) => a.subtype === 'category');
  const roots = categories.filter((c) => c.parentId === null);
  const childrenOf = (id: string) => categories.filter((c) => c.parentId === id);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }
  const add = (parent: AccountRow | null) => {
    const name = window.prompt(parent ? `New subcategory under ${parent.name}` : `New ${kind} category`);
    if (name?.trim()) void run(() => createAccount(database, ws, { name, kind, subtype: 'category', currency: null, parentId: parent?.id ?? null }));
  };
  const rename = (c: AccountRow) => {
    const name = window.prompt('Rename category', c.name);
    if (name?.trim() && name !== c.name) void run(() => renameAccount(database, ws, c.id, name));
  };
  const changeMcc = (c: AccountRow, current: string | null) => {
    const mcc = window.prompt(`Card MCC for ${c.name} (four digits). Purchases in this category use it when no merchant MCC is known.`, current ?? '');
    if (mcc?.trim() && mcc.trim() !== current) void run(() => saveCategoryMcc(database, ws, c.id, mcc.trim()));
  };
  const archive = (c: AccountRow) => {
    if (window.confirm(`Archive ${c.name}? Past transactions keep it.`)) void run(() => archiveAccount(database, ws, c.id));
  };

  const addSet = () => {
    const name = window.prompt('New set of categories, for events that spend on the same things every time');
    if (name?.trim()) void run(() => createCategorySet(database, ws, name));
  };
  const renameSet = (id: string, current: string) => {
    const name = window.prompt('Rename set', current);
    if (name?.trim() && name !== current) void run(() => renameCategorySet(database, ws, id, name));
  };
  const removeSet = (id: string, name: string) => {
    if (window.confirm(`Remove the ${name} set? Its categories and what was spent on them stay.`)) void run(() => deleteCategorySet(database, ws, id));
  };
  const addToSet = (id: string, name: string) => {
    const category = window.prompt(`New category in ${name}`);
    if (category?.trim()) void run(() => addSetCategory(database, ws, id, category));
  };

  const Row = ({ c, depth, first }: { c: AccountRow; depth: number; first: boolean }) => {
    const card = kind === 'expense' ? categoryMcc(c, allCategories, overrides.data ?? {}) : null;
    const need = kind === 'expense' ? needOf(c.id, allCategories, needs.data ?? {}) : null;
    const other: CategoryNeed | null = need ? (need.need === 'lifestyle' ? 'essential' : 'lifestyle') : null;
    return (
      <li>
        <ActionLine
          name={c.name}
          depth={depth}
          separator={!first}
          meta={
            <>
              {card && <MccNote mcc={card.mcc} source={card.source} />}
              {need && <NeedNote name={c.name} need={need.need} source={need.source} />}
            </>
          }
        >
          {card && (
            <>
              <LineAction label={`Card MCC for ${c.name}`} onClick={() => changeMcc(c, card.mcc)}>
                MCC
              </LineAction>
              {card.source === 'yours' && (
                <LineAction label={`Reset card MCC for ${c.name}`} onClick={() => void run(() => clearCategoryMcc(database, ws, c.id))}>
                  Reset
                </LineAction>
              )}
            </>
          )}
          {need && other && (
            <LineAction label={`Mark ${c.name} ${other}`} onClick={() => void run(() => saveCategoryNeed(database, ws, c.id, other))}>
              {other === 'lifestyle' ? 'Lifestyle' : 'Essential'}
            </LineAction>
          )}
          {need?.source === 'yours' && (
            <LineAction label={`Clear the mark on ${c.name}`} onClick={() => void run(() => clearCategoryNeed(database, ws, c.id))}>
              Clear mark
            </LineAction>
          )}
          {depth === 0 && <LineAction onClick={() => add(c)}>+ Sub</LineAction>}
          <LineAction onClick={() => rename(c)}>Rename</LineAction>
          <LineAction onClick={() => archive(c)}>Archive</LineAction>
        </ActionLine>
        {depth === 0 && childrenOf(c.id).length > 0 && (
          <ul>
            {childrenOf(c.id).map((child) => (
              <Row key={child.id} c={child} depth={1} first={false} />
            ))}
          </ul>
        )}
      </li>
    );
  };

  /* The primary action is a corner glyph at every width, not a dark rectangle beside the title. */
  const actions: CornerAction[] = [{ key: 'add', label: 'Add category', glyph: <Plus size={22} aria-hidden />, run: () => add(null) }];

  return (
    <div className={SCREEN}>
      <LargeTitle title="Categories" actions={actions} />
      {/* Two tabs that could never wrap, in the one control that replaces every underline tab row in the app. */}
      <SegmentedControl
        className="mb-[18px] md:max-w-xs"
        label="Which categories"
        segments={[
          { key: 'expense', label: 'Expense' },
          { key: 'income', label: 'Income' },
        ]}
        value={kind}
        onChange={(key) => setKind(key as 'expense' | 'income')}
      />
      <ErrorBox error={error} />

      <Panel
        wide
        pad={false}
        header="Every category"
        footer={
          kind === 'expense'
            ? 'Essential or lifestyle decides what an emergency fund covers and how the Budget splits what you spent. A category with no mark follows its parent, and counts as essential at the top.'
            : undefined
        }
      >
        <ul>
          {roots.map((c, index) => (
            <Row key={c.id} c={c} depth={0} first={index === 0} />
          ))}
        </ul>
      </Panel>

      {kind === 'expense' && (
        <section className="w-full">
          <PanelHeader title="Sets" />
          <p className="px-[4px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            Categories an event draws on, kept out of the list above. A set is named once and used by any number of events.
          </p>
          <div data-testid="category-sets">
            {/* One action, so it is the kit's row: the line itself is the button, with nothing else inside it. */}
            <InsetGroup wide>
              <InsetRow title="Add a set" onClick={addSet} />
            </InsetGroup>

            {sets.length === 0 && <Empty>No sets yet.</Empty>}

            {sets.map((set) => {
              const inSet = (accounts.data ?? []).filter((account) => membership[account.id] === set.id && account.archivedAt === null);
              return (
                <div key={set.id} data-testid={`set-${set.name}`}>
                  <Panel wide pad={false}>
                    <ActionLine name={set.name} separator={false}>
                      <LineAction label={`Add a category to ${set.name}`} onClick={() => addToSet(set.id, set.name)}>
                        + Category
                      </LineAction>
                      <LineAction label={`Rename ${set.name}`} onClick={() => renameSet(set.id, set.name)}>
                        Rename
                      </LineAction>
                      <LineAction label={`Remove ${set.name}`} onClick={() => removeSet(set.id, set.name)}>
                        Remove
                      </LineAction>
                    </ActionLine>
                    <ul>
                      {inSet.map((category) => {
                        // A set category has no key and no parent, so an MCC here is always one you set.
                        const card = categoryMcc(category, allCategories, overrides.data ?? {});
                        return (
                          <li key={category.id}>
                            <ActionLine name={category.name} depth={1} separator meta={<MccNote mcc={card.mcc} source="yours" />}>
                              <LineAction label={`Card MCC for ${category.name}`} onClick={() => changeMcc(category, card.mcc)}>
                                MCC
                              </LineAction>
                              {card.mcc !== null && (
                                <LineAction
                                  label={`Reset card MCC for ${category.name}`}
                                  onClick={() => void run(() => clearCategoryMcc(database, ws, category.id))}
                                >
                                  Reset
                                </LineAction>
                              )}
                              <LineAction label={`Rename ${category.name}`} onClick={() => rename(category)}>
                                Rename
                              </LineAction>
                              <LineAction label={`Archive ${category.name}`} onClick={() => archive(category)}>
                                Archive
                              </LineAction>
                            </ActionLine>
                          </li>
                        );
                      })}
                    </ul>
                  </Panel>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
