import { CATALOG, type CatalogEntry } from '@expanses/catalog';
import { categoryIdsByKeyAll, createProgram, type RewardProgramRow } from '@expanses/db';
import { planCatalogApply } from '@expanses/catalog';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PickerRow, ReadOnlyRow, SearchPill, SelectRow, TextRow } from '../../ui/native';
import { CardScreen, type CardPage, type Run, useCardAction, useCardPage } from './card-page';
import { canApplyEntry, categoryNameForKey, memberLevelsOf, searchCatalog } from './catalog-picker';
import { ActionRow, TextLine } from './rows';
import { useCatalogChoice } from './useCatalogChoice';

const previewRoute = getRouteApi('/cards/$cardId/settings/product/listed/$entryId');
const byHandRoute = getRouteApi('/cards/$cardId/settings/product/by-hand');

export const UNIT_LABELS: Record<RewardProgramRow['unit'], string> = { points: 'Points', miles: 'Miles', cashback: 'Cashback' };
export const ANCHOR_LABELS: Record<RewardProgramRow['cycleAnchor'], string> = { statement: 'Each statement cycle', calendar: 'Each calendar month' };

/**
 * The catalogue cards a card can be chosen from — credit for a credit card, debit for a bank account — searched by
 * bank or name, with the way out for a card that is not on it: its rewards set up by hand on a page of its own.
 */
export function ProductChooser({ page }: { page: CardPage }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const forThisCard = CATALOG.filter((entry) => (entry.cardType === 'debit') === page.isDebit);
  const matches = searchCatalog(forThisCard, query);
  const cardId = page.card.id;
  return (
    <>
      <div className="mb-[14px]">
        <SearchPill value={query} onChange={setQuery} onClose={() => setQuery('')} placeholder="Search card or bank" />
      </div>
      <InsetGroup header={`${matches.length} ${matches.length === 1 ? 'card' : 'cards'}`}>
        {matches.map((entry) => (
          <InsetRow
            key={entry.id}
            icon={<span className="text-[13px] font-semibold">{entry.bank.slice(0, 1).toUpperCase()}</span>}
            title={entry.name}
            subtitle={entry.program.name}
            chevron
            onClick={() => void navigate({ to: '/cards/$cardId/settings/product/listed/$entryId', params: { cardId, entryId: entry.id } })}
          />
        ))}
        {matches.length === 0 && <TextLine tone="ink-3">No card matches. Set it up by hand instead.</TextLine>}
      </InsetGroup>
      <InsetGroup>
        <InsetRow title="My card is not listed" chevron onClick={() => void navigate({ to: '/cards/$cardId/settings/product/by-hand', params: { cardId } })} />
      </InsetGroup>
    </>
  );
}

/** What an entry's terms hold from today on, at the member level chosen: the rules and the spend bonuses it will write. */
function earnCounts(entry: CatalogEntry, today: string, memberLevel: string | null) {
  const atLevel = (levels: readonly string[] | undefined) => !levels || !memberLevel || levels.includes(memberLevel);
  const current = entry.terms.filter((period) => !period.effectiveTo || period.effectiveTo >= today);
  return {
    rules: current.reduce((sum, period) => sum + period.rules.filter((rule) => atLevel(rule.memberLevels)).length, 0),
    bonuses: current.reduce((sum, period) => sum + period.cycleBonuses.filter((bonus) => atLevel(bonus.memberLevels)).length, 0),
  };
}

function CatalogPreview({ page, run, entry }: { page: CardPage; run: Run; entry: CatalogEntry }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const router = useRouter();
  const { today, isDebit, cp, card } = page;
  const [memberLevel, setMemberLevel] = useState<string | null>(null);
  const [categoryOption, setCategoryOption] = useState<string | null>(null);
  const catalog = useCatalogChoice(page, run, {
    // Settings → the list → this page: two steps back is the Settings page that sent the card here, so ‹ there still goes to the card.
    onApplied: () => (router.history.canGoBack() ? router.history.go(-2) : void navigate({ to: '/cards/$cardId/settings', params: { cardId: card.id }, replace: true })),
  });
  const categoryKeys = useQuery({ queryKey: ['category-keys', ws.workspaceId], queryFn: () => categoryIdsByKeyAll(database, ws) });
  const unmapped = categoryKeys.data ? planCatalogApply(entry, categoryKeys.data, today, memberLevel).unmappedKeys : [];
  const levels = memberLevelsOf(entry);
  const choice = entry.program.categoryChoice;
  const counts = earnCounts(entry, today, memberLevel);
  const ready = canApplyEntry(entry, memberLevel);
  return (
    <>
      <InsetGroup header="This card">
        <ReadOnlyRow label="Rewards" value={entry.program.name} />
        <ReadOnlyRow label="Network" value={entry.network.charAt(0).toUpperCase() + entry.network.slice(1)} />
        {levels.length > 0 && (
          <SelectRow label="Level" id="member-level" value={memberLevel ?? ''} onChange={(e) => setMemberLevel(e.target.value || null)}>
            <option value="">Choose a level</option>
            {levels.map((level) => (
              <option key={level.key} value={level.key}>
                {level.name} — {level.condition}
              </option>
            ))}
          </SelectRow>
        )}
        {choice && (
          <SelectRow label={choice.name} id="category-choice" value={categoryOption ?? ''} onChange={(e) => setCategoryOption(e.target.value || null)}>
            <option value="">Choose later</option>
            {choice.options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.name}
              </option>
            ))}
          </SelectRow>
        )}
      </InsetGroup>
      {levels.length > 0 && <p className="-mt-[8px] mb-[18px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">This card earns by standing with the bank, so the rate and the transfer ratio follow the level.</p>}
      {choice && (
        <p className="-mt-[8px] mb-[18px] px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          Pick the one running now. It can be changed {choice.changeable}. Purchases keep the category that was running on the day they happened.
        </p>
      )}

      <InsetGroup
        header="What it earns"
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
            . Estimates only; the statement is the final word.
          </>
        }
      >
        <ReadOnlyRow label="Earning rules" value={String(counts.rules)} />
        <ReadOnlyRow label="Spend bonuses" value={String(counts.bonuses)} />
        {unmapped.length > 0 && (
          <TextLine tone="warn">
            {unmapped.map(categoryNameForKey).join(', ')} {unmapped.length === 1 ? 'was' : 'were'} renamed or removed in this workspace, so purchases there will still earn in estimates.
          </TextLine>
        )}
      </InsetGroup>

      <InsetGroup footer={!isDebit && !cp.terms ? 'Add the billing date in Settings to see points.' : undefined}>
        <ActionRow label="Use this card" disabled={!ready} onClick={() => catalog.applyEntry(entry, memberLevel, categoryOption)} />
      </InsetGroup>
    </>
  );
}

