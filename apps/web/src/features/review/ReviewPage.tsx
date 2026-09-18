import { formatMinor } from '@expanses/core';
import { confirmDraft, dismissDraft, editDraft } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { canPayWith } from '../../lib/account-types';
import { isMoneyAccount, useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, cx, Empty, ErrorBox, PageHeader, Select } from '../../ui';
import { CategoryOptions } from '../cards/options';
import { useDrafts } from './queries';

/**
 * Captured spending, waiting to be confirmed.
 *
 * Nothing a parser produces reaches the ledger on its own. That is what makes it safe for a bank to
 * change its statement layout without warning: a broken parser fills this queue with nonsense, which
 * is a nuisance, rather than the books, which would be a problem.
 */
export function ReviewPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const drafts = useDrafts();
  const accounts = useAccounts().data ?? [];
  // Confirming a draft records real spending, so the account it names has to be one that can pay.
  const money = accounts.filter((a) => isMoneyAccount(a) && canPayWith(a));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string, work: () => Promise<unknown>) {
    setError(null);
    setBusy(id);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const list = drafts.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Review" />
      <ErrorBox error={error ?? drafts.error} />

      {drafts.isSuccess && list.length === 0 && <Empty>Nothing waiting. Captured spending appears here before it reaches your accounts.</Empty>}

      {list.length > 0 && (
        <Card>
          <p className="mb-2 text-xs text-slate-500">{list.length} waiting. Nothing here has been recorded yet — check what was read, then confirm it.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                  <th className="py-1 pr-2">Paid with</th>
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {list.map((draft) => (
                  <tr key={draft.id} data-testid="draft-row" className={cx('border-t border-slate-100', busy === draft.id && 'opacity-50')}>
                    <td className="py-1 pr-2 whitespace-nowrap">{draft.occurredOn}</td>
                    <td className="py-1 pr-2">
                      {draft.description}
                      {draft.confidence !== null && draft.confidence < 80 && <span className="ml-2 text-xs text-amber-700">unsure</span>}
                    </td>
                    <td className="tabular py-1 pr-2 text-right whitespace-nowrap">{formatMinor(Math.abs(draft.amountMinor), draft.currency)}</td>
                    <td className="py-1 pr-2">
                      <Select
                        aria-label={`Account for ${draft.description}`}
                        value={draft.accountId ?? ''}
                        onChange={(e) => void run(draft.id, () => editDraft(database, ws, draft.id, { accountId: e.target.value }))}
                        className="py-1"
                      >
                        <option value="">Choose…</option>
                        {money.map((account) => (
                          <option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1 pr-2">
                      <Select
                        aria-label={`Category for ${draft.description}`}
                        value={draft.categoryAccountId ?? ''}
                        onChange={(e) => void run(draft.id, () => editDraft(database, ws, draft.id, { categoryAccountId: e.target.value }))}
                        className="py-1"
                      >
                        {/* Confirming a draft records real spending, so it may only name the open workspace's categories. */}
                        <CategoryOptions accounts={accounts} kind={draft.amountMinor >= 0 ? 'expense' : 'income'} parentSuffix="(general)" />
                      </Select>
                    </td>
                    <td className="py-1 whitespace-nowrap">
                      <Button aria-label={`Record ${draft.description}`} disabled={busy !== null} onClick={() => void run(draft.id, () => confirmDraft(database, ws, draft.id))}>
                        Record
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Discard ${draft.description}`}
                        disabled={busy !== null}
                        onClick={() => void run(draft.id, () => dismissDraft(database, ws, draft.id))}
                      >
                        Discard
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
