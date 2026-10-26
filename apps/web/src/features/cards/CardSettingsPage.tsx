import { parseMajor } from '@expanses/core';
import { addCard, archiveCard, createProgram, listProgrammes, renameAccount, type RewardProgramRow, saveCardIdentity, saveCardTerms, setEarnsInto, setProgramCrediting } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Check, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { typedNameOf } from '../../lib/account-name';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PickerRow, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { ShareWithHouseholdRow } from '../sharing/ShareWithHousehold';
import { TrackPaymentsSetting } from '../statement-check/TrackPaymentsSetting';
import { CardFace } from './CardFace';
import { issuerChoices, useWorkspaceIssuers } from './card-queries';
import { issuerMatches } from './issuer-match';
import { SuggestRow } from '../ownables/CashAccountForm';
import { CardScreen, type CardPage, type Run, useCardAction, useCardPage } from './card-page';
import { CatalogPanel } from './CatalogPanel';
import { CatalogPicker } from './CatalogPicker';
import { EarnRulesEditor } from './CardRulesPages';
import { balanceText } from './programme-text';
import { ColumnGroup, GlyphButton, Line, Step, SubmitRow, SUBTITLE, TextLine, TITLE } from './rows';
import { termsFields } from './terms-fields';
import { useCatalogChoice } from './useCatalogChoice';
import { formatPoints } from './useCardPoints';

const settingsRoute = getRouteApi('/cards/$cardId/settings');
const productRoute = getRouteApi('/cards/$cardId/settings/product');

const UNIT_LABELS: Record<RewardProgramRow['unit'], string> = { points: 'Points', miles: 'Miles', cashback: 'Cashback' };
const ANCHOR_LABELS: Record<RewardProgramRow['cycleAnchor'], string> = { statement: 'Each statement cycle', calendar: 'Each calendar month' };

/**
 * Step 2 of setup, and the card product page of a card with no rewards yet: the catalogue to choose the card from,
 * or a program set up by hand.
 */
function ProductSetup({ page, run, catalog }: { page: CardPage; run: Run; catalog: ReturnType<typeof useCatalogChoice> }) {
  const { database, ws } = useApp();
  const { card, today, isDebit } = page;
  // The choice is the page's, so a card picked from the catalogue at step 1 is still picked here.
  const { catalogId, chooseEntry, applyEntry } = catalog;
  const [programName, setProgramName] = useState(`${card.name} rewards`);
  const [unit, setUnit] = useState<RewardProgramRow['unit']>('points');
  const [anchor, setAnchor] = useState<RewardProgramRow['cycleAnchor']>('statement');
  return (
    <>
      <CatalogPicker header="Choose from catalogue" today={today} selectedId={catalogId} onSelect={chooseEntry} onApply={applyEntry} debit={isDebit} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => createProgram(database, ws, { cardAccountId: card.id, name: programName, unit, cycleAnchor: anchor }));
        }}
      >
        <ColumnGroup
          header="Or set up manually"
          columns={[
            [
              <TextRow label="Program name" value={programName} onChange={(e) => setProgramName(e.target.value)} required />,
              <SelectRow label="Earns" value={unit} onChange={(e) => setUnit(e.target.value as RewardProgramRow['unit'])}>
                <option value="points">Points</option>
                <option value="miles">Miles</option>
                <option value="cashback">Cashback</option>
              </SelectRow>,
            ],
            [
              <SelectRow label="Caps reset" value={anchor} onChange={(e) => setAnchor(e.target.value as RewardProgramRow['cycleAnchor'])}>
                <option value="statement">Each statement cycle</option>
                <option value="calendar">Each calendar month</option>
              </SelectRow>,
            ],
          ]}
          submit={<SubmitRow label="Set up rewards" />}
        />
      </form>
    </>
  );
}

/**
 * The card's points settings: which programme they go into — two cards of one bank are joined by choosing the
 * bank's one programme for both, and a co-brand card earns straight into the airline's or hotel's — with that
 * programme's balance opening its page, then the card's earning rules and spend bonuses, how the bank credits its
 * points, and when its caps reset.
 */
