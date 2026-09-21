import { describeEntry, diffCatalogEntries, isStale } from '@expanses/catalog';
import { applyCatalogUpdate, dismissCatalogVersion, listCategoryChoices, resetToCatalog, setCatalogCategoryChoice } from '@expanses/db';
import { useApp } from '../../app/context';
import { CATALOG_REPORT_EMAIL, reportMailto, shouldShowReport } from '../../lib/catalog-config';
import { useQuery } from '@tanstack/react-query';
import { DestructiveRow, InsetGroup, InsetRow, Panel, SelectRow } from '../../ui/native';
import { ActionRow, HrefRow, SUBTITLE, TextLine } from './rows';
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
      <InsetGroup header="Catalogue">
        <TextLine>This card's catalogue entry is no longer bundled. Its rules stay as they are and you can edit them.</TextLine>
      </InsetGroup>
    );
  }

  const update = pendingUpdate(catalog);
  const changes = update && catalog.snapshot ? diffCatalogEntries(catalog.snapshot, update) : [];
  const linked = catalog.status === 'linked';
  const email = CATALOG_REPORT_EMAIL;

  return (
    <>
      <InsetGroup
        header="Catalogue"
        footer={
          <>
            Verified {entry.verifiedOn} from{' '}
            {entry.sources.map((source, i) => (
              <span key={source.url}>
                {i > 0 && ', '}
                <a href={source.url} target="_blank" rel="noreferrer" className="text-[var(--ph-tint)] underline">
                  {source.title}
                </a>
              </span>
            ))}
            . {linked ? 'Catalogue updates apply automatically.' : 'You changed these terms, so catalogue updates wait for your review.'}
          </>
        }
      >
        <InsetRow
          title={entry.name}
          subtitle={<span className={linked ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-warn)]'}>From catalogue · {linked ? 'Linked' : 'Customised'}</span>}
        />
        {isStale(entry, today) && (
          <TextLine tone="warn">These terms were verified more than 180 days ago and may be out of date. Check the sources before relying on them.</TextLine>
        )}
        {shouldShowReport(email) && <HrefRow href={reportMailto(email, entry)} label="Report a change" />}
      </InsetGroup>

      {update && (
        <InsetGroup header={`Catalogue update for ${entry.name}`}>
          {changes.length > 0 ? changes.map((change, i) => <TextLine key={i}>{change}</TextLine>) : <TextLine>Only sources or wording changed.</TextLine>}
          <ActionRow label="Apply update" onClick={() => void run(() => applyCatalogUpdate(database, ws, program.id, update, today))} />
          <ActionRow label="Skip this version" quiet onClick={() => void run(() => dismissCatalogVersion(database, ws, program.id, update.entryVersion))} />
        </InsetGroup>
      )}

      {entry.program.categoryChoice && <CategoryChoice cp={cp} today={today} run={run} />}

      {/* The whole of the entry, folded: a disclosure row, as iOS draws "more about this". */}
      <Panel pad={false}>
        <details className="group">
          <summary className="ph-focus-inset flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-[13px] py-[11px] text-[15px] leading-[20px] text-[var(--ph-ink)] [&::-webkit-details-marker]:hidden">
            Card terms, welcome bonus, and notes
            <span aria-hidden className="text-[17px] leading-none text-[var(--ph-chevron)] transition-transform group-open:rotate-90">
              {'›'}
            </span>
          </summary>
          <ul className={`space-y-[6px] border-t-[0.5px] border-[var(--ph-hair)] px-[13px] py-[11px] ${SUBTITLE} !text-[14px] !leading-[19px] !text-[var(--ph-ink-2)]`}>
            {describeEntry(entry, today).lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      </Panel>

      {/* Reset takes back every change the owner made, so it is a destructive row in a group of its own. */}
      {!linked && (
        <InsetGroup>
          <DestructiveRow
            label="Reset to catalogue"
            onClick={() =>
              window.confirm(`Reset ${cp.card.name} to the catalogue terms? Rules, bonuses, and partners you added or changed are removed.`) &&
              void run(() => resetToCatalog(database, ws, program.id, entry, today))
            }
          />
        </InsetGroup>
      )}
    </>
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
    <InsetGroup
      footer={
        runningName
          ? `Running ${runningName}. You can change it ${choice.changeable} — purchases before today keep ${runningName}, and a cycle can hold both.`
          : `Not picked yet. You can change it ${choice.changeable}.`
      }
    >
      <SelectRow
        label={choice.name}
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
      </SelectRow>
    </InsetGroup>
  );
}
