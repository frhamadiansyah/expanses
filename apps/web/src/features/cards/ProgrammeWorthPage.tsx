import { CURRENCIES, formatMinor, parseMajor } from '@expanses/core';
import { deleteRedemptionOption, getProgramme, listPrograms, listRedemptionOptions, programmeEarners, saveRedemptionOption } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, PushedTitle, SCREEN, SelectRow, TextRow } from '../../ui/native';
import { formatPoints } from './format-points';
import { ColumnGroup, RowWithActions, SubmitRow, TextLine } from './rows';

/**
 * What a programme's points fetch, one value per redemption: what the cards' points are worth on their pages, and
 * what Redeem offers. A value belongs to the card whose terms list it, so with two cards earning here each value says
 * whose it is, and a new one is added to the card chosen with the ＋ in the corner.
 */
export function ProgrammeWorthPage() {
  const { database, ws } = useApp();
  const { programmeId } = useParams({ strict: false }) as { programmeId: string };
  const goBack = useBack('/cards/points');
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const data = useQuery({
    queryKey: ['programme-worth', ws.workspaceId, programmeId],
    queryFn: async () => {
      const programme = await getProgramme(database, ws, programmeId);
      if (!programme) return null;
      const earners = (await programmeEarners(database, ws)).get(programmeId) ?? [];
      return {
        programme,
        earners,
        options: (await Promise.all(earners.map((earner) => listRedemptionOptions(database, ws, earner.programId)))).flat(),
        // Which earning cards follow the catalogue: changing a value of theirs makes them customised, so it asks first.
        linked: new Set((await listPrograms(database, ws)).filter((program) => program.catalogStatus === 'linked').map((program) => program.id)),
      };
    },
  });
  if (data.isSuccess && data.data === null) return <Empty>Programme not found.</Empty>;
  if (!data.data) return <p className="text-sm text-slate-500">Loading…</p>;
  const { programme, earners, options, linked } = data.data;

  const cardOf = (id: string) => earners.find((earner) => earner.programId === id)?.cardName ?? programme.name;
  const confirmCustomise = (id: string) =>
    !linked.has(id) || window.confirm(`${cardOf(id)} follows the catalogue. Changing it makes it customised: catalogue updates stop applying automatically and wait for review. Continue?`);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await invalidate();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };

  return (
    <div className={SCREEN}>
      <PushedTitle
        title="What points are worth"
        back={programme.name}
        onBack={goBack}
        actions={earners.length > 0 ? [{ key: 'add-value', label: 'Add a value', glyph: <Plus size={20} aria-hidden />, run: () => setAdding(true) }] : []}
      />
      <ErrorBox error={error} />
      <div data-testid="point-values">
        <InsetGroup footer={earners.length === 0 ? `Values come with the cards earning into ${programme.name}.` : undefined}>
          {options.length === 0 && <TextLine tone="ink-3">No values yet. Add what a redemption fetches, so points can be worth something here.</TextLine>}
          {options.map((option) => (
            <RowWithActions
              key={option.id}
              title={`${option.name}: ${formatPoints(option.perPoints)} ${programme.unit} = ${formatMinor(option.valueMinor, option.currency)}`}
              subtitle={earners.length > 1 ? cardOf(option.programId) : undefined}
              actions={[
                {
                  label: `Remove ${option.name}`,
                  glyph: <Trash2 size={17} aria-hidden />,
                  destructive: true,
                  onClick: () => confirmCustomise(option.programId) && void act(() => deleteRedemptionOption(database, ws, option.id)),
                },
              ]}
            />
          ))}
        </InsetGroup>
      </div>
      {adding && (
        <AddValueSheet
          unit={programme.unit}
          earners={earners}
          confirmCustomise={confirmCustomise}
          onClose={() => setAdding(false)}
          save={async (input) => {
            if (await act(() => saveRedemptionOption(database, ws, { ...input, type: 'cashback' }))) setAdding(false);
          }}
        />
      )}
    </div>
  );
}

/** The add-a-value form, in a sheet: the card (when several earn here), the redemption, the points it takes and what it fetched. */
function AddValueSheet({
  unit,
  earners,
  confirmCustomise,
  save,
  onClose,
}: {
  unit: string;
  earners: { programId: string; cardName: string }[];
  confirmCustomise: (programId: string) => boolean;
  save: (input: { programId: string; name: string; perPoints: number; valueMinor: number; currency: string }) => Promise<void>;
  onClose: () => void;
}) {
  const { ws } = useApp();
  const [programId, setProgramId] = useState(earners[0]?.programId ?? '');
  const [name, setName] = useState('');
  const [points, setPoints] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(ws.baseCurrency);
  const [error, setError] = useState<unknown>(null);
  const target = earners.some((earner) => earner.programId === programId) ? programId : (earners[0]?.programId ?? '');
  return (
    <Sheet grouped title="Add a value" onClose={onClose}>
      <ErrorBox error={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!confirmCustomise(target)) return;
          setError(null);
          try {
            void save({ programId: target, name, perPoints: Number(points), valueMinor: parseMajor(value, currency), currency });
          } catch (err) {
            setError(err);
          }
        }}
      >
        <ColumnGroup
          columns={[
            [
              ...(earners.length > 1
                ? [
                    <SelectRow key="card" label="Card" value={target} onChange={(e) => setProgramId(e.target.value)}>
                      {earners.map((earner) => (
                        <option key={earner.programId} value={earner.programId}>
                          {earner.cardName}
                        </option>
                      ))}
                    </SelectRow>,
                  ]
                : []),
              <TextRow key="name" label="Redemption" value={name} onChange={(e) => setName(e.target.value)} placeholder="Statement credit" />,
              <TextRow key="points" label={unit === 'miles' ? 'Miles redeemed' : 'Points redeemed'} value={points} onChange={(e) => setPoints(e.target.value)} inputMode="numeric" placeholder="Points" required />,
            ],
            [
              <TextRow key="value" label="Worth" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Amount" required />,
              <SelectRow key="currency" label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </SelectRow>,
            ],
          ]}
          submit={<SubmitRow label="Add value" />}
        />
      </form>
    </Sheet>
  );
}