function PointsGroup({ page, run }: { page: CardPage; run: Run }) {
  const { database, ws } = useApp();
  const { cp, card, ledger } = page;
  const programmes = useQuery({ queryKey: ['programmes-list', ws.workspaceId], queryFn: () => listProgrammes(database, ws) });
  const navigate = useNavigate();
  const program = cp.program;
  if (!program) return null;
  const programme = cp.programme;
  const choices = programme ? [programme, ...(programmes.data ?? []).filter((other) => other.id !== programme.id)] : [];
  const balance = ledger.data?.balance;
  const openProgramme = () => {
    if (programme) void navigate({ to: '/cards/points/$programmeId', params: { programmeId: programme.id } });
  };
  return (
    <InsetGroup header="Points">
      {programme && (
        <SelectRow
          label="Earns into"
          value={programme.id}
          onChange={(event) => {
            const target = choices.find((choice) => choice.id === event.target.value);
            if (!target || target.id === programme.id) return;
            if (!window.confirm(`${card.name} will earn into ${target.name}, and the points it has earned move there too.`)) return;
            void run(() => setEarnsInto(database, ws, program.id, target.id));
          }}
        >
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </SelectRow>
      )}
      {programme && <PickerRow label="Programme" value={programme.name} onOpen={openProgramme} />}
      {programme && balance && (
        <PickerRow
          label="Balance"
          testId="points-balance"
          value={balanceText(balance.total, programme.unit)}
          detail={
            <span data-testid="points-provenance">
              {formatPoints(balance.postedTotal)} posted · {formatPoints(balance.projectedTotal)} estimated
            </span>
          }
          info="Posted points come from figures typed in. Estimated points are worked out from this card's rules, and become posted once what the bank actually gave is recorded."
          onOpen={openProgramme}
        />
      )}
      <PickerRow label="Earning rules" value={String(cp.rules.length)} onOpen={() => void navigate({ to: '/cards/$cardId/settings/rules', params: { cardId: card.id } })} />
      <PickerRow label="Spend bonuses" value={String(cp.bonuses.length)} onOpen={() => void navigate({ to: '/cards/$cardId/settings/bonuses', params: { cardId: card.id } })} />
      <SelectRow label="Bank credits points" value={cp.crediting} onChange={(e) => void run(() => setProgramCrediting(database, ws, program.id, e.target.value as 'per_transaction' | 'per_statement'))}>
        <option value="per_statement">Per statement</option>
        <option value="per_transaction">Per purchase</option>
      </SelectRow>
      <ReadOnlyRow label="Caps reset" value={ANCHOR_LABELS[program.cycleAnchor]} />
    </InsetGroup>
  );
}

/**
 * A card's settings, behind the ⚙ of its page: what the Card and Rewards rules tabs held. Its name, its card product
 * from the catalogue, its terms, the cards on its account, its points, whether payments are tracked on a statement,
 * and whether it is shared with the household.
 *
 * A card still being set up does its next step here first, in order: the terms, then the card product, then its
 * earning rules. The ✓ keeps what was typed and goes back to the card.
 */
