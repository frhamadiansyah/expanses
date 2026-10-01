import { type IdxSummary, readIdxSummary } from '@expanses/core';

/** The IDX page the owner downloads Ringkasan Saham from, opened in the system browser. */
export const IDX_SUMMARY_PAGE = 'https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-saham/';

/** Raw DEFLATE through the browser's own DecompressionStream (Safari 16.4+, so every iOS this app runs on). */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads the file the owner chose, on the device. */
export async function readIdxFile(file: Blob): Promise<IdxSummary> {
  return readIdxSummary(new Uint8Array(await file.arrayBuffer()), inflateRaw);
}

/** Base64 as the iOS sheet hands the caught download over, back to its bytes. */
export function base64Bytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Reads the file the iOS sheet caught from IDX's Unduh: the same parser a chosen file goes through. */
export async function readIdxBase64(base64: string): Promise<IdxSummary> {
  return readIdxSummary(base64Bytes(base64), inflateRaw);
}
