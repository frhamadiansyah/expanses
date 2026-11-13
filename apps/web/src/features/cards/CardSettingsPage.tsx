import { groupTypedAmount, parseGroupedMajor } from '@expanses/core';
import { type CardRow, listProgrammes, renameAccount, type RewardProgramRow, saveCardIdentity, saveCardTerms, setAccountForSpending, setEarnsInto, setProgramCrediting, spendingSwitchOn } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { typedNameOf } from '../../lib/account-name';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PickerRow, ReadOnlyRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { ShareWithHouseholdRow } from '../sharing/ShareWithHousehold';
import { TrackPaymentsSetting } from '../statement-check/TrackPaymentsSetting';
import { CardFace } from './CardFace';
import { PlasticSheet } from './PlasticSheet';
import { issuerChoices, useWorkspaceIssuers } from './card-queries';
import { issuerMatches } from './issuer-match';
import { SuggestRow } from '../ownables/CashAccountForm';
import { CardScreen, type CardPage, type Run, useCardAction, useCardPage } from './card-page';
import { CatalogPanel } from './CatalogPanel';
import { CatalogPicker } from './CatalogPicker';
import { ANCHOR_LABELS, ProductChooser, UNIT_LABELS } from './CardProductPages';
import { ColumnGroup, Line, SUBTITLE, TextLine, TITLE } from './rows';
import { termsFields } from './terms-fields';
import { useCatalogChoice } from './useCatalogChoice';
import { FeeDayMonthRow } from './FeeDayMonthRow';
import { FeeWaiverRow } from './AnnualFeeGroup';
import { useInstallments } from '../loans/queries';

const settingsRoute = getRouteApi('/cards/$cardId/settings');
const productRoute = getRouteApi('/cards/$cardId/settings/product');


/**
 * The card's points settings: which programme they go into — two cards of one bank are joined by choosing the
 * bank's one programme for both, and a co-brand card earns straight into the airline's or hotel's — then, for a card
 * not on the catalogue, its earning rules and spend bonuses, and for every card how the bank credits its points and
 * when its caps reset. The balance lives on the programme's page.
 */
function PointsGroup({ page, run }: { page: CardPage; run: Run }) {
  const { database, ws } = useApp();
  const { cp, card } = page;
  const programmes = useQuery({ queryKey: ['programmes-list', ws.workspaceId], queryFn: () => listProgrammes(database, ws) });
  const navigate = useNavigate();
  const program = cp.program;
  if (!program) return null;
  const programme = cp.programme;
  const choices = programme ? [programme, ...(programmes.data ?? []).filter((other) => other.id !== programme.id)] : [];
  // A card on the catalogue follows its rules; they are shown, and edited, only once it is set up by hand or customised.
  const linked = cp.catalog.status === 'linked';
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
      {!linked && (
        <>
          <PickerRow label="Earning rules" value={String(cp.rules.length)} onOpen={() => void navigate({ to: '/cards/$cardId/settings/rules', params: { cardId: card.id } })} />
          <PickerRow label="Spend bonuses" value={String(cp.bonuses.length)} onOpen={() => void navigate({ to: '/cards/$cardId/settings/bonuses', params: { cardId: card.id } })} />
        </>
      )}
      <SelectRow label="Bank credits points" value={cp.crediting} onChange={(e) => void run(() => setProgramCrediting(database, ws, program.id, e.target.value as 'per_transaction' | 'per_statement'))}>
        <option value="per_statement">Per statement</option>
        <option value="per_transaction">Per purchase</option>
      </SelectRow>
      <ReadOnlyRow label="Caps reset" value={ANCHOR_LABELS[program.cycleAnchor]} />
    </InsetGroup>
  );
}

/** The Annual fee group: the fee, the day it is charged on, and Fee waiver. */
function AnnualFeeColumns({ page, rows }: { page: CardPage; rows: ReactNode[] }) {
  return <ColumnGroup header="Annual fee" columns={[rows]} />;
}

