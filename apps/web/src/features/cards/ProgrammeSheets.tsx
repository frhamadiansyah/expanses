import { currencyInfo, type ExpiryPolicy, formatValuePerPoint, groupTypedAmount, groupTypedValue, isoDate, parseGroupedMajor, parseValuePerPoint, type TransferPartner, valuePerPointText } from '@expanses/core';
import {
  archiveProgramme,
  createProgramme,
  type ProgrammeRow,
  type ProgrammeUnit,
  recordConversion,
  recordPointSnapshot,
  recordRedemption,
  setProgrammeTier,
  setProgrammeValuePerPoint,
  updateProgramme,
} from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { formatPoints } from './format-points';
import { programmeFamily, programmeTier } from './programme-art/programmes';
import { conversionEstimate, parsePoints, partnerFor } from './programme-text';
import { ActionRow } from './rows';
import { TransferEstimates } from './TransferEstimates';

/*
 * The sheets a points programme is worked with: adding one, its settings, and the round buttons on its page —
 * Convert (which also spends points on a use) and Adjust. Each saves with the ✓ in its header and closes; what went wrong stays on the sheet.
 */

const unitWord = (unit: ProgrammeUnit) => (unit === 'miles' ? 'Miles' : unit === 'cashback' ? 'Cashback' : 'Points');

/** Runs a save, refreshes every screen, and closes the sheet — or keeps it open with the reason it was refused. */
function useSave(onDone: () => void) {
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return { error, busy, save };
}

/** Name, unit and how the points die: what a programme is, whether it is being added or changed. */
function ProgrammeFields({
  name,
  setName,
  unit,
  setUnit,
  policy,
  setPolicy,
  months,
  setMonths,
}: {
  name: string;
  setName: (v: string) => void;
  unit: ProgrammeUnit;
  setUnit: (v: ProgrammeUnit) => void;
  policy: ExpiryPolicy;
  setPolicy: (v: ExpiryPolicy) => void;
  months: string;
  setMonths: (v: string) => void;
}) {
  return (
    <>
      <InsetGroup>
        <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Programme" required />
        <SelectRow label="Counted in" value={unit} onChange={(e) => setUnit(e.target.value as ProgrammeUnit)}>
          <option value="points">Points</option>
          <option value="miles">Miles</option>
          <option value="cashback">Cashback</option>
        </SelectRow>
      </InsetGroup>
      <ExpiryFields policy={policy} setPolicy={setPolicy} months={months} setMonths={setMonths} />
    </>
  );
}

