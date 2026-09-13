import { mccName } from '@expanses/core';
import { type AccountRow, archiveAccount, clearCategoryMcc, createAccount, listCategoryMccs, renameAccount, saveCategoryMcc } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { isCategoryOf, useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, ErrorBox, PageHeader } from '../../ui';
import { categoryMcc } from './category-mcc';
import { useCategorySetMembership } from './set-queries';

export function CategoriesPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [error, setError] = useState<unknown>(null);

  const membership = useCategorySetMembership().data ?? {};
  // The monthly tree only: a set's categories are managed on the event that draws on them.
  const categories = (accounts.data ?? []).filter(isCategoryOf(kind)).filter((account) => membership[account.id] === undefined);
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

  const Row = ({ c, depth }: { c: AccountRow; depth: number }) => (
    <li>
      <div className={cx('flex items-center gap-2 py-1.5', depth > 0 && 'pl-6')}>
        <span className={cx('flex-1', depth === 0 && 'font-medium')}>{c.name}</span>
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
    </div>
  );
}