export function CardSettingsPage() {
  const { cardId } = settingsRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const { error, run } = useCardAction();
  const goBack = useBack(`/cards/${cardId}`);
  const [name, setName] = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [limit, setLimit] = useState('');
  const [fee, setFee] = useState('');
  const [feeOn, setFeeOn] = useState('');
  const [newLast4, setNewLast4] = useState('');
  const [newHolder, setNewHolder] = useState('');
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [loadedTerms, setLoadedTerms] = useState<string | null>(null);
  // Whether this visit began with setup unfinished: its last step's rules stay open once it is done, to add more.
  const [settingUp, setSettingUp] = useState(false);
  // The bank behind a credit card, which its face and the tax report's list of debts read: set or put right here.
  const banks = issuerChoices(useWorkspaceIssuers().data ?? []);
  const [institution, setInstitution] = useState<string | null>(null);
  const catalog = useCatalogChoice(page, run, { onFixedStatementDay: (day) => setStatementDay((typed) => typed || String(day)) });
  const fallback = `/cards/${cardId}` as const;
  if (!page) {
    return (
      <CardScreen title="Settings" back="Card" fallback={fallback}>
        {gate}
      </CardScreen>
    );
  }
  const { card, cp, plastic, issuer, currency, isDebit, step, today } = page;
  if (step !== null && !settingUp) setSettingUp(true);

  // The fields read the saved card again whenever it changes underneath them — a catalogue applied writes the
  // published annual fee onto the terms, and a form still showing the old ones would save that emptiness back. A
  // catalogue card opened without its dates has no terms for that fee yet, so the form offers it beside them.
  const saved = termsFields(cp.terms, cp.catalog.snapshot ?? cp.catalog.entry, today, currency);
  const termsKey = `${card.id}:${JSON.stringify(saved)}`;
  if (loadedTerms !== termsKey) {
    setLoadedTerms(termsKey);
    setStatementDay(saved.statementDay);
    setDueDay(saved.dueDay);
    setLimit(saved.limit);
    setFee(saved.fee);
    setFeeOn(saved.feeOn);
  }
  // The name as typed: its issuer, shown in front of it everywhere else, is the Institution row's.
  if (loadedName !== `${card.id}:${typedNameOf(card)}`) {
    setLoadedName(`${card.id}:${typedNameOf(card)}`);
    setName(typedNameOf(card));
  }

  const optionalMinor = (v: string) => (v.trim() ? parseMajor(v, currency) : null);
  const termsTyped = statementDay !== saved.statementDay || dueDay !== saved.dueDay || limit !== saved.limit || fee !== saved.fee || feeOn !== saved.feeOn;
  const saveTerms = () =>
    run(() => saveCardTerms(database, ws, { accountId: card.id, statementDay: Number(statementDay), dueDay: Number(dueDay), creditLimitMinor: optionalMinor(limit), annualFeeMinor: optionalMinor(fee), annualFeeOn: feeOn || null }));
  const saveName = () => {
    if (!name.trim() || name.trim() === typedNameOf(card)) return;
    void run(() => renameAccount(database, ws, card.id, name));
  };
  const leave = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur();
  /*
   * Typed, with the banks already known offered over the keyboard, and kept as it is left — the way a holding's
   * Institution row is. Emptied, the card is filed under no bank. The face is drawn from it, so it follows at once.
   */
  const saveInstitution = (typed: string) => {
    const next = typed.trim() || null;
    if (next === issuer) return setInstitution(null);
    void run(() => saveCardIdentity(database, ws, { accountId: card.id, issuer: next })).then((saved) => saved && setInstitution(null));
  };
  // The name is kept as it is left; terms typed and not saved yet are saved by the ✓ on the way back.
  const done = async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (!isDebit && termsTyped && statementDay.trim() && dueDay.trim() && !(await saveTerms())) return;
    window.setTimeout(goBack, 0);
  };

  /*
   * A card opened from the catalogue without its dates has its product and its rules already: the dates are all its
   * setup still asks for, so they come first with no step number over them and no catalogue to choose from again.
   */
  const onlyDates = step === 1 && cp.program !== undefined;
  const termsBlock = !isDebit && (
    <>
      {step === 1 && !onlyDates && <Step>Step 1 of 3</Step>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveTerms();
        }}
      >
        <ColumnGroup
          header="Card terms"
          footer={step === 1 ? 'Start with the billing date. It decides which purchases count toward each points cycle and when bonus caps reset.' : undefined}
          columns={[
            [
              <TextRow label="Billing date"value={statementDay} onChange={(e) => setStatementDay(e.target.value)} inputMode="numeric" placeholder="Day" required />,
              <TextRow label="Due date"value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" placeholder="Day" required />,
            ],
            [
              <TextRow label={`Credit limit (${currency})`} value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" />,
              <TextRow label={`Annual fee (${currency})`} value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" />,
              <TextRow label="Charged on" type="date" value={feeOn} onChange={(e) => setFeeOn(e.target.value)} />,
            ],
          ]}
          submit={<SubmitRow label="Save terms" />}
        />
      </form>
    </>
  );

  const product = cp.catalog.entry?.name ?? (cp.catalog.entryId ? 'From the catalogue' : cp.program ? cp.program.name : 'Not set up');

  return (
    <CardScreen
      title="Settings"
      back={card.name}
      fallback={fallback}
      actions={[{ key: 'save', label: 'Save', glyph: <Check size={20} aria-hidden />, run: () => void done() }]}
    >
      <ErrorBox error={error} />

      {/* The step a card being set up is at comes first: the rest is there to change later. */}
      {step === 1 && (
        <>
          {termsBlock}
          {!onlyDates && (
          <CatalogPicker
            header="Is this card in the catalogue?"
            today={today}
            selectedId={catalog.catalogId}
            onSelect={catalog.chooseEntry}
            debit={isDebit}
            applyHint="Save the card terms above, then use these terms in the next step."
          />
          )}
        </>
      )}
      {step === 2 && (
        <>
          <Step>Step 2 of 3 · Rewards program</Step>
          <ProductSetup page={page} run={run} catalog={catalog} />
        </>
      )}
      {step === 3 && <Step>Step 3 of 3</Step>}
      {(step === 3 || (step === null && settingUp)) && <EarnRulesEditor page={page} run={run} />}

      <InsetGroup>
        <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={leave} placeholder="Name" />
        {!isDebit && (
          <SuggestRow
            label="Institution"
            stripLabel="Institutions"
            value={institution ?? issuer ?? ''}
            onChange={setInstitution}
            onCommit={saveInstitution}
            placeholder="Not set"
            offers={(typed) => issuerMatches(typed, banks)}
          />
        )}
        <PickerRow label="Card product" value={product} onOpen={() => void navigate({ to: '/cards/$cardId/settings/product', params: { cardId: card.id } })} />
      </InsetGroup>

      {step !== 1 && termsBlock}

      <InsetGroup
        header="Cards on this account"
        footer="One statement, one limit — and sometimes more than one card. A supplementary card spends against this same account, so recording its last four digits is what tells whose spending is whose."
      >
        {[...plastic].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((piece) => (
          // The card's own face beside whose it is: a row with its art, and the way to take the card off.
          <Line key={piece.id} testId="card-on-account" pad="8px 4px 8px 13px" className="flex items-center gap-[12px]">
            <CardFace issuer={issuer} name={card.name} last4={piece.last4} holderName={piece.holderName} network={cp.catalog.entry?.network} look={cp.catalog.entry?.look} size="sm" />
            <span className="min-w-0 flex-1">
              <span className={cx('block truncate', TITLE)}>{piece.holderName ?? (piece.isPrimary ? 'Primary' : 'Supplementary')}</span>
              <span className={cx('tabular block truncate', SUBTITLE)}>
                ···· {piece.last4 ?? '····'}
                {piece.isPrimary ? ' · primary' : ''}
              </span>
            </span>
            <GlyphButton label={`Remove card ending ${piece.last4 ?? 'unknown'}`} glyph={<Trash2 size={17} aria-hidden />} destructive onClick={() => void run(() => archiveCard(database, ws, piece.id))} />
          </Line>
        ))}
        {plastic.length === 0 && <TextLine tone="ink-3">No card recorded on this account yet.</TextLine>}
      </InsetGroup>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await addCard(database, ws, { accountId: card.id, last4: newLast4, holderName: newHolder, isPrimary: plastic.length === 0 });
            setNewLast4('');
            setNewHolder('');
          });
        }}
      >
        <ColumnGroup
          header="Add a card"
          columns={[
            [<TextRow label="Last 4 digits" value={newLast4} onChange={(e) => setNewLast4(e.target.value)} inputMode="numeric" maxLength={4} placeholder="Last digits" />],
            [<TextRow label="Whose card" hint="Optional. The account holder, or whoever holds the supplementary card." value={newHolder} onChange={(e) => setNewHolder(e.target.value)} placeholder="Spouse" />],
          ]}
          submit={<SubmitRow label="Add card" />}
        />
      </form>

      <PointsGroup page={page} run={run} />

      {!isDebit && <TrackPaymentsSetting cardAccountId={card.id} />}
      <ShareWithHouseholdRow accountId={card.id} />
    </CardScreen>
  );
}

