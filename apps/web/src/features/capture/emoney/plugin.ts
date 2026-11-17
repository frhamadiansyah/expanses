import { Capacitor, registerPlugin, WebPlugin } from '@capacitor/core';
import { isPhoneApp } from '../../../lib/mac';
import type { CardAnswer } from './apdu';
import type { CardLink } from './reader';

/**
 * The app's own Swift plugin (ios/App/App/Nfc/EmoneyReaderPlugin.swift): an `NFCTagReaderSession` that holds a
 * reader session open while the owner taps a card, and transmits one APDU at a time. Every command still passes the
 * read-only allowlist in Swift before it is sent — this bridge is a convenience, not the gate.
 *
 * The session is a single conversation: `begin` opens it and waits for a tag, each `transmit` sends one command, and
 * `end` closes it. A diagnostic reads a fixed, short list, so there is no streaming or callback plumbing to carry.
 */
export interface EmoneyReaderPlugin {
  /** True only on an iPhone with Core NFC available; false on the simulator, iPad and the web. */
  available(): Promise<{ available: boolean; reason: string | null }>;
  /** Opens a reader session and resolves once a card is held to the phone; rejects with `cancelled` if dismissed. */
  begin(): Promise<void>;
  /** Sends one command (upper-case hex) and hands back the card's answer split into data and status word. */
  transmit(options: { apdu: string }): Promise<CardAnswer>;
  /** Closes the session, with an optional message shown on the phone's NFC sheet. */
  end(options?: { message?: string }): Promise<void>;
}

class EmoneyReaderWeb extends WebPlugin implements EmoneyReaderPlugin {
  async available(): Promise<{ available: boolean; reason: string | null }> {
    return { available: false, reason: 'NFC is not available on this device' };
  }

  async begin(): Promise<void> {
    throw this.unavailable('NFC is not available on this device');
  }

  async transmit(): Promise<CardAnswer> {
    throw this.unavailable('NFC is not available on this device');
  }

  async end(): Promise<void> {
    // No session was ever opened here.
  }
}

export const EmoneyReader = registerPlugin<EmoneyReaderPlugin>('EmoneyReader', {
  web: () => Promise.resolve(new EmoneyReaderWeb()),
});

/** Core NFC lives only in the iPhone app (not the Mac app). Everywhere else the screen says NFC is not available. */
export const hasNfc = (): boolean => isPhoneApp() && Capacitor.getPlatform() === 'ios';

/** The rejection code a plugin call carries, or null. */
export const codeOf = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
};

/** Wraps the plugin as the `CardLink` the reader drives: one command out, one answer back. */
export const pluginLink: CardLink = {
  transmit: (apdu) => EmoneyReader.transmit({ apdu }),
};
