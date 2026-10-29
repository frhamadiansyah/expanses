import { type CaptureLine, isoDate } from '@expanses/core';
import { listCardTerms } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CreditCard, Landmark, Wallet } from 'lucide-react';
import { useApp } from '../../app/context';
import { native } from '../../capture/native';
import { APP_STATEMENT_PREFIX, takeOfferedStatement } from '../../capture/statements';
import { canPayWith, SUBTYPE_LABELS } from '../../lib/account-types';
import { moneyHolders, useAccounts } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN } from '../../ui/native';
import { cycleBack } from '../cards/statement-dates';
import { holdStatementBatch } from './batch';

/**
 * `/statement/shared?batch=<id>`: the batch the share sheet wrote, named by its `cicis://statement/<id>` link, or one
 * the app read itself (`capture/statements.ts`).
 */
export function sharedStatementSearch(search: Record<string, unknown>): { batch?: string; account?: string } {
  return { batch: typeof search.batch === 'string' ? search.batch : undefined, account: typeof search.account === 'string' ? search.account : undefined };
}

/*
 * The phone deletes a batch as it hands it over, so it is taken once per id and the answer kept for the app's life:
 * a remount (React's strict mode, a back and forth) reads the same lines instead of an empty folder. Memory only.
 */
const taken = new Map<string, Promise<CaptureLine[][]>>();
function takeBatch(batchId: string): Promise<CaptureLine[][]> {
  let lines = taken.get(batchId);
  if (!lines) {
    // Read in the app (Choose from Photos, one shared statement page): held in memory, not in the App Group.
    lines = batchId.startsWith(APP_STATEMENT_PREFIX)
      ? Promise.resolve(takeOfferedStatement(batchId) ?? [])
      : native.takeStatementBatch({ batchId }).then(({ images }) => images.map((image) => image.lines));
    taken.set(batchId, lines);
  }
  return lines;
}

const dayMonth = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/**
 * Several statement screenshots shared from Photos (statement-check S2): they arrive already read on the phone, and
 * the one thing the share could not say is which card they belong to. Choosing a card holds the lines for the check
 * and opens it on that card's last statement cycle, at the reading step's end.
 */
export function PickCardPage() {
  const { batch = '', account: onForm = '' } = useSearch({ strict: false }) as { batch?: string; account?: string };
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const accounts = useAccounts();
  const terms = useQuery({ queryKey: ['card-terms-all', ws.workspaceId], queryFn: () => listCardTerms(database, ws) });
  const images = useQuery({ queryKey: ['statement-batch', batch], enabled: batch !== '', staleTime: Infinity, queryFn: () => takeBatch(batch) });

  const title = <LargeTitle title="Which account?" back="Wallet" backTo="/wallet" />;
  if (!batch || (images.isSuccess && images.data.length === 0))
    return (
      <div className={SCREEN}>
        {title}
        <Empty>These screenshots are no longer here. Share them again from Photos.</Empty>
      </div>
    );
  if (images.isError)
    return (
      <div className={SCREEN}>
        {title}
        <ErrorBox error={images.error} />
      </div>
    );
  if (!accounts.isSuccess || !terms.isSuccess || !images.isSuccess) return <div className={SCREEN}>Loading…</div>;

  const today = isoDate();
  const statementDay = new Map(terms.data.map((t) => [t.accountId, t.statementDay]));
  const cards = accounts.data.filter((a) => a.archivedAt === null && a.subtype === 'credit_card');
  // Any account money is spent from, a card keeping its own check and listed once, above: a bank, a saving account or a wallet gets the list check.
  const others = moneyHolders(accounts.data).filter((a) => a.archivedAt === null && a.subtype !== 'cash' && a.subtype !== 'credit_card' && canPayWith(a));
  const shots = images.data.length;
  // Cards, then the rest; the account already on the form (the camera's way in) first of all.
  const entries = [...cards, ...others].sort((x, y) => Number(y.id === onForm) - Number(x.id === onForm));

  return (
    <div className={SCREEN}>
      {title}
      {cards.length === 0 && others.length === 0 ? (
        <Empty>No account here yet. Add one, then share the screenshots again.</Empty>
      ) : (
        <InsetGroup header={`${shots} screenshot${shots === 1 ? '' : 's'} read on this phone`}>
          {entries.map((account) => {
            const here = account.id === onForm;
            if (account.subtype === 'credit_card') {
              const cycle = cycleBack(today, statementDay.get(account.id) ?? 1, 1);
              return (
                <InsetRow
                  key={account.id}
                  testId="statement-card"
                  icon={<CreditCard size={17} aria-hidden />}
                  title={account.name}
                  subtitle={`Statement ${dayMonth(cycle.start)} – ${dayMonth(cycle.end)}`}
                  onClick={() => {
                    const held = holdStatementBatch(images.data);
                    void navigate({ to: '/cards/$cardId/check', params: { cardId: account.id }, search: { start: cycle.start, end: cycle.end, batch: held } });
                  }}
                />
              );
            }
            return (
              <InsetRow
                key={account.id}
                testId="statement-account"
                icon={account.subtype === 'ewallet' || account.subtype === 'emoney' ? <Wallet size={17} aria-hidden /> : <Landmark size={17} aria-hidden />}
                title={account.name}
                subtitle={here ? `${SUBTYPE_LABELS[account.subtype]} · on the form` : SUBTYPE_LABELS[account.subtype]}
                onClick={() => {
                  const held = holdStatementBatch(images.data);
                  void navigate({ to: '/statement/list', search: { account: account.id, batch: held } });
                }}
              />
            );
          })}
        </InsetGroup>
      )}
      <p className="mx-[4px] mt-[-8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
        Read on this phone; only the text lines were kept, and the period can be changed on the next screen.
      </p>
    </div>
  );
}
