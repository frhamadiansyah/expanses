import { isoDate } from '@expanses/core';
import { listProgrammes, listProgrammeSummaries, refreshProgramme } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { CardStack, InsetGroup, InsetRow, PushedTitle, SCREEN, type WalletCard } from '../../ui/native';
import { balanceText, earnersLine, expiryNote } from './programme-text';
import { AddProgrammeSheet } from './ProgrammeSheets';

/**
 * The points programmes, a page of their own opened from Wallet's corner, laid out as Wallet lays out its cards: a
 * pile of faces, each a programme — a bank's that two cards earn into, an airline's a co-brand card earns straight
 * into, or one only conversions fill. The face names who earns into it and, in its band, the balance in its own unit;
 * what of it expires soon is said on the face too. Tapping a face opens the programme's page, whose ‹ comes back here.
 * ＋ in the corner adds a programme no card earns into yet.
 *
 * Each programme's ledger is brought up to date before it is shown, as opening it would, so the figure here is the
 * one its page shows.
 */
export function PointsPage() {
  const { database, ws } = useApp();
  const goBack = useBack('/wallet');
  const today = isoDate();
  const [adding, setAdding] = useState(false);
  const summaries = useQuery({
    queryKey: ['programmes', ws.workspaceId, today],
    queryFn: async () => {
      for (const programme of await listProgrammes(database, ws)) await refreshProgramme(database, ws, programme.id, today);
      return listProgrammeSummaries(database, ws, today);
    },
  });
  const rows = summaries.data ?? [];
  const cards: WalletCard[] = rows.map(({ programme, earners, balance }) => {
    const note = expiryNote(balance);
    const earning = earnersLine(earners);
    const figure = balanceText(balance.total, programme.unit);
    return {
      key: programme.id,
      issuer: null,
      name: programme.name,
      last4: null,
      kind: note ? `${earning} · ${note}` : earning,
      figure,
      figureLabel: '',
      to: '/cards/points/$programmeId',
      params: { programmeId: programme.id },
      label: [programme.name, figure, earning, note].filter(Boolean).join(', '),
    };
  });
  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Points"
        back="Wallet"
        onBack={goBack}
        actions={[{ key: 'add', label: 'New programme', glyph: <Plus size={22} aria-hidden />, run: () => setAdding(true) }]}
      />
      {cards.length > 0 && <CardStack label="Points" cards={cards} />}
      {rows.length === 0 && summaries.isSuccess && (
        <InsetGroup footer="A card set up with rewards earns into a programme of its own. An airline or hotel programme filled by conversions is added with ＋.">
          <InsetRow title={<span className="text-[var(--ph-ink-3)]">No programmes yet</span>} />
        </InsetGroup>
      )}
      {adding && <AddProgrammeSheet onClose={() => setAdding(false)} />}
    </div>
  );
}
