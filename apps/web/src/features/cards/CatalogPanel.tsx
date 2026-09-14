import { describeEntry, diffCatalogEntries, isStale } from '@expanses/catalog';
import { applyCatalogUpdate, dismissCatalogVersion, listCategoryChoices, resetToCatalog, setCatalogCategoryChoice } from '@expanses/db';
import { useApp } from '../../app/context';
import { CATALOG_REPORT_EMAIL, reportMailto, shouldShowReport } from '../../lib/catalog-config';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, cx, Field, Select } from '../../ui';
import { pendingUpdate } from './catalog-panel';
import type { CardPoints } from './useCardPoints';

/** Catalogue link for a card: status, provenance, pending updates, full terms, reset, and reporting a change. */
export function CatalogPanel({ cp, today, run }: { cp: CardPoints; today: string; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const { database, ws } = useApp();
  const { catalog, program } = cp;
  if (!program || !catalog.entryId) return null;
  const entry = catalog.entry;
  if (!entry) {
    return (
      <Card>
        <p className="text-sm text-slate-600">This card's catalogue entry is no longer bundled. Its rules stay as they are and you can edit them.</p>
      </Card>
    );
  }

  const update = pendingUpdate(catalog);
  const changes = update && catalog.snapshot ? diffCatalogEntries(catalog.snapshot, update) : [];
  const linked = catalog.status === 'linked';
  const email = CATALOG_REPORT_EMAIL;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className={cx('rounded px-1.5 py-0.5 text-xs font-medium', linked ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>
            From catalogue · {linked ? 'Linked' : 'Customised'}
          </span>
          <span className="ml-2 text-sm font-medium">{entry.name}</span>
        </div>
        <div className="flex gap-2">
          {!linked && (
            <Button
              variant="ghost"
              onClick={() =>
                window.confirm(`Reset ${cp.card.name} to the catalogue terms? Rules, bonuses, and partners you added or changed are removed.`) &&
                void run(() => resetToCatalog(database, ws, program.id, entry, today))
              }
            >
              Reset to catalogue
            </Button>
          )}
          {shouldShowReport(email) && (
            <a href={reportMailto(email, entry)} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Report a change
            </a>
          )}
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Verified {entry.verifiedOn} from{' '}
        {entry.sources.map((source, i) => (
          <span key={source.url}>
            {i > 0 && ', '}
            <a href={source.url} target="_blank" rel="noreferrer" className="underline">
              {source.title}
            </a>
          </span>
        ))}
        . {linked ? 'Catalogue updates apply automatically.' : 'You changed these terms, so catalogue updates wait for your review.'}
      </p>
      {isStale(entry, today) && (
        <p className="mt-2 text-sm text-amber-700">These terms were verified more than 180 days ago and may be out of date. Check the sources before relying on them.</p>
      )}

      {update && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-medium">Catalogue update for {entry.name}</div>
          {changes.length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {changes.map((change, i) => (
                <li key={i}>{change}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">Only sources or wording changed.</p>
          )}
          <div className="mt-2 flex gap-2">
            <Button onClick={() => void run(() => applyCatalogUpdate(database, ws, program.id, update, today))}>Apply update</Button>
            <Button variant="secondary" onClick={() => void run(() => dismissCatalogVersion(database, ws, program.id, update.entryVersion))}>
              Skip this version
            </Button>
          </div>
        </div>
      )}

      {entry.program.categoryChoice && <CategoryChoice cp={cp} today={today} run={run} />}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-600">Card terms, welcome bonus, and notes</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">
          {describeEntry(entry, today).lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </details>
    </Card>
  );
}

/** The category the holder is running now, and a way to move to another one from today. */
function CategoryChoice({ cp, today, run }: { cp: CardPoints; today: string; run: (fn: () => Promise<unknown>) => Promise<boolean> }) {
  const { database, ws } = useApp();
  const choice = cp.catalog.entry?.program.categoryChoice;
  const programId = cp.program?.id;
  const choices = useQuery({
    queryKey: ['category-choices', ws.workspaceId, programId],
    queryFn: () => listCategoryChoices(database, ws, programId!),
    enabled: !!programId,
  });
  if (!choice || !programId) return null;

  const running = choices.data?.find((applied) => applied.to === null);
  const runningName = choice.options.find((option) => option.key === running?.optionKey)?.name;

  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      <Field
        label={choice.name}
        hint={
          runningName
            ? `Running ${runningName}. You can change it ${choice.changeable} — purchases before today keep ${runningName}, and a cycle can hold both.`
            : `Not picked yet. You can change it ${choice.changeable}.`
        }
      >
        <Select
          id="running-category"
          value={running?.optionKey ?? ''}
          onChange={(e) => {
            const optionKey = e.target.value;
            if (!optionKey || optionKey === running?.optionKey) return;
            void run(async () => {
              await setCatalogCategoryChoice(database, ws, programId, optionKey, today, today);
            });
          }}
        >
          <option value="">Choose a category</option>
          {choice.options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
