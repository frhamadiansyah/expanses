import { useEffect, useRef, useState } from 'react';
import { shareText } from '../../../native/share';
import { Button, ErrorBox } from '../../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN } from '../../../ui/native';
import { formatRupiah, maskCardNumber } from './apdu';
import { codeOf, EmoneyReader, hasNfc, pluginLink } from './plugin';
import { type CardRead, type Exchange, readEmoneyCard } from './reader';

/**
 * Settings → Capture → "Read an e-money card (test)". A diagnostic: hold a Mandiri e-money card to the phone and
 * see what it returns — the card number (masked to the last four), the balance, and every raw command and answer so
 * the exact bytes can be shared. Nothing is saved to the database or sent anywhere; the result lives on this screen
 * and is gone when it is left. Reachable only on the iPhone; elsewhere the button says NFC is not available.
 */
export function EmoneyReaderPage() {
  const [available, setAvailable] = useState<{ available: boolean; reason: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [read, setRead] = useState<CardRead | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    EmoneyReader.available()
      .then((value) => mounted.current && setAvailable(value))
      .catch(() => mounted.current && setAvailable({ available: false, reason: 'NFC is not available on this device' }));
    return () => {
      mounted.current = false;
      // A session left open (the screen closed mid-read) is told to end.
      if (hasNfc()) void EmoneyReader.end().catch(() => {});
    };
  }, []);

  async function start() {
    setError(null);
    setRead(null);
    setCopied(false);
    setBusy(true);
    try {
      await EmoneyReader.begin();
      const result = await readEmoneyCard(pluginLink, {
        onProgress: (done, total, label) => mounted.current && setProgress(`${label} (${done}/${total})`),
      });
      await EmoneyReader.end({ message: 'Done.' });
      if (mounted.current) setRead(result);
    } catch (e) {
      // A dismissed NFC sheet is not an error worth showing.
      if (codeOf(e) !== 'cancelled') setError(e);
      if (hasNfc()) void EmoneyReader.end().catch(() => {});
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  async function copyRaw() {
    if (!read) return;
    const result = await shareText({ title: 'E-money card read', text: rawText(read) });
    if (result === 'copied' && mounted.current) {
      setCopied(true);
      setTimeout(() => mounted.current && setCopied(false), 2000);
    }
  }

  const canRead = available?.available ?? false;

  return (
    <div className={SCREEN}>
      <LargeTitle title="Read an e-money card" back="Capture" backTo="/settings/capture" />
      <ErrorBox error={error} />

      <InsetGroup
        header="Test tool"
        footer={
          canRead
            ? 'Hold a Mandiri e-money card to the top of the phone. Nothing is saved or sent — the result is gone when this screen is left.'
            : (available?.reason ?? 'NFC is not available on this device') + '. This tool needs an iPhone with NFC.'
        }
      >
        <div className="px-3 py-2.5">
          <Button className="w-full" disabled={!canRead || busy} onClick={() => void start()}>
            {busy ? (progress ?? 'Reading the card…') : 'Hold card to phone'}
          </Button>
        </div>
      </InsetGroup>

      {read && (
        <>
          <InsetGroup header="What the card returned">
            <InsetRow title="Card number" value={read.cardNumber ? maskCardNumber(read.cardNumber) : '—'} chevron={false} />
            <InsetRow title="Balance" value={read.balance === null ? '—' : formatRupiah(read.balance)} chevron={false} />
            {read.note && <InsetRow title="Note" subtitle={read.note} chevron={false} />}
          </InsetGroup>

          <InsetGroup
            header="History"
            footer={
              read.history.length === 0
                ? 'History not readable with a standard read.'
                : 'A best-effort reading of each record, marked a guess — the raw bytes are below. Confirm against a real entry.'
            }
          >
            {read.history.length === 0 ? (
              <InsetRow title="No records" chevron={false} />
            ) : (
              read.history.map((entry) => (
                <InsetRow
                  key={entry.record}
                  title={`Record ${entry.record} (guess)`}
                  subtitle={entry.guesses.length ? entry.guesses.join(' · ') : 'nothing recognisable'}
                  chevron={false}
                />
              ))
            )}
          </InsetGroup>

          <InsetGroup
            header="Raw responses"
            footer="Each command, the status word it answered with (9000 means OK), and the bytes it returned."
          >
            {read.exchanges.map((exchange, index) => (
              <InsetRow key={index} title={exchange.label} subtitle={rawLine(exchange)} chevron={false} />
            ))}
          </InsetGroup>

          <div className="px-3">
            <Button variant="secondary" className="w-full" onClick={() => void copyRaw()}>
              {copied ? 'Copied' : 'Share raw responses'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** One exchange as a line under its command: refused, or the status word and the bytes. */
function rawLine(exchange: Exchange): string {
  if (exchange.refused) return `refused: ${exchange.refused}`;
  const body = exchange.data ? ` · ${spaced(exchange.data)}` : '';
  return `${exchange.command} → ${exchange.sw || '—'}${body}`;
}

/** The whole read as plain text to share, so the exact bytes can be sent on. */
function rawText(read: CardRead): string {
  const lines = [
    `Card number: ${read.cardNumber ? maskCardNumber(read.cardNumber) : '—'}`,
    `Balance: ${read.balance === null ? '—' : formatRupiah(read.balance)}`,
    read.note ? `Note: ${read.note}` : null,
    '',
    'Raw responses:',
    ...read.exchanges.map((exchange) =>
      exchange.refused
        ? `${exchange.label}: ${exchange.command} refused (${exchange.refused})`
        : `${exchange.label}: ${exchange.command} → ${exchange.sw}${exchange.data ? ` ${exchange.data}` : ''}`,
    ),
    read.history.length ? '' : null,
    read.history.length ? 'History guesses:' : 'History: not readable with a standard read',
    ...read.history.map((entry) => `Record ${entry.record}: ${entry.guesses.join(' · ') || 'nothing recognisable'}`),
  ];
  return lines.filter((line) => line !== null).join('\n');
}

/** Hex in byte pairs, readable in the raw list. */
function spaced(hex: string): string {
  return hex.replace(/(.{2})(?=.)/g, '$1 ');
}
