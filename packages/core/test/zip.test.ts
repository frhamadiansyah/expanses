import { describe, expect, it } from 'vitest';
import { unzipStore, zipStore } from '../src/index';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('the photo archive', () => {
  it('is a zip any computer can open', () => {
    const archive = zipStore([{ name: 'a.jpg', bytes: bytes('first') }]);
    expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('comes back as it went in', () => {
    const files = [
      { name: '0192f0.jpg', bytes: bytes('a photo of a receipt') },
      { name: '0192f1.png', bytes: new Uint8Array([0, 1, 2, 250, 255]) },
    ];
    expect(unzipStore(zipStore(files))).toEqual(files);
  });

  it('is empty when there are no photos', () => {
    expect(unzipStore(zipStore([]))).toEqual([]);
  });

  /*
   * The CRC32 table is the part most likely to be written wrong, and a wrong one round-trips perfectly through our
   * own reader — so the round trip above cannot catch it. These are the values every zip tool computes; the second
   * is the standard CRC32 check value for "123456789", which is what a table is verified against.
   */
  it('writes the CRC every other zip tool will check', () => {
    const crcAt = (archive: Uint8Array, offset: number) =>
      new DataView(archive.buffer, archive.byteOffset).getUint32(offset, true);
    // The local file header: PK\3\4, version, flags, method, time, date, then the CRC at byte 14.
    expect(crcAt(zipStore([{ name: 'a.txt', bytes: bytes('123456789') }]), 14)).toBe(0xcbf43926);
    expect(crcAt(zipStore([{ name: 'a.txt', bytes: bytes('') }]), 14)).toBe(0);
    expect(crcAt(zipStore([{ name: 'a.txt', bytes: new Uint8Array([0]) }]), 14)).toBe(0xd202ef8d);
  });

  it('refuses an archive whose bytes do not match the CRC recorded for them', () => {
    const archive = zipStore([{ name: 'a.txt', bytes: bytes('123456789') }]);
    // The stored data starts at byte 35: a 30-byte local header plus the 5-byte name "a.txt".
    const tampered = new Uint8Array(archive);
    tampered[35] = tampered[35]! ^ 0xff;
    expect(() => unzipStore(tampered)).toThrow(/does not match/);
  });
});
