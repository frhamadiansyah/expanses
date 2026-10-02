import { formatPriceMicro, formatUnits, isoDate, parsePriceMicro } from '@expanses/core';
import { recordListedCloses, upsertPrice, upsertSecurityPrice } from '@expanses/db';
import { Check, Download, Info } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { type CornerAction, type GroupChild, InsetGroup, InsetRow, PushedTitle, ROW_PAD_X, ROW_PAD_Y, rowHeight, SCREEN, TextRow } from '../../ui/native';
import { useHoldingLinks, useSecurities } from '../investments/queries';
import { dayLabel, percentLabel } from '../networth/asset-page';
import { useAssetProfiles, useAssetValues } from '../networth/queries';
import { IDX_SUMMARY_PAGE, readIdxFile } from './idx-file';
import { catchesIdxInApp, catchIdxSummary } from './idx-native';
import { type BoardRow, type IdxPreview, idxPreview, priceBoard } from './price-board';
import { SOURCE_LABELS } from './price-sources';
import { useLatestOwnPrices, useLatestSecurityPrices } from './queries';

/** A price as it is typed: digits and marks, no currency sign. */
const typedForm = (micro: number, currency: string) => formatPriceMicro(micro, currency).replace(/[^\d.,]/g, '');

/** The line under a row: its last price, the day it is for and where it came from. */
const lastLine = (row: BoardRow) =>
  row.latest ? `Last ${formatPriceMicro(row.latest.priceMicro, row.currency)} · ${dayLabel(row.latest.onDate)} · ${SOURCE_LABELS[row.latest.source]}` : 'No price yet';

/**
 * A row that does something, with an ⓘ beside its title that shows what it does under the row only when asked —
 * InsetRow's look, which cannot hold a second button inside its own.
 */
function ActionRow({ title, info, onClick, position }: GroupChild & { title: string; info?: ReactNode; onClick: () => void }) {
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative">
      {position?.separator && (
        <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />
      )}
      <div className="flex items-center gap-2" style={{ minHeight: rowHeight(false), padding: `0 ${ROW_PAD_X}px` }}>
        <button
          type="button"
          onClick={onClick}
          className="ph-focus-inset min-w-0 flex-1 text-left text-[15px] leading-[20px] font-medium text-[var(--ph-tint)]"
          style={{ padding: `${ROW_PAD_Y}px 0` }}
        >
          {title}
        </button>
        {info && (
          <button
            type="button"
            // Not "About <title>": a search for the row's own name would find this button as well.
            aria-label="How this works"
            aria-expanded={explained}
            onClick={() => setExplained((was) => !was)}
            className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
          >
            <Info size={16} aria-hidden />
          </button>
        )}
      </div>
      {info && explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{info}</p>}
    </div>
  );
}

/**
 * `/net-worth/prices` — every listed share and fund held, one price box each: the routine of bringing prices up to
 * date in one place. What is typed is saved as today's price (✓). The shares IDX lists can all be filled at once from
 * IDX's daily Ringkasan Saham file, read on the device. In the iOS app IDX's own page opens in a sheet and the
 * file its Unduh button downloads comes straight to the preview; on the web and the desktop the owner downloads it
 * from IDX's site and chooses it.
 */
