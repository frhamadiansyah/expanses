import { type CaptureLine, isoDate } from '@expanses/core';
import { listCardTerms } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { CreditCard } from 'lucide-react';
import { useApp } from '../../app/context';
import { native } from '../../capture/native';
import { useAccounts } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN } from '../../ui/native';
import { cycleBack } from '../cards/statement-dates';
import { holdStatementBatch } from './batch';

/** `/statement/shared?batch=<id>`: the batch the share sheet wrote, named by its `cicis://statement/<id>` link. */
export function sharedStatementSearch(search: Record<string, unknown>): { batch?: string } {
  return { batch: typeof search.batch === 'string' ? search.batch : undefined };
}

/*
 * The phone deletes a batch as it hands it over, so it is taken once per id and the answer kept for the app's life:
 * a remount (React's strict mode, a back and forth) reads the same lines instead of an empty folder. Memory only.
 */
const taken = new Map<string, Promise<CaptureLine[][]>>();
function takeBatch(batchId: string): Promise<CaptureLine[][]> {
  let lines = taken.get(batchId);
  if (!lines) {
    lines = native.takeStatementBatch({ batchId }).then(({ images }) => images.map((image) => image.lines));
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
  const { batch = '' } = useSearch({ strict: false }) as { batch?: string };
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const accounts = useAccounts();
  const terms = useQuery({ queryKey: ['card-terms-all', ws.workspaceId], queryFn: () => listCardTerms(database, ws) });
  const images = useQuery({ queryKey: ['statement-batch', batch], enabled: batch !== '', staleTime: Infinity, queryFn: () => takeBatch(batch) });

  const title = <LargeTitle title="Which card is this statement?" back="Cards" backTo="/cards" />;
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
  const shots = images.data.length;

  return (
    <div className={SCREEN}>
      {title}
      {cards.length === 0 ? (
        <Empty>No credit card here yet. Add one on Cards, then share the screenshots again.</Empty>
      ) : (
        <InsetGroup header={`${shots} screenshot${shots === 1 ? '' : 's'} read on this phone`}>
          {cards.map((card) => {
            const cycle = cycleBack(today, statementDay.get(card.id) ?? 1, 1);
            return (
              <InsetRow
                key={card.id}
                testId="statement-card"
                icon={<CreditCard size={17} aria-hidden />}
                title={card.name}
                subtitle={`Statement ${dayMonth(cycle.start)} – ${dayMonth(cycle.end)}`}
                onClick={() => {
                  const held = holdStatementBatch(images.data);
                  void navigate({ to: '/cards/$cardId/check', params: { cardId: card.id }, search: { start: cycle.start, end: cycle.end, batch: held } });
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
