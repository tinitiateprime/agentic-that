// Sends a large file in pieces without stopping for the server after each batch.
// Pieces keep uploading while earlier ones are confirmed in the background, staying
// inside the server's rule: nothing more than eight pieces past the confirmed point.

export type UploadPart = { index: number; offset: number; byteSize: number };

const MAX_PARTS_AHEAD = 8;
const MAX_PARTS_PER_REQUEST = 8;

export async function uploadPartsInPipeline<Signed>({
  parts,
  startOffset,
  chunkSize,
  concurrency = 6,
  authorize,
  upload,
  confirm,
  onProgress,
}: {
  parts: UploadPart[];
  startOffset: number;
  chunkSize: number;
  concurrency?: number;
  /** Permission to send these pieces, in the same order. */
  authorize: (batch: UploadPart[]) => Promise<Signed[]>;
  upload: (part: UploadPart, signed: Signed, onLoaded: (loaded: number) => void) => Promise<void>;
  /** Records finished pieces; returns the new confirmed offset. */
  confirm: (batch: UploadPart[]) => Promise<number>;
  onProgress?: (uploadedBytes: number) => void;
}) {
  let confirmedOffset = startOffset;
  let confirmedCount = 0;
  let nextPart = 0;
  let confirming = false;
  let failure: unknown = null;
  let failed = false;
  const sent = new Set<number>();
  const loaded = new Map<number, number>();
  const signedParts = new Map<number, Promise<Signed>>();
  let waiters: Array<() => void> = [];

  const wake = () => {
    const ready = waiters;
    waiters = [];
    ready.forEach((resolve) => resolve());
  };
  const changed = () => new Promise<void>((resolve) => waiters.push(resolve));
  const fail = (error: unknown) => {
    if (!failed) { failed = true; failure = error; }
    wake();
  };
  const inWindow = (part: UploadPart) => part.offset < confirmedOffset + MAX_PARTS_AHEAD * chunkSize;
  const report = () => {
    let total = startOffset;
    for (const value of loaded.values()) total += value;
    onProgress?.(total);
  };

  const signedFor = (position: number) => {
    const part = parts[position];
    const existing = signedParts.get(part.index);
    if (existing) return existing;
    // Ask for the next few pieces together, so most uploads start without waiting.
    const batch: UploadPart[] = [];
    for (let at = position; at < parts.length && batch.length < MAX_PARTS_PER_REQUEST; at += 1) {
      if (signedParts.has(parts[at].index) || !inWindow(parts[at])) break;
      batch.push(parts[at]);
    }
    const request = authorize(batch);
    batch.forEach((entry, offset) => signedParts.set(entry.index, request.then((signed) => {
      if (!signed[offset]) throw new Error("The server returned an invalid private media upload batch.");
      return signed[offset];
    })));
    return signedParts.get(part.index)!;
  };

  const confirmFinished = async () => {
    if (confirming) return;
    confirming = true;
    try {
      while (!failed) {
        const batch: UploadPart[] = [];
        while (batch.length < MAX_PARTS_PER_REQUEST && confirmedCount + batch.length < parts.length && sent.has(parts[confirmedCount + batch.length].index)) {
          batch.push(parts[confirmedCount + batch.length]);
        }
        if (!batch.length) break;
        const offset = await confirm(batch);
        if (!Number.isInteger(offset) || offset <= confirmedOffset) throw new Error("The server returned an invalid direct upload offset.");
        confirmedOffset = offset;
        confirmedCount += batch.length;
        wake();
      }
    } catch (error) {
      fail(error);
    } finally {
      confirming = false;
      wake();
    }
  };

  const worker = async () => {
    while (!failed && nextPart < parts.length) {
      if (!inWindow(parts[nextPart])) {
        await changed();
        continue;
      }
      const position = nextPart;
      nextPart += 1;
      const part = parts[position];
      try {
        const signed = await signedFor(position);
        await upload(part, signed, (value) => {
          loaded.set(part.index, value);
          report();
        });
        loaded.set(part.index, part.byteSize);
        report();
        sent.add(part.index);
        void confirmFinished();
      } catch (error) {
        fail(error);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, parts.length)) }, worker));
  while (!failed && confirmedCount < parts.length) {
    void confirmFinished();
    await changed();
  }
  if (failed) throw failure;
  return confirmedOffset;
}
