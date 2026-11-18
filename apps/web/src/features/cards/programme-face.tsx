import type { Balance, PointsWorth } from '@expanses/core';
import type { ProgrammeEarner, ProgrammeHistoryRow, ProgrammeRow } from '@expanses/db';
import { CARD_W, cardHeightFor, type WalletCard, WalletFace } from '../../ui/native';
import type { NextExpiry } from './points-desk-model';

/** The small card before a programme's name on Mac Points, and the big one at the top of its peek. */
export const SMALL_FACE = 46;
export const BIG_FACE = 306;
const radiusFor = (width: number) => Math.max(3, Math.round(14.4 * (width / CARD_W)));

/** One programme as the page reads it: the phone's figures for it, its face, and what the table and peek say. */
export interface DeskProgramme {
  id: string;
  programme: ProgrammeRow;
  earners: ProgrammeEarner[];
  balance: Balance;
  history: ProgrammeHistoryRow[];
  valuePerPoint: number | null;
  /** What its balance is worth: its value per point, else the best redemption of the cards earning here (the phone's). */
  worth: PointsWorth | null;
  expiry: NextExpiry | null;
  /** The phone's "3.000 expire 31 Dec", when any of it dies within the window. */
  note: string | null;
  tier: string | null;
  /** The card the table and peek draw: the phone's, with the Mac's bank face where no membership card is drawn. */
  card: WalletCard;
}

/** A programme's card, drawn whole at `width`: the phone's art (and the Mac's bank face), scaled from Wallet's 240. */
export function ProgrammeFace({ card, width, selected = false }: { card: WalletCard; width: number; selected?: boolean }) {
  return (
    <span
      className="relative block shrink-0"
      style={{
        width,
        height: cardHeightFor(width),
        borderRadius: radiusFor(width),
        boxShadow: selected ? '0 0 0 1.5px rgb(255 255 255 / 0.9)' : '0 1px 3px rgba(0,0,0,0.25)',
      }}
    >
      <WalletFace card={card} band={false} scale={width / CARD_W} />
    </span>
  );
}

