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