export function UpdatePricesPage() {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const links = useHoldingLinks();
  const securities = useSecurities();
  const latestBySecurity = useLatestSecurityPrices();
  const linked = new Set((links.data ?? []).filter((link) => link.securityId).map((link) => link.accountId));
  const ownIds = (values.data ?? []).filter((row) => row.mode === 'market' && !linked.has(row.accountId)).map((row) => row.accountId);
  const latestOwn = useLatestOwnPrices(ownIds);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [preview, setPreview] = useState<IdxPreview | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const inApp = catchesIdxInApp();

  const board =
    values.data && profiles.data && links.data && securities.data && latestBySecurity.data && latestOwn.data
      ? priceBoard({
          values: values.data,
          kinds: Object.fromEntries(profiles.data.map((profile) => [profile.accountId, profile.assetKind])),
          links: links.data,
          securities: securities.data,
          latestBySecurity: latestBySecurity.data,
          latestOwn: latestOwn.data,
        })
      : null;
  const rows = board ? [...board.stocks, ...board.others] : [];
  const entries = rows.map((row) => ({ row, value: (typed[row.key] ?? '').trim() })).filter((entry) => entry.value !== '');

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const onDate = isoDate();
      for (const { row, value } of entries) {
        const priceMicro = parsePriceMicro(value, row.currency);
        if (row.securityId) await upsertSecurityPrice(database, ws, { securityId: row.securityId, onDate, priceMicro });
        else await upsertPrice(database, ws, { accountId: row.accountId!, onDate, priceMicro });
      }
      setTyped({});
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function read(chosen: File | undefined) {
    setChoosing(false);
    if (!chosen || !board) return;
    setError(null);
    try {
      setPreview(idxPreview(await readIdxFile(chosen), board.stocks));
    } catch (e) {
      setError(e);
    } finally {
      // The same file can be chosen again after a fix.
      if (file.current) file.current.value = '';
    }
  }

  /** IDX's page in the native sheet; what Unduh downloads goes straight to the preview. Cancel says nothing. */
  async function getFromIdx() {
    setChoosing(false);
    if (!board) return;
    setError(null);
    try {
      const summary = await catchIdxSummary();
      if (summary) setPreview(idxPreview(summary, board.stocks));
    } catch (e) {
      setError(e);
    }
  }

  const actions: CornerAction[] = [
    { key: 'save', label: 'Save prices', glyph: <Check size={20} aria-hidden />, disabled: busy || entries.length === 0, run: () => void save() },
  ];

  const priceBox = (row: BoardRow) => (
    <TextRow
      key={row.key}
      label={row.title}
      hint={lastLine(row)}
      value={typed[row.key] ?? ''}
      onChange={(e) => setTyped({ ...typed, [row.key]: e.target.value })}
      inputMode="decimal"
      placeholder={row.latest ? typedForm(row.latest.priceMicro, row.currency) : 'Price'}
    />
  );

  return (
    <div className={SCREEN}>
      <PushedTitle title="Update prices" back="Assets" backTo="/net-worth/assets" actions={actions} />
      <ErrorBox error={error ?? values.error ?? latestBySecurity.error} />

      {board && board.stocks.length > 0 && (
        <button
          type="button"
          onClick={() => setChoosing(true)}
          className="ph-focus mb-[18px] flex min-h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--ph-tint)] px-4 text-[15px] font-semibold text-white md:max-w-2xl"
        >
          <Download size={18} aria-hidden />
          Import IDX daily file
        </button>
      )}
      {/* The file input the second step opens: Files on an iPhone, the file dialog on a computer. */}
      <input
        ref={file}
        type="file"
        aria-label="IDX daily file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => void read(e.target.files?.[0])}
      />

      {board && rows.length === 0 && <Empty>No shares or funds held. Their prices are updated here once there are some.</Empty>}
      {board && board.stocks.length > 0 && <InsetGroup header="Stocks">{board.stocks.map(priceBox)}</InsetGroup>}
      {board && board.others.length > 0 && (
        <InsetGroup header={board.stocks.length > 0 ? 'Not in the IDX file' : 'Shares and funds'} footer="A price typed here is saved as today’s.">
          {board.others.map(priceBox)}
        </InsetGroup>
      )}

      {choosing && (
        <Sheet grouped title="Import IDX daily file" onClose={() => setChoosing(false)}>
          {inApp ? (
            <InsetGroup>
              <ActionRow
                title="Get closing prices from IDX"
                info="IDX’s own page opens inside the app; tap Unduh and the file comes straight here. Nothing is fetched in the background."
                onClick={() => void getFromIdx()}
              />
            </InsetGroup>
          ) : (
            <InsetGroup>
              <ActionRow
                title="Open IDX website"
                info="Download Ringkasan Saham on IDX’s website, then choose the downloaded file. It is read on this device."
                onClick={() => void window.open(IDX_SUMMARY_PAGE, '_blank', 'noopener')}
              />
              <ActionRow title="Choose the downloaded file" onClick={() => file.current?.click()} />
            </InsetGroup>
          )}
        </Sheet>
      )}
      {preview && <PreviewSheet preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

/**
 * What IDX's file would change, before anything is saved: the file's day, how many of the shares held it has, and
 * each one's last price and the file's close with the change. A price typed for the file's day stays, and says so.
 */
function PreviewSheet({ preview, onClose }: { preview: IdxPreview; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const saving = preview.rows.filter((row) => row.keptMicro === null);
  const day = dayLabel(preview.tradeDate);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await recordListedCloses(database, ws, {
        onDate: preview.tradeDate,
        source: 'idx',
        closes: saving.map((row) => ({ securityId: row.securityId, priceMicro: row.newMicro })),
      });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet grouped title="IDX closing prices" onClose={onClose}>
      <div className="mb-[18px] rounded-[11px] bg-[var(--ph-surface)] px-4 py-3 text-center" data-testid="idx-preview">
        <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Closing prices for</p>
        <p className="text-[20px] leading-[26px] font-semibold text-[var(--ph-ink)]">{day}</p>
        <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          {preview.rows.length} held {preview.rows.length === 1 ? 'stock' : 'stocks'} found · {preview.skipped} others skipped
        </p>
      </div>
      {preview.rows.length > 0 ? (
        <InsetGroup header="Held stocks" info={`Saved as “IDX closing price · ${day}”. A price typed for that day is kept.`}>
          {preview.rows.map((row) => {
            const change = row.oldMicro && row.keptMicro === null ? row.newMicro - row.oldMicro : 0;
            return (
              <InsetRow
                key={row.securityId}
                title={row.ticker}
                subtitle={
                  row.keptMicro !== null
                    ? `Kept: ${formatUnits(row.keptMicro)} was typed for this day`
                    : `${row.oldMicro === null ? 'No price' : formatUnits(row.oldMicro)} → ${formatUnits(row.newMicro)}`
                }
                value={row.keptMicro !== null ? 'Kept' : row.oldMicro === null ? undefined : change === 0 ? '0,0%' : percentLabel(change, row.oldMicro)}
                valueTone={row.keptMicro !== null || change === 0 ? 'ink-3' : change > 0 ? 'tint' : 'alarm'}
                chevron={false}
              />
            );
          })}
        </InsetGroup>
      ) : (
        <Empty>None of the shares held are in this file.</Empty>
      )}
      <ErrorBox error={error} />
      {saving.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="ph-focus mb-2 flex min-h-11 w-full items-center justify-center rounded-[12px] bg-[var(--ph-tint)] px-4 text-[15px] font-semibold text-white disabled:opacity-40"
        >
          Save {saving.length} {saving.length === 1 ? 'price' : 'prices'}
        </button>
      )}
    </Sheet>
  );
}