/** A catalogue card picked from the list: what it earns, before it is used. */
export function CardCatalogPreviewPage() {
  const { cardId, entryId } = previewRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  const { error, run } = useCardAction();
  const entry = CATALOG.find((candidate) => candidate.id === entryId);
  return (
    <CardScreen title={entry?.name ?? 'Card product'} back="Card product" fallback={`/cards/${cardId}/settings/product`}>
      <ErrorBox error={error} />
      {!page ? gate : entry ? <CatalogPreview page={page} run={run} entry={entry} /> : <InsetGroup><TextLine tone="ink-3">That card is not in the catalogue.</TextLine></InsetGroup>}
    </CardScreen>
  );
}

/** The rows that open a card's earning rules and spend bonuses, with how many each holds. */
export function RulesRows({ page }: { page: CardPage }) {
  const navigate = useNavigate();
  const { cp, card } = page;
  return (
    <InsetGroup>
      <PickerRow label="Earning rules" value={String(cp.rules.length)} onOpen={() => void navigate({ to: '/cards/$cardId/settings/rules', params: { cardId: card.id } })} />
      <PickerRow label="Spend bonuses" value={String(cp.bonuses.length)} onOpen={() => void navigate({ to: '/cards/$cardId/settings/bonuses', params: { cardId: card.id } })} />
    </InsetGroup>
  );
}

function ByHand({ page, run }: { page: CardPage; run: Run }) {
  const { database, ws } = useApp();
  const { card, cp } = page;
  const [programName, setProgramName] = useState(`${card.name} rewards`);
  const [unit, setUnit] = useState<RewardProgramRow['unit']>('points');
  const [anchor, setAnchor] = useState<RewardProgramRow['cycleAnchor']>('statement');
  const program = cp.program;
  // Once it is saved the program is shown as it is, and its rules and bonuses open from the rows under it.
  if (program) {
    return (
      <>
        <InsetGroup header="Rewards program">
          <ReadOnlyRow label="Program name" value={program.name} />
          <ReadOnlyRow label="Earns" value={UNIT_LABELS[program.unit]} />
          <ReadOnlyRow label="Caps reset" value={ANCHOR_LABELS[program.cycleAnchor]} />
        </InsetGroup>
        {cp.catalog.status === null && <RulesRows page={page} />}
      </>
    );
  }
  return (
    <>
      <InsetGroup header="Rewards program">
        <TextRow label="Program name" value={programName} onChange={(e) => setProgramName(e.target.value)} placeholder="Program" />
        <SelectRow label="Earns" value={unit} onChange={(e) => setUnit(e.target.value as RewardProgramRow['unit'])}>
          <option value="points">Points</option>
          <option value="miles">Miles</option>
          <option value="cashback">Cashback</option>
        </SelectRow>
        <SelectRow label="Caps reset" value={anchor} onChange={(e) => setAnchor(e.target.value as RewardProgramRow['cycleAnchor'])}>
          <option value="statement">Each statement cycle</option>
          <option value="calendar">Each calendar month</option>
        </SelectRow>
      </InsetGroup>
      <InsetGroup>
        <ActionRow label="Save" disabled={!programName.trim()} onClick={() => void run(() => createProgram(database, ws, { cardAccountId: card.id, name: programName.trim(), unit, cycleAnchor: anchor }))} />
      </InsetGroup>
    </>
  );
}

/** A card that is not in the catalogue: its rewards program set up by hand, then its rules and spend bonuses. */
export function CardByHandPage() {
  const { cardId } = byHandRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  const { error, run } = useCardAction();
  return (
    <CardScreen title="Set up by hand" back="Card product" fallback={`/cards/${cardId}/settings/product`}>
      <ErrorBox error={error} />
      {page ? <ByHand page={page} run={run} /> : gate}
    </CardScreen>
  );
}
