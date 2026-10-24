import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  formatRupiah,
  fromHex,
  guessRecord,
  HISTORY_RECORDS,
  maskCardNumber,
  parseBalance,
  parseCardNumber,
  PROPRIETARY_READS,
  readHistoryRecord,
  readOnlyRefusal,
  SELECT_EMONEY,
  toHex,
} from './apdu';

// No real card data here: every card number and balance below is invented for the test.

describe('the read-only allowlist', () => {
  it('admits exactly the four commands the diagnostic sends', () => {
    for (const { command } of COMMANDS) {
      expect(readOnlyRefusal(fromHex(command))).toBeNull();
    }
    expect(COMMANDS).toHaveLength(4);
    expect(COMMANDS.map((entry) => entry.command)).toEqual([
      SELECT_EMONEY,
      PROPRIETARY_READS.balance,
      PROPRIETARY_READS.cardNumber,
      PROPRIETARY_READS.cardAttribute,
    ]);
  });

  it('refuses every write, update, debit, top-up and authenticate command', () => {
    const forbidden = [
      '00D6000004DEADBEEF', // UPDATE BINARY
      '00DC01041001020304', // UPDATE RECORD
      '00D0000004CAFEBABE', // WRITE BINARY
      '0020000008AABBCCDDEEFF0011', // VERIFY (a PIN)
      '0082000010' + '00'.repeat(16), // EXTERNAL AUTHENTICATE
      '8050000008' + '00'.repeat(8), // a proprietary purse command (debit/top-up live here)
      '00B5000005', // the balance INS but a different Le — not the exact admitted shape
      '00A40400080000000000000002', // SELECT a different AID
    ];
    for (const hex of forbidden) {
      expect(readOnlyRefusal(fromHex(hex))).not.toBeNull();
    }
  });

  it('refuses a command that is a prefix or an extension of an allowed one', () => {
    expect(readOnlyRefusal(fromHex('00B500000A00'))).not.toBeNull();
    expect(readOnlyRefusal(fromHex('00B50000'))).not.toBeNull();
  });

  it('admits the one READ RECORD shape (INS B2, P2 0C) for every history record, and nothing wider', () => {
    for (const record of HISTORY_RECORDS) {
      expect(readOnlyRefusal(fromHex(readHistoryRecord(record)))).toBeNull();
    }
    expect(HISTORY_RECORDS).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    // The record read is 00 B2 nn 0C 00 only — no other P2 (so no other SFI or record mode), and no data field.
    expect(readOnlyRefusal(fromHex('00B2010400'))).not.toBeNull(); // P2 04: a different SFI's current file
    expect(readOnlyRefusal(fromHex('00B2000C00'))).toBeNull(); // record 0 still matches the shape
    expect(readOnlyRefusal(fromHex('00B201050102030405'))).not.toBeNull(); // READ RECORD carrying data
    expect(readOnlyRefusal(fromHex('00B001000C00'))).not.toBeNull(); // READ BINARY, not RECORD
  });
});

describe('the best-effort record guess', () => {
  it('points at a BCD date with time', () => {
    // 26 10 25 14 30 05 = 2026-10-25 14:30:05; the rest is an invented amount and padding.
    const guesses = guessRecord('261025143005' + '00030D40' + '01');
    expect(guesses.some((g) => g.includes('2026-10-25 14:30:05'))).toBe(true);
    expect(guesses[guesses.length - 1]).toMatch(/type flag/);
  });

  it('points at a four-byte amount in both endiannesses', () => {
    // 0x00030D40 = 200_000; little-endian is 40 0D 03 00.
    const guesses = guessRecord('00030D40');
    expect(guesses.some((g) => /amount\? \(big-endian\).*200\.000/.test(g.replace(/ /g, ' ')))).toBe(true);
  });

  it('says nothing for all-zero or all-ff records', () => {
    expect(guessRecord('00000000')).toEqual([]);
    expect(guessRecord('FFFFFFFF')).toEqual([]);
  });
});

describe('hex helpers', () => {
  it('round-trips bytes through hex, ignoring spacing and case', () => {
    expect(toHex(fromHex('00 a4 04'))).toBe('00A404');
    expect([...fromHex('DEADBEEF')]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('throws on anything that is not whole bytes of hex', () => {
    expect(() => fromHex('ABC')).toThrow();
    expect(() => fromHex('ZZ')).toThrow();
  });
});

describe('parsing the card answers', () => {
  it('reads the balance as little-endian rupiah', () => {
    // 0x0001E240 = 123_456; little-endian bytes are 40 E2 01 00, then card data the diagnostic ignores.
    expect(parseBalance({ data: '40E20100AABBCCDDEEFF', sw: '9000' })).toBe(123_456);
    expect(parseBalance({ data: '00000000', sw: '9000' })).toBe(0);
  });

  it('gives no balance when the card did not answer 9000 or sent too little', () => {
    expect(parseBalance({ data: '40E20100', sw: '6A82' })).toBeNull();
    expect(parseBalance({ data: '40E2', sw: '9000' })).toBeNull();
  });

  it('reads the card number from the first eight bytes and keeps it only when all digits', () => {
    expect(parseCardNumber({ data: '6032980012345670' + 'AABBCCDD', sw: '9000' })).toBe('6032980012345670');
    expect(parseCardNumber({ data: 'AB32980012345670' + '0000', sw: '9000' })).toBeNull();
    expect(parseCardNumber({ data: '6032980012345670', sw: '6A82' })).toBeNull();
  });

  it('masks all but the last four digits, in groups of four', () => {
    expect(maskCardNumber('6032980012345670')).toBe('•••• •••• •••• 5670');
  });

  it('formats a whole-rupiah figure', () => {
    expect(formatRupiah(123_456).replace(/ /g, ' ')).toMatch(/^Rp\s?123\.456$/);
  });
});
