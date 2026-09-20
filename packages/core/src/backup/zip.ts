/**
 * A store-only (no compression) ZIP writer and reader, so a backup can carry receipt photos alongside the ledger
 * without pulling in a compression library. Every byte here is either a fixed ZIP field or a CRC32 of the file's
 * own bytes, so any ordinary zip tool can open what this writes, and this can read what any ordinary zip tool wrote
 * (as long as it too is stored, not deflated).
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** The standard reflected CRC32 table, built once at module load. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/** Builds a ZIP archive holding every file, stored (uncompressed) so it needs no compression library. */
export function zipStore(files: readonly ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const crc = crc32(file.bytes);
    const size = file.bytes.byteLength;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_HEADER_SIGNATURE, true);
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, 0, true); // flags
    local.setUint16(8, 0, true); // method: 0 = stored
    local.setUint16(10, 0, true); // mod time
    local.setUint16(12, 0, true); // mod date
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size
    local.setUint32(22, size, true); // uncompressed size
    local.setUint16(26, nameBytes.byteLength, true);
    local.setUint16(28, 0, true); // extra field length
    const localHeader = new Uint8Array(local.buffer);

    parts.push(localHeader, nameBytes, file.bytes);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, CENTRAL_HEADER_SIGNATURE, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed to extract
    central.setUint16(8, 0, true); // flags
    central.setUint16(10, 0, true); // method: 0 = stored
    central.setUint16(12, 0, true); // mod time
    central.setUint16(14, 0, true); // mod date
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true); // compressed size
    central.setUint32(24, size, true); // uncompressed size
    central.setUint16(28, nameBytes.byteLength, true);
    central.setUint16(30, 0, true); // extra field length
    central.setUint16(32, 0, true); // comment length
    central.setUint16(34, 0, true); // disk number start
    central.setUint16(36, 0, true); // internal attributes
    central.setUint32(38, 0, true); // external attributes
    central.setUint32(42, offset, true); // offset of local header
    const centralHeader = new Uint8Array(central.buffer);

    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.byteLength + nameBytes.byteLength + size;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const part of centralParts) centralSize += part.byteLength;

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  end.setUint16(4, 0, true); // disk number
  end.setUint16(6, 0, true); // disk with central directory
  end.setUint16(8, files.length, true); // entries on this disk
  end.setUint16(10, files.length, true); // total entries
  end.setUint32(12, centralSize, true);
  end.setUint32(16, centralStart, true);
  end.setUint16(20, 0, true); // comment length

  const totalSize = offset + centralSize + 22;
  const archive = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of [...parts, ...centralParts, new Uint8Array(end.buffer)]) {
    archive.set(part, cursor);
    cursor += part.byteLength;
  }
  return archive;
}

/** Reads back what `zipStore` wrote, refusing any entry whose bytes no longer match its recorded CRC. */
export function unzipStore(archive: Uint8Array): ZipEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const files: ZipEntry[] = [];
  let offset = 0;
  while (offset < archive.byteLength && view.getUint32(offset, true) === LOCAL_HEADER_SIGNATURE) {
    const crc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = new TextDecoder().decode(archive.subarray(nameStart, nameStart + nameLength));
    const bytes = archive.slice(dataStart, dataStart + size);

    const actual = crc32(bytes);
    if (actual !== crc) {
      throw new Error(`The archive is damaged: ${name} does not match the checksum recorded for it`);
    }

    files.push({ name, bytes });
    offset = dataStart + size;
  }

  return files;
}
