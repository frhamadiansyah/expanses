import { Fuel, Plus, Search, ShoppingBasket, Smartphone, Utensils } from 'lucide-react';
import { useState } from 'react';
import {
  CardStack,
  cardFigure,
  CORNER_MAX,
  DestructiveRow,
  Figure,
  Hero,
  InsetGroup,
  InsetRow,
  LargeTitle,
  PHONE_MAX,
  PickerRow,
  ProgressBar,
  ReadOnlyRow,
  RecordTable,
  SegmentedControl,
  TextRow,
  type CornerAction,
  type RecordColumn,
  type Segment,
  type WalletCard,
} from '../../ui/native';
import { formatMinor } from '@expanses/core';
import { categoryColour } from '../transactions/category-colours';

/**
 * Every primitive, once, with real figures — so the system can be looked at before forty-one routes adopt it.
 *
 * Not linked from anywhere: it is a specimen sheet, not a screen. Nothing on it reads or writes the database,
 * so it renders identically on an empty device and on a full one, and it cannot be the reason a page breaks.
 */

const rp = (minor: number) => formatMinor(minor, 'IDR');

const CARD_TABS: Segment[] = [
  { key: 'statement', label: 'Statement' },
  { key: 'points', label: 'Points' },
  { key: 'rules', label: 'Rewards rules', short: 'Rules' },
  { key: 'card', label: 'Card' },
];

const NET_WORTH_TABS: Segment[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'assets', label: 'Assets' },
  { key: 'trades', label: 'Buy & sell', short: 'Trades' },
  { key: 'debts', label: 'Lend & borrow', short: 'Debts' },
  { key: 'loans', label: 'Loans' },
];

const WALLET: WalletCard[] = [
  {
    key: 'bca',
    issuer: 'BCA',
    name: 'BCA KrisFlyer Visa Signature',
    last4: '1467',
    holderName: 'Rizky Pratama',
    network: 'visa',
    figure: cardFigure(42_500, null, 'miles'),
    figureLabel: 'KrisFlyer miles',
  },
  {
    key: 'mandiri',
    issuer: 'Mandiri',
    name: 'Mandiri Skyz Mastercard',
    last4: '8802',
    holderName: 'Rizky Pratama',
    network: 'mastercard',
    figure: cardFigure(18_240, null, 'points'),
    figureLabel: 'Fiestapoin',
  },
  {
    key: 'bni',
    issuer: 'BNI',
    name: 'BNI Marriott Bonvoy',
    last4: '3391',
    holderName: 'Dewi Anggraini',
    network: 'visa',
    figure: cardFigure(8_412_000, 'IDR'),
    figureLabel: 'Owed this cycle',
  },
];

interface Purchase {
  id: string;
  merchant: string;
  where: string;
  card: string;
  minor: number;
  occurredOn: string;
  points: number;
}

const PURCHASES: Purchase[] = [
  { id: 'a', merchant: 'Superindo', where: 'Bintaro Jaya', card: '···· 1467', minor: 184_000, occurredOn: '18 Sep', points: 184 },
  { id: 'b', merchant: 'Tokopedia', where: 'Samsung Galaxy S24 Ultra 512GB', card: '···· 8802', minor: 21_999_000, occurredOn: '17 Sep', points: 4_400 },
  { id: 'c', merchant: 'Pertamina', where: 'SPBU 34-12907 Pondok Indah', card: '···· 1467', minor: 390_000, occurredOn: '16 Sep', points: 390 },
  { id: 'd', merchant: 'Gojek', where: 'GoRide · Kuningan', card: '···· 3391', minor: 28_500, occurredOn: '16 Sep', points: 28 },
];

const COLUMNS: RecordColumn<Purchase>[] = [
  { key: 'date', heading: 'Date', cell: (row) => row.occurredOn },
  { key: 'merchant', heading: 'Merchant', cell: (row) => row.merchant },
  { key: 'where', heading: 'What it was', cell: (row) => row.where },
  { key: 'card', heading: 'Paid with', cell: (row) => row.card },
  { key: 'points', heading: 'Points', numeric: true, cell: (row) => new Intl.NumberFormat('id-ID').format(row.points) },
  { key: 'amount', heading: 'Amount', numeric: true, cell: (row) => <Figure tone="alarm">{rp(row.minor)}</Figure> },
];

/** A demonstration of the label, not a demonstration of the section. */
function Note({ children }: { children: string }) {
  return <p className="mb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{children}</p>;
}

