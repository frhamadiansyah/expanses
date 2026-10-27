import { type ExpiryPolicy, parseMajor, type TransferPartner } from '@expanses/core';
import {
  archiveProgramme,
  createProgramme,
  type ProgrammeRow,
  type ProgrammeUnit,
  recordConversion,
  recordPointSnapshot,
  recordRedemption,
  type RedemptionOptionRow,
  setProgramExpiry,
  setProgrammeTier,
  updateProgramme,
} from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, ReadOnlyRow, SelectRow, TextRow } from '../../ui/native';
import { formatPoints } from './format-points';
import { programmeFamily, programmeTier } from './programme-art/programmes';
import { conversionEstimate, parsePoints, partnerFor } from './programme-text';

/*
 * The sheets a points programme is worked with: adding one, its settings, and the three round buttons on its page —
 * Redeem, Convert and Balance. Each saves with the ✓ in its header and closes; what went wrong stays on the sheet.
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
      <InsetGroup footer="Every card earning into this programme, and every conversion into it, follows this one policy.">
        <SelectRow label="Points expire" value={policy} onChange={(e) => setPolicy(e.target.value as ExpiryPolicy)}>
          <option value="none">Never</option>
          <option value="months_from_earn">After a number of months</option>
          <option value="fixed_annual">At the end of the year earned</option>
        </SelectRow>
        {policy === 'months_from_earn' && <TextRow label="Months they last" value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" placeholder="Months" />}
      </InsetGroup>
    </>
  );
}

const monthsOf = (policy: ExpiryPolicy, months: string) => (policy === 'months_from_earn' ? Number(months.trim()) : null);

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
 * A programme's settings: its name, unit and expiry, its card tier, and putting it away.
 *
 * Card tier is offered only for a programme whose name finds a drawn membership card with more than one tier, and its
 * list follows the name as it is typed. The first tier is the default and is kept as nothing chosen; a programme whose
 * name no longer finds a family keeps whatever tier it had, unused.
 */
export function ProgrammeSettingsSheet({
  programme,
  tier,
  earning,
  onClose,
  onArchived,
}: {
  programme: ProgrammeRow;
  tier: string | null;
  earning: number;
  onClose: () => void;
  onArchived: () => void;
}) {
  const { database, ws } = useApp();
  const { error, busy, save } = useSave(onClose);
  const archive = useSave(onArchived);
  const [name, setName] = useState(programme.name);
  const [unit, setUnit] = useState<ProgrammeUnit>(programme.unit);
  const [policy, setPolicy] = useState<ExpiryPolicy>(programme.expiryPolicy);
  const [months, setMonths] = useState(String(programme.expiryMonths ?? 24));
  const [tierId, setTierId] = useState(tier);
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
            await setProgramExpiry(database, ws, programme.id, policy, monthsOf(policy, months));
            if (family && chosen) {
              const word = chosen.id === family.tiers[0]!.id ? null : chosen.id;
              if (word !== tier) await setProgrammeTier(database, ws, programme.id, word);
            }
          }),
      }}
    >
      <ErrorBox error={error ?? archive.error} />
      <ProgrammeFields name={name} setName={setName} unit={unit} setUnit={setUnit} policy={policy} setPolicy={setPolicy} months={months} setMonths={setMonths} />
      {tiers && chosen && (
        <InsetGroup header="Membership card" footer="Which of the programme's cards is drawn for it on the Points page.">
          <SelectRow label="Card tier" value={chosen.id} onChange={(e) => setTierId(e.target.value)}>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </SelectRow>
        </InsetGroup>
      )}
      <InsetGroup footer={earning > 0 ? 'A card still earns into this programme. Choose another programme for that card before archiving this one.' : 'Archiving keeps its history and takes it off the Cards page.'}>
        <DestructiveRow
          label="Archive programme"
          muted={earning > 0}
          onClick={() => {
            if (earning > 0 || !window.confirm(`Archive ${programme.name}?`)) return;
            void archive.save(() => archiveProgramme(database, ws, programme.id));
          }}
        />
      </InsetGroup>
    </Sheet>
  );
}

