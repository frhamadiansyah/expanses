import { type AccountRow, archiveAccount, createAccount, renameAccount } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { isCategoryOf, useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, ErrorBox, PageHeader } from '../../ui';

export function CategoriesPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [error, setError] = useState<unknown>(null);

  const categories = (accounts.data ?? []).filter(isCategoryOf(kind));
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
  const archive = (c: AccountRow) => {
    if (window.confirm(`Archive ${c.name}? Past transactions keep it.`)) void run(() => archiveAccount(database, ws, c.id));
  };

  const Row = ({ c, depth }: { c: AccountRow; depth: number }) => (
    <li>
      <div className={cx('flex items-center gap-2 py-1.5', depth > 0 && 'pl-6')}>
        <span className={cx('flex-1', depth === 0 && 'font-medium')}>{c.name}</span>
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