/**
 * The card product, under Settings: the catalogue entry the card follows — linked or customised, a change to report,
 * an update to apply or skip, the category it earns more on, the way back to the catalogue's terms — or, for a card
 * set up by hand, its program and the catalogue to choose it from instead. A card with no rewards yet sets them up here.
 */
export function CardProductPage() {
  const { cardId } = productRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  const { error, run } = useCardAction();
  const catalog = useCatalogChoice(page, run);
  const fallback = `/cards/${cardId}/settings` as const;
  const body = () => {
    if (!page) return gate;
    const { cp, card, isDebit, today } = page;
    const program = cp.program;
    if (program && cp.catalog.entryId) return <CatalogPanel cp={cp} today={today} run={run} />;
    if (program) {
      return (
        <>
          <InsetGroup header="Set up by hand">
            <ReadOnlyRow label="Program name" value={program.name} />
            <ReadOnlyRow label="Earns" value={UNIT_LABELS[program.unit]} />
            <ReadOnlyRow label="Caps reset" value={ANCHOR_LABELS[program.cycleAnchor]} />
          </InsetGroup>
          {catalog.canUseCatalog && <CatalogPicker header="Choose from catalogue" today={today} selectedId={catalog.catalogId} onSelect={catalog.chooseEntry} onApply={catalog.applyEntry} debit={isDebit} />}
        </>
      );
    }
    // The program's caps follow the statement, so a credit card is given its billing date first.
    if (!isDebit && !cp.terms) {
      return (
        <InsetGroup footer="Rewards are set up once the billing date is in.">
          <InsetRow title="Add the billing date" to="/cards/$cardId/settings" params={{ cardId: card.id }} />
        </InsetGroup>
      );
    }
    return <ProductSetup page={page} run={run} catalog={catalog} />;
  };
  return (
    <CardScreen title="Card product" back="Settings" fallback={fallback}>
      <ErrorBox error={error} />
      {body()}
    </CardScreen>
  );
}
