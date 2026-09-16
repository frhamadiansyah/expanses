import { mccName } from '@expanses/core';
import {
  type AccountRow,
  addSetCategory,
  archiveAccount,
  clearCategoryMcc,
  createAccount,
  createCategorySet,
  deleteCategorySet,
  listCategoryMccs,
  renameAccount,
  renameCategorySet,
  saveCategoryMcc,
} from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { isCategoryOf, useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, PageHeader } from '../../ui';
import { categoryMcc } from './category-mcc';
import { useCategorySetMembership, useCategorySets } from './set-queries';

export function CategoriesPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [error, setError] = useState<unknown>(null);

  const membership = useCategorySetMembership().data ?? {};
  // The monthly tree only: a set's categories are managed on the event that draws on them.
  const categories = (accounts.data ?? []).filter(isCategoryOf(kind)).filter((account) => membership[account.id] === undefined);
  const sets = useCategorySets().data ?? [];
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

  const Row = ({ c, depth }: { c: AccountRow; depth: number }) => (
    <li>
      {/* Name, code and four buttons do not fit a phone in one line, so the buttons wrap under the name. */}
      <div className={cx('flex flex-wrap items-center gap-2 py-1.5', depth > 0 && 'pl-6')}>
        <span className={cx('min-w-0 flex-1 basis-full sm:basis-auto', depth === 0 && 'font-medium')}>{c.name}</span>
        {kind === 'expense' && (() => {
          const card = categoryMcc(c, allCategories, overrides.data ?? {});
          return (
            <>
              <span className="tabular text-xs text-slate-500" title={card.mcc ? (mccName(card.mcc) ?? undefined) : undefined}>
                {card.mcc ? `MCC ${card.mcc}${card.source === 'yours' ? ' (yours)' : card.source === 'parent' ? ' (from parent)' : ''}` : 'No card MCC'}
              </span>
              <Button variant="ghost" onClick={() => changeMcc(c, card.mcc)} aria-label={`Card MCC for ${c.name}`}>
                MCC
              </Button>
              {card.source === 'yours' && (
                <Button variant="ghost" onClick={() => void run(() => clearCategoryMcc(database, ws, c.id))} aria-label={`Reset card MCC for ${c.name}`}>
                  Reset
                </Button>
              )}
            </>
          );
        })()}
        {depth === 0 && (
          <Button variant="ghost" onClick={() => add(c)}>
            + Sub
          </Button>
        )}
        <Button variant="ghost" onClick={() => rename(c)}>
          Rename
        </Button>
        <Button variant="ghost" onClick={() => archive(c)}>
          Archive
        </Button>
      </div>
      {depth === 0 && childrenOf(c.id).length > 0 && (
        <ul>
          {childrenOf(c.id).map((child) => (
            <Row key={child.id} c={child} depth={1} />
          ))}
        </ul>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Categories" action={<Button onClick={() => add(null)}>Add category</Button>} />
      <div className="flex gap-2">
        {(['expense', 'income'] as const).map((k) => (
          <Button key={k} variant={kind === k ? 'primary' : 'secondary'} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === 'expense' ? 'Expense' : 'Income'}
          </Button>
        ))}
      </div>
      <ErrorBox error={error} />
      <Card>
        <ul className="divide-y divide-slate-100">
          {roots.map((c) => (
            <Row key={c.id} c={c} depth={0} />
          ))}
        </ul>
      </Card>

      {kind === 'expense' && (
        <Card className="space-y-3">
          <div data-testid="category-sets" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Sets</h2>
                <p className="text-xs text-slate-500">
                  Categories an event draws on, kept out of the list above. A set is named once and used by any number of events.
                </p>
              </div>
              <Button variant="secondary" onClick={addSet}>
                Add a set
              </Button>
            </div>

            {sets.length === 0 && <Empty>No sets yet.</Empty>}

            {sets.map((set) => {
              const inSet = (accounts.data ?? []).filter((account) => membership[account.id] === set.id && account.archivedAt === null);
              return (
                <div key={set.id} data-testid={`set-${set.name}`} className="border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 font-medium">{set.name}</span>
                    <Button variant="ghost" onClick={() => addToSet(set.id, set.name)} aria-label={`Add a category to ${set.name}`}>
                      + Category
                    </Button>
                    <Button variant="ghost" onClick={() => renameSet(set.id, set.name)} aria-label={`Rename ${set.name}`}>
                      Rename
                    </Button>
                    <Button variant="ghost" onClick={() => removeSet(set.id, set.name)} aria-label={`Remove ${set.name}`}>
                      Remove
                    </Button>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {inSet.map((category) => (
                      <li key={category.id} className="flex flex-wrap items-center gap-2 py-1.5 pl-6">
                        <span className="min-w-0 flex-1 basis-full sm:basis-auto">{category.name}</span>
                        {(() => {
                          // A set category has no key and no parent, so an MCC here is always one you set.
                          const card = categoryMcc(category, allCategories, overrides.data ?? {});
                          return (
                            <>
                              <span className="tabular text-xs text-slate-500" title={card.mcc ? (mccName(card.mcc) ?? undefined) : undefined}>
                                {card.mcc ? `MCC ${card.mcc} (yours)` : 'No card MCC'}
                              </span>
                              <Button variant="ghost" onClick={() => changeMcc(category, card.mcc)} aria-label={`Card MCC for ${category.name}`}>
                                MCC
                              </Button>
                              {card.mcc !== null && (
                                <Button
                                  variant="ghost"
                                  onClick={() => void run(() => clearCategoryMcc(database, ws, category.id))}
                                  aria-label={`Reset card MCC for ${category.name}`}
                                >
                                  Reset
                                </Button>
                              )}
                            </>
                          );
                        })()}
                        <Button variant="ghost" onClick={() => rename(category)} aria-label={`Rename ${category.name}`}>
                          Rename
                        </Button>
                        <Button variant="ghost" onClick={() => archive(category)} aria-label={`Archive ${category.name}`}>
                          Archive
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