/** How the points die: the one policy every card earning into a programme, and every conversion into it, follows. */
export function ExpiryFields({ policy, setPolicy, months, setMonths }: { policy: ExpiryPolicy; setPolicy: (v: ExpiryPolicy) => void; months: string; setMonths: (v: string) => void }) {
  return (
    <InsetGroup>
      <SelectRow label="Points expire" value={policy} onChange={(e) => setPolicy(e.target.value as ExpiryPolicy)}>
        <option value="none">Never</option>
        <option value="months_from_earn">After a number of months</option>
        <option value="fixed_annual">At the end of the year earned</option>
      </SelectRow>
      {policy === 'months_from_earn' && <TextRow label="Months they last" value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" placeholder="Months" />}
    </InsetGroup>
  );
}

export const monthsOf = (policy: ExpiryPolicy, months: string) => (policy === 'months_from_earn' ? Number(months.trim()) : null);

/** A programme no card earns into yet: an airline's or a hotel's, filled by conversions or by its balance. */
export function AddProgrammeSheet({ onClose }: { onClose: () => void }) {
  const { database, ws } = useApp();
  const { error, busy, save } = useSave(onClose);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<ProgrammeUnit>('miles');
  const [policy, setPolicy] = useState<ExpiryPolicy>('none');
  const [months, setMonths] = useState('36');
  return (
    <Sheet
      grouped
      title="Add programme"
      onClose={onClose}
      confirm={{
        label: 'Add programme',
        disabled: busy || !name.trim(),
        run: () => void save(() => createProgramme(database, ws, { name, unit, expiryPolicy: policy, expiryMonths: monthsOf(policy, months) })),
      }}
    >
      <ErrorBox error={error} />
      <ProgrammeFields name={name} setName={setName} unit={unit} setUnit={setUnit} policy={policy} setPolicy={setPolicy} months={months} setMonths={setMonths} />
    </Sheet>
  );
}

/**
 * A programme's settings: its name and unit, its card tier, and putting it away.
 *
 * Card tier is offered only for a programme whose name finds a drawn membership card with more than one tier, and its
 * list follows the name as it is typed. The first tier is the default and is kept as nothing chosen; a programme whose
 * name no longer finds a family keeps whatever tier it had, unused.
 */
export function ProgrammeSettingsSheet({
  programme,
  tier,
  earners,
  valuePerPoint,
  onClose,
  onArchived,
}: {
  programme: ProgrammeRow;
  tier: string | null;
  /** The cards earning here, each with the last digits it shows (if recorded). */
  earners: { programId: string; cardAccountId: string; cardName: string; digits: string | null }[];
  /** The programme's value per point, scaled (minor units × 10 000), or null when none is set. */
  valuePerPoint: number | null;
  onClose: () => void;
  onArchived: () => void;
}) {
  const { database, ws } = useApp();
  const { error, busy, save } = useSave(onClose);
  const archive = useSave(onArchived);
  const earning = earners.length;
  const [name, setName] = useState(programme.name);
  const [unit, setUnit] = useState<ProgrammeUnit>(programme.unit);
  const [tierId, setTierId] = useState(tier);
  const [valuing, setValuing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const family = programmeFamily(name);
  const tiers = family && family.tiers.length > 1 ? family.tiers : null;
  const chosen = family && tiers ? programmeTier(family, tierId) : null;
  return (
    <Sheet
      grouped
      title="Programme"
      onClose={onClose}
      confirm={{
        label: 'Save programme',
        disabled: busy || !name.trim(),
        run: () =>
          void save(async () => {
            await updateProgramme(database, ws, programme.id, { name, unit });
            if (family && chosen) {
              const word = chosen.id === family.tiers[0]!.id ? null : chosen.id;
              if (word !== tier) await setProgrammeTier(database, ws, programme.id, word);
            }
          }),
      }}
    >
      <ErrorBox error={error ?? archive.error} />
      <InsetGroup>
        <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Programme" required />
        <SelectRow label="Counted in" value={unit} onChange={(e) => setUnit(e.target.value as ProgrammeUnit)}>
          <option value="points">Points</option>
          <option value="miles">Miles</option>
          <option value="cashback">Cashback</option>
        </SelectRow>
        {tiers && chosen && (
          <SelectRow label="Membership tier" value={chosen.id} onChange={(e) => setTierId(e.target.value)}>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </SelectRow>
        )}
      </InsetGroup>
      {earners.length > 0 && (
        <InsetGroup header="Cards earning here">
          {earners.map((earner) => (
            <InsetRow key={earner.programId} plain title={earner.cardName} subtitle={earner.digits ? `···· ${earner.digits}` : undefined} to="/cards/points/$programmeId/card/$programId" params={{ programmeId: programme.id, programId: earner.programId }} chevron />
          ))}
        </InsetGroup>
      )}
      <InsetGroup>
        <InsetRow plain title="Value per point" value={valuePerPoint !== null ? formatValuePerPoint(valuePerPoint, ws.baseCurrency) : 'Not set'} onClick={() => setValuing(true)} chevron />
      </InsetGroup>
      <InsetGroup footer={blocked ? 'A card still earns into this programme. Choose another programme for that card before archiving this one.' : earning > 0 ? undefined : 'Archiving keeps its history and takes it off the Cards page.'}>
        <DestructiveRow
          label="Archive programme"
          muted={earning > 0}
          onClick={() => {
            if (earning > 0) return setBlocked(true);
            if (!window.confirm(`Archive ${programme.name}?`)) return;
            void archive.save(() => archiveProgramme(database, ws, programme.id));
          }}
        />
      </InsetGroup>
      {valuing && <ValuePerPointSheet programme={programme} value={valuePerPoint} onClose={() => setValuing(false)} />}
    </Sheet>
  );
}

/** One point's worth in the base currency: "1 mile = Rp [110]". Empty clears it, and no ≈ figure is shown then. */
function ValuePerPointSheet({ programme, value, onClose }: { programme: ProgrammeRow; value: number | null; onClose: () => void }) {
  const { database, ws } = useApp();
  const { error, busy, save } = useSave(onClose);
  const [text, setText] = useState(value === null ? '' : valuePerPointText(value, ws.baseCurrency));
  const singular = programme.unit === 'miles' ? 'mile' : programme.unit === 'cashback' ? 'cashback' : 'point';
  return (
    <Sheet
      grouped
      title="Value per point"
      onClose={onClose}
      confirm={{
        label: 'Save value',
        disabled: busy,
        run: () => void save(() => setProgrammeValuePerPoint(database, ws, programme.id, text.trim() === '' ? null : parseValuePerPoint(text, ws.baseCurrency))),
      }}
    >
      <ErrorBox error={error} />
      <InsetGroup>
        <TextRow label={`1 ${singular} = ${currencyInfo(ws.baseCurrency).symbol}`} value={text} onChange={(e) => setText(groupTypedValue(e.target.value, ws.baseCurrency))} inputMode="decimal" placeholder="Amount" />
      </InsetGroup>
    </Sheet>
  );
}

/** What points are spent on, offered under "Or use on" in the Convert sheet. */
const USES = ['Voucher', 'Cash', 'Flight'] as const;

type ConvertStep = { kind: 'menu' } | { kind: 'programme'; to: string } | { kind: 'use'; name: string | null };

/**
 * Everything done with a balance that takes points out of it, in one place. The first step lists where the points can
 * go: another programme (the ones set up, the partners of the cards earning here, or one not made yet), or a use —
 * Voucher, Cash, Flight, something else. A programme works as it always has: points leaving, what arrived, the date.
 * A use is a redemption: how many points, what it fetched (optional) and the date, taken from the points that expire
 * soonest, written as the history row "Flight".
 *
 * What arrived starts at the partner's ratio when a card earning here lists that partner, and is the figure the other
 * programme's app shows — so it can always be changed to what actually landed.
 */
export function ConvertSheet({
  programme,
  others,
  partners,
  statementPoints,
  today,
  onClose,
}: {
  programme: ProgrammeRow;
  others: ProgrammeRow[];
  partners: TransferPartner[];
  /** What this statement's points come to across the cards earning here, for the estimates under the choices. */
  statementPoints: number;
  today: string;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const { error, busy, save } = useSave(onClose);
  const [step, setStep] = useState<ConvertStep>({ kind: 'menu' });
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState<ProgrammeUnit>('miles');
  const [points, setPoints] = useState('');
  const [received, setReceived] = useState<string | null>(null);
  const [fetched, setFetched] = useState('');
  const [what, setWhat] = useState('');
  const [on, setOn] = useState(today);
  const back = { label: 'Back', run: () => setStep({ kind: 'menu' }) };

  // Partners not yet a programme here are offered too; one already a programme is that programme.
  const known = new Set(others.map((other) => other.name.trim().toLowerCase()));
  const fresh = partners.filter((partner) => !known.has(partner.program.trim().toLowerCase()));

  if (step.kind === 'menu') {
    const choose = (to: string) => {
      setReceived(null);
      setStep({ kind: 'programme', to });
    };
    return (
      <Sheet grouped title="Convert" onClose={onClose}>
        <InsetGroup header="To another programme">
          {others.map((other) => (
            <InsetRow key={other.id} plain title={other.name} onClick={() => choose(other.id)} chevron />
          ))}
          {fresh.map((partner) => (
            <InsetRow key={partner.id} plain title={partner.program} onClick={() => choose(`partner:${partner.program}`)} chevron />
          ))}
          <InsetRow plain title="Another programme…" onClick={() => choose('new')} chevron />
        </InsetGroup>
        <InsetGroup header="Or use on">
          {USES.map((use) => (
            <InsetRow key={use} plain title={use} onClick={() => setStep({ kind: 'use', name: use })} chevron />
          ))}
          <InsetRow plain title="Something else…" onClick={() => setStep({ kind: 'use', name: null })} chevron />
        </InsetGroup>
      </Sheet>
    );
  }

  if (step.kind === 'use') {
    const typed = step.name === null;
    const note = typed ? what.trim() || null : step.name;
    return (
      <Sheet
        grouped
        title={typed ? 'Use on' : `Use on ${step.name}`}
        onClose={onClose}
        back={back}
        confirm={{
          label: 'Save redemption',
          disabled: busy || !points.trim(),
          run: () =>
            void save(() =>
              recordRedemption(database, ws, {
                programId: programme.id,
                kind: 'redeem',
                points: parsePoints(points),
                occurredOn: on,
                note,
                valueMinor: fetched.trim() === '' ? null : parseGroupedMajor(fetched, ws.baseCurrency),
              }),
            ),
        }}
      >
        <ErrorBox error={error} />
        <InsetGroup>
          <TextRow label={`${unitWord(programme.unit)} used`} value={points} onChange={(e) => setPoints(e.target.value)} inputMode="decimal" placeholder={unitWord(programme.unit)} required />
          {typed && <TextRow label="What for" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Voucher" />}
          <TextRow label="What it fetched" prefix={ws.baseCurrency} hint="Leave empty if it had no cash value." value={fetched} onChange={(e) => setFetched(groupTypedAmount(e.target.value, ws.baseCurrency))} inputMode="decimal" placeholder="Amount" />
          <TextRow label="Date" type="date" value={on} onChange={(e) => setOn(e.target.value)} required />
        </InsetGroup>
      </Sheet>
    );
  }

  const to = step.to;
  const target = others.find((other) => other.id === to);
  const partnerName = to.startsWith('partner:') ? to.slice('partner:'.length) : null;
  const creating = partnerName !== null || to === 'new';
  const targetName = target?.name ?? partnerName ?? newName.trim();
  const targetUnit = target?.unit ?? newUnit;
  const estimate = targetName ? conversionEstimate(parsePoints(points), partnerFor(targetName, partners), programme.unit) : null;
  // Until something is typed into it, what arrived follows the estimate.
  const shownReceived = received ?? (estimate && estimate.received > 0 ? formatPoints(estimate.received) : '');

  const run = () =>
    void save(() =>
      recordConversion(database, ws, {
        fromProgrammeId: programme.id,
        ...(creating ? { newProgramme: { name: targetName, unit: newUnit } } : { toProgrammeId: to }),
        points: parsePoints(points),
        received: parsePoints(shownReceived),
        occurredOn: on,
      }),
    );

  return (
    <Sheet
      grouped
      title={targetName ? `To ${targetName}` : 'Convert'}
      onClose={onClose}
      back={back}
      confirm={{ label: 'Save conversion', disabled: busy || !targetName || !points.trim() || !shownReceived.trim(), run }}
    >
      <ErrorBox error={error} />
      {(to === 'new' || creating) && (
        <InsetGroup>
          {to === 'new' && <TextRow label="Programme name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Programme" required />}
          <SelectRow label="Counted in" value={newUnit} onChange={(e) => setNewUnit(e.target.value as ProgrammeUnit)}>
            <option value="miles">Miles</option>
            <option value="points">Points</option>
            <option value="cashback">Cashback</option>
          </SelectRow>
        </InsetGroup>
      )}
      <TransferEstimates partners={partners} points={statementPoints} unit={programme.unit} today={today} />
      <InsetGroup footer="Taken from the points that expire soonest. What arrived starts a batch of its own, expiring under the other programme's policy.">
        <TextRow
          label={`${unitWord(programme.unit)} converted`}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          inputMode="decimal"
          placeholder={unitWord(programme.unit)}
          hint={estimate?.note ?? undefined}
          required
        />
        <TextRow
          label={`${unitWord(targetUnit)} received`}
          value={shownReceived}
          onChange={(e) => setReceived(e.target.value)}
          inputMode="decimal"
          placeholder={unitWord(targetUnit)}
          hint={estimate && received === null && estimate.received > 0 ? 'At the partner ratio. Change it to what arrived.' : undefined}
          required
        />
        <TextRow label="Date" type="date" value={on} onChange={(e) => setOn(e.target.value)} required />
      </InsetGroup>
    </Sheet>
  );
}

/** Setting the balance to the one the issuer's app shows, with roughly when those points were earned. */
export function BalanceSheet({ programme, today, onClose }: { programme: ProgrammeRow; today: string; onClose: () => void }) {
  const { database, ws } = useApp();
  const { error, busy, save } = useSave(onClose);
  const [balance, setBalance] = useState('');
  const [earnedOn, setEarnedOn] = useState('');
  return (
    <Sheet
      grouped
      title="Adjust balance"
      onClose={onClose}
      confirm={{
        label: 'Save',
        disabled: busy || !balance.trim(),
        run: () =>
          void save(() =>
            recordPointSnapshot(database, ws, {
              programId: programme.id,
              balance: parsePoints(balance),
              observedOn: today,
              ...(earnedOn.trim() === '' ? {} : { earnedOn }),
            }),
          ),
      }}
    >
      <ErrorBox error={error} />
      <InsetGroup footer="The difference from the balance here is recorded as one correction, so the history still shows what the cards earned.">
        <TextRow label="Actual balance" value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" placeholder={unitWord(programme.unit)} required />
        <TextRow
          label="Earned around"
          hint="Roughly when those points were earned, which decides when they expire. Empty counts them as earned today."
          type="date"
          value={earnedOn}
          onChange={(e) => setEarnedOn(e.target.value)}
        />
      </InsetGroup>
    </Sheet>
  );
}