/**
 * A card's settings, behind the ⚙ of its page: what the Card and Rewards rules tabs held. Its name, its card product
 * from the catalogue, its terms, the cards on its account, its points, whether payments are tracked on a statement,
 * and whether it is shared with the household.
 *
 * A card still being set up does its next step here first, in order: the terms, then the card product, then its
 * earning rules. The ✓ saves the terms: a card being set up stays for its next step, a settled one goes back to the card.
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
  const plans = useInstallments(cardId);
  const [plasticSheet, setPlasticSheet] = useState<CardRow | 'new' | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [loadedTerms, setLoadedTerms] = useState<string | null>(null);
  // The bank behind a credit card, which its face and the tax report's list of debts read: set or put right here.
  const banks = issuerChoices(useWorkspaceIssuers().data ?? []);
  const [institution, setInstitution] = useState<string | null>(null);
  // The ✓ found a date missing: said above the page, the typed values kept.
  const [datesMissing, setDatesMissing] = useState(false);
  const fallback = `/cards/${cardId}` as const;
  if (!page) {
    return (
      <CardScreen title="Settings" back="Card" fallback={fallback}>
        {gate}
      </CardScreen>
    );
  }
  const { card, cp, plastic, issuer, currency, isDebit, today } = page;

  // The fields read the saved card again whenever it changes underneath them — a catalogue applied writes the
  // published annual fee onto the terms, and a form still showing the old ones would save that emptiness back. A
  // catalogue card opened without its dates has no terms for that fee yet, so the form offers it beside them.
  const saved = termsFields(cp.terms, cp.catalog.snapshot ?? cp.catalog.entry, today, currency, cp.limitMinor);
  // An issuer that closes every statement on one day has it offered, typed in, until the terms are saved.
  const fixedDay = !cp.terms ? cp.catalog.entry?.program.fixedStatementDay : undefined;
  const termsKey = `${card.id}:${JSON.stringify(saved)}:${fixedDay ?? ''}`;
  if (loadedTerms !== termsKey) {
    setLoadedTerms(termsKey);
    setStatementDay(saved.statementDay || (fixedDay ? String(fixedDay) : ''));
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

  const optionalMinor = (v: string) => (v.trim() ? parseGroupedMajor(v, currency) : null);
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
  /*
   * The name is kept as it is left. The terms are saved by the ✓ — also by Enter in a terms field. A card being set up
   * stays on the page once they are in, for its next step; a settled card goes back. Terms that cannot be saved
   * without both dates are never dropped quietly: the page says so and keeps what was typed.
   */
  const done = async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setDatesMissing(false);
    if (!isDebit && termsTyped) {
      if (!statementDay.trim() || !dueDay.trim()) return setDatesMissing(true);
      if (!(await saveTerms())) return;
    }
    window.setTimeout(goBack, 0);
  };

  const termsBlock = !isDebit && (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void saveTerms();
        }}
      >
        <input type="submit" hidden />
        <ColumnGroup
          header="Card terms"
          footer={statementDay.trim() === '' ? 'The billing date decides which purchases count toward each points cycle.' : undefined}
          columns={[
            [
              <TextRow label="Billing date"value={statementDay} onChange={(e) => setStatementDay(e.target.value)} inputMode="numeric" placeholder="Day" required />,
              <TextRow label="Due date"value={dueDay} onChange={(e) => setDueDay(e.target.value)} inputMode="numeric" placeholder="Day" required />,
            ],
            [
              <TextRow label="Credit limit" prefix={currency} value={limit} onChange={(e) => setLimit(groupTypedAmount(e.target.value, currency))} inputMode="decimal" placeholder="Amount" />,
            ],
          ]}
        />
        <AnnualFeeColumns
          page={page}
          rows={[
            <TextRow label="Annual fee" prefix={currency} value={fee} onChange={(e) => setFee(groupTypedAmount(e.target.value, currency))} inputMode="decimal" placeholder="Amount" />,
            <FeeDayMonthRow value={feeOn} today={page.today} onChange={setFeeOn} />,
            <FeeWaiverRow key="fee-waiver" page={page} />,
          ]}
        />
      </form>
    </>
  );

  const product = cp.catalog.entry?.name ?? (cp.catalog.entryId ? 'From the catalogue' : cp.program ? cp.program.name : null);

  return (
    <CardScreen
      title="Settings"
      back={card.name}
      fallback={fallback}
      actions={[{ key: 'save', label: 'Save', glyph: <Check size={20} aria-hidden />, run: () => void done() }]}
    >
      <ErrorBox error={error ?? (datesMissing ? new Error('Enter the billing date and the due date') : null)} />

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
        {product ? (
          <PickerRow label="Card product" value={product} onOpen={() => void navigate({ to: '/cards/$cardId/settings/product', params: { cardId: card.id } })} />
        ) : (
          // Not chosen yet: the answer is the next step, drawn as one.
          <InsetRow title="Card product" value="Choose" valueTone="tint" chevron onClick={() => void navigate({ to: '/cards/$cardId/settings/product', params: { cardId: card.id } })} />
        )}
        {!isDebit && (
          <SwitchRow
            label="For spending"
            checked={spendingSwitchOn(card)}
            info="Off keeps the card out of Wallet and Paid with. It stays in Assets and Debts, and its own page keeps working."
            onChange={(on) => void run(() => setAccountForSpending(database, ws, card.id, on))}
          />
        )}
      </InsetGroup>

      {termsBlock}

      <InsetGroup header="Cardholders" footer={cp.program ? undefined : 'Rewards, earning rules and spend bonuses appear here once a card product is chosen.'}>
        {[...plastic].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((piece) => (
          // The card's own face beside whose it is: a row with its art, and the way to take the card off.
          <Line key={piece.id} testId="card-on-account" pad="0">
            <button type="button" aria-label={`Edit card ending ${piece.last4 ?? 'unknown'}`} onClick={() => setPlasticSheet(piece)} className="flex w-full items-center gap-[12px] py-[8px] pl-[13px] pr-[13px] text-left" style={{ minHeight: 44 }}>
              <CardFace issuer={issuer} name={card.name} last4={piece.last4} holderName={piece.holderName} network={cp.catalog.entry?.network} look={cp.catalog.entry?.look} size="sm" />
              <span className="min-w-0 flex-1">
                <span className={cx('block truncate', TITLE)}>{piece.holderName ?? (piece.isPrimary ? 'Primary' : 'Supplementary')}</span>
                <span className={cx('tabular block truncate', SUBTITLE)}>
                  ···· {piece.last4 ?? '····'}
                  {piece.isPrimary ? ' · primary' : ''}
                </span>
              </span>
            </button>
          </Line>
        ))}
        {plastic.length === 0 && <TextLine tone="ink-3">No card recorded on this account yet.</TextLine>}
        <InsetRow title="Add a card" action testId="add-card" onClick={() => setPlasticSheet('new')} />
      </InsetGroup>
      {plasticSheet && <PlasticSheet accountId={card.id} piece={plasticSheet === 'new' ? undefined : plasticSheet} first={plastic.length === 0} run={run} onClose={() => setPlasticSheet(null)} />}

      {!isDebit && (
        <InsetGroup header="Instalments">
          <InsetRow
            testId="card-instalments-row"
            plain
            title="Instalments"
            value={(plans.data ?? []).length === 0 ? 'None' : `${plans.data!.length} ${plans.data!.length === 1 ? 'plan' : 'plans'}`}
            to="/cards/$cardId/settings/instalments"
            params={{ cardId: card.id }}
          />
        </InsetGroup>
      )}

      <PointsGroup page={page} run={run} />

      {!isDebit && <TrackPaymentsSetting cardAccountId={card.id} />}
      <ShareWithHouseholdRow accountId={card.id} name={card.name} jointSwitch={!isDebit ? 'card' : false} />
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
    const { cp, isDebit, today } = page;
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
    return <ProductChooser page={page} />;
  };
  return (
    <CardScreen title="Card product" back="Settings" fallback={fallback}>
      <ErrorBox error={error} />
      {body()}
    </CardScreen>
  );
}