export function KitPage() {
  const [cardTab, setCardTab] = useState('statement');
  const [netWorthTab, setNetWorthTab] = useState('overview');
  const [category, setCategory] = useState<string | null>('Belanja harian');
  const [merchant, setMerchant] = useState('Superindo Bintaro');

  const actions: CornerAction[] = [
    { key: 'search', label: 'Search', glyph: <Search size={20} aria-hidden />, run: () => {} },
    { key: 'add', label: 'Add a transaction', glyph: <Plus size={22} aria-hidden />, run: () => {} },
    { key: 'edit', label: 'Edit', run: () => {} },
    { key: 'delete', label: 'Delete this month', destructive: true, run: () => {} },
  ];

  return (
    <div className="ph-screen -m-4 min-h-dvh p-4 md:-m-8 md:p-8">
      <LargeTitle
        title="Design kit"
        back="Transactions"
        subtitle="Seven primitives, real figures. Nothing here is a screen."
        actions={actions}
      />

      <Note>
        {`3 · Large title and corner buttons — ${actions.length} actions, ${CORNER_MAX} corners: the second becomes a …`}
      </Note>

      <Note>4 · Segmented control — the card page's four tabs, with “Rewards rules” shortened so all four fit</Note>
      <div className="mb-[18px]">
        <SegmentedControl segments={CARD_TABS} value={cardTab} onChange={setCardTab} label="Card sections" />
      </div>

      <Note>{`4 · The same control with five tabs at phone width, where only ${PHONE_MAX} fit — the fifth moves behind the …`}</Note>
      <div className="mb-[18px]">
        <SegmentedControl segments={NET_WORTH_TABS} value={netWorthTab} onChange={setNetWorthTab} label="Net worth sections" />
      </div>

      <Note>5 · Hero — a figure, a caption and the bar that says how far through the month it is</Note>
      <Hero
        icon={<Utensils size={22} aria-hidden />}
        iconColour={categoryColour('makan-di-luar')}
        minor={12_400_000}
        currency="IDR"
        direction="out"
        caption="Spent on eating out · September 2026"
        progress={{ targetMinor: 14_000_000, label: 'Eating out against its budget' }}
      />

      <Note>5 · The same bar past its target, which is a different fact and so a different colour</Note>
      <div className="mb-[18px] max-w-[320px]">
        <ProgressBar currentMinor={16_800_000} targetMinor={14_000_000} label="Travel against its budget" />
      </div>

      <Note>1 and 2 · Grouped inset list — header outside the group, rows with tinted icons and one figure each</Note>
      <InsetGroup header="Friday 18 September" trailing={rp(602_500)}>
        {PURCHASES.map((purchase) => (
          <InsetRow
            key={purchase.id}
            icon={iconFor(purchase.merchant)}
            iconColour={categoryColour(purchase.merchant)}
            title={purchase.merchant}
            subtitle={`${purchase.where} · ${purchase.card}`}
            value={rp(purchase.minor)}
            valueTone="alarm"
            onClick={() => {}}
          />
        ))}
      </InsetGroup>

      <Note>1 · A header may carry a figure of its own</Note>
      <InsetGroup header="Travel" progress={{ spentMinor: 12_400_000, budgetMinor: 14_000_000, currency: 'IDR' }}>
        <InsetRow title="Flights · Singapore Airlines" value={rp(8_900_000)} valueTone="alarm" onClick={() => {}} />
        <InsetRow title="Hotel · Park Hotel Clarke Quay" value={rp(3_500_000)} valueTone="alarm" onClick={() => {}} />
        <InsetRow title="Visa & insurance" subtitle="Not bought yet" value="—" />
      </InsetGroup>

      <Note>6 · Form rows — label left, value right. No label above an outlined box, no bare select.</Note>
      <InsetGroup header="What it was" footer="A picker's answer is green; a prompt waiting for one is grey.">
        <TextRow label="Merchant" value={merchant} onChange={(event) => setMerchant(event.target.value)} />
        <PickerRow label="Category" value={category} placeholder="Choose a category" onOpen={() => setCategory('Transportasi')} />
        <PickerRow label="Event" value={null} placeholder="None" onOpen={() => {}} />
        <ReadOnlyRow label="Workspace" value="Rumah tangga" />
        <ReadOnlyRow label="Points earned" value="184" />
      </InsetGroup>

      <Note>6 · A destructive action gets a group to itself — the air around it is the only undo a finger has</Note>
      <InsetGroup>
        <DestructiveRow label="Delete this transaction" onClick={() => {}} />
      </InsetGroup>

      <Note>7 · Card art — the Wallet stack. Every card's figure reads from its strip, without a tap.</Note>
      <CardStack cards={WALLET} onOpen={() => {}} />

      <Note>A table becomes rows on a phone and stays a table on desktop. Narrow the window to see it change.</Note>
      <RecordTable header="This week" records={PURCHASES} columns={COLUMNS} shape={SHAPE} />
    </div>
  );
}

const SHAPE = {
  key: (row: Purchase) => row.id,
  title: (row: Purchase) => row.merchant,
  subtitle: (row: Purchase) => `${row.occurredOn} · ${row.card}`,
  value: (row: Purchase) => rp(row.minor),
  valueTone: () => 'alarm' as const,
  onOpen: () => {},
};

function iconFor(merchant: string) {
  switch (merchant) {
    case 'Superindo':
      return <ShoppingBasket size={15} aria-hidden />;
    case 'Pertamina':
      return <Fuel size={15} aria-hidden />;
    case 'Tokopedia':
      return <Smartphone size={15} aria-hidden />;
    default:
      return <Utensils size={15} aria-hidden />;
  }
}