/** Spending points: on what, for what it fetched, taken from the points that die soonest. */
export function RedeemSheet({ programme, options, today, onClose }: { programme: ProgrammeRow; options: RedemptionOptionRow[]; today: string; onClose: () => void }) {
  const { database, ws } = useApp();
  const { error, busy, save } = useSave(onClose);
  const [points, setPoints] = useState('');
  const [choice, setChoice] = useState('');
  const [what, setWhat] = useState('');
  const [value, setValue] = useState('');
  const [on, setOn] = useState(today);
  const named = [...new Set(options.map((option) => option.name))];
  const typed = named.length === 0 || choice === 'other';
  const note = typed ? what.trim() || null : choice || null;
  return (
    <Sheet
      grouped
      title="Redeem"
      onClose={onClose}
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
              valueMinor: value.trim() === '' ? null : parseMajor(value, ws.baseCurrency),
            }),
          ),
      }}
    >
      <ErrorBox error={error} />
      <InsetGroup footer="Taken from the points that expire soonest, so none are lost that could have been used.">
        <TextRow label={`${unitWord(programme.unit)} redeemed`} value={points} onChange={(e) => setPoints(e.target.value)} inputMode="decimal" placeholder={unitWord(programme.unit)} required />
        {named.length > 0 && (
          <SelectRow label="What for" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose…</option>
            {named.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value="other">Something else…</option>
          </SelectRow>
        )}
        {typed && <TextRow label={named.length === 0 ? 'What for' : 'Describe it'} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Voucher" />}
        <TextRow label={`What it fetched (${ws.baseCurrency})`} hint="Leave empty if it had no cash value." value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Amount" />
        <TextRow label="Date" type="date" value={on} onChange={(e) => setOn(e.target.value)} required />
      </InsetGroup>
    </Sheet>
  );
}

/**
 * Converting points into another programme: which one, how many points left, and what arrived. What arrived starts at
 * the partner's ratio when a card earning here lists that partner, and is the figure the other programme's app shows
 * — so it can always be changed to what actually landed. A partner not set up as a programme yet, or one typed in, is
 * made in the same step.
 */
export function ConvertSheet({
  programme,
  others,
  partners,
  today,
  onClose,
}: {
  programme: ProgrammeRow;
  others: ProgrammeRow[];
  partners: TransferPartner[];
  today: string;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const { error, busy, save } = useSave(onClose);
  const [to, setTo] = useState('');
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState<ProgrammeUnit>('miles');
  const [points, setPoints] = useState('');
  const [received, setReceived] = useState<string | null>(null);
  const [on, setOn] = useState(today);

  // Partners not yet a programme here are offered too; one already a programme is that programme.
  const known = new Set(others.map((other) => other.name.trim().toLowerCase()));
  const fresh = partners.filter((partner) => !known.has(partner.program.trim().toLowerCase()));
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
    <Sheet grouped title="Convert" onClose={onClose} confirm={{ label: 'Save conversion', disabled: busy || !to || !targetName || !points.trim() || !shownReceived.trim(), run }}>
      <ErrorBox error={error} />
      <InsetGroup>
        <ReadOnlyRow label="From" value={programme.name} />
        <SelectRow
          label="To"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setReceived(null);
          }}
        >
          <option value="">Choose…</option>
          {others.length > 0 && (
            <optgroup label="Programmes">
              {others.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.name}
                </option>
              ))}
            </optgroup>
          )}
          {fresh.length > 0 && (
            <optgroup label="Partners">
              {fresh.map((partner) => (
                <option key={partner.id} value={`partner:${partner.program}`}>
                  {partner.program}
                </option>
              ))}
            </optgroup>
          )}
          <option value="new">New programme…</option>
        </SelectRow>
        {to === 'new' && <TextRow label="Programme name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Programme" required />}
        {creating && (
          <SelectRow label="Counted in" value={newUnit} onChange={(e) => setNewUnit(e.target.value as ProgrammeUnit)}>
            <option value="miles">Miles</option>
            <option value="points">Points</option>
            <option value="cashback">Cashback</option>
          </SelectRow>
        )}
      </InsetGroup>
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
      title="Balance"
      onClose={onClose}
      confirm={{
        label: 'Set balance',
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
