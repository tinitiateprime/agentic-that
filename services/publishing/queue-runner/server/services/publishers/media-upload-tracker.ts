// Watches the file transfer itself, so a browser is never closed while an app
// is still receiving a video. An app can say "posted" or "processing" on screen
// long before the last bytes have left this computer.

import type { Page, Request } from "playwright-core";

export type UploadRequestMatcher = (method: string, url: string) => boolean;

const isSendingData = (method: string) => /^(?:POST|PUT)$/i.test(method);

/** YouTube Studio sends video bytes to upload.youtube.com. */
export const isYouTubeMediaUpload: UploadRequestMatcher = (method, url) =>
  isSendingData(method) && /^https:\/\/upload\.youtube\.com\//i.test(url);

/** Facebook sends video bytes to its upload hosts (vupload-edge, rupload, upload). */
export const isFacebookMediaUpload: UploadRequestMatcher = (method, url) =>
  isSendingData(method)
  && (/^https:\/\/[a-z0-9.-]*upload[a-z0-9-]*\.facebook\.com\//i.test(url) || /^https:\/\/[a-z0-9.-]*facebook\.com\/ajax\/video\/upload/i.test(url));

export type MediaUploadSnapshot = {
  started: number;
  inFlight: number;
  failed: number;
  lastActivityAt: number;
  lastRequestFailed: boolean;
};

export type MediaUploadTracker = {
  snapshot: () => MediaUploadSnapshot;
  dispose: () => void;
};

export function trackMediaUpload(page: Page, matches: UploadRequestMatcher): MediaUploadTracker {
  const active = new Set<Request>();
  let started = 0;
  let failed = 0;
  let lastActivityAt = 0;
  let lastRequestFailed = false;

  const onRequest = (request: Request) => {
    if (!matches(request.method(), request.url())) return;
    active.add(request);
    started += 1;
    lastActivityAt = Date.now();
  };
  const onFinished = (request: Request) => {
    if (!active.delete(request)) return;
    lastActivityAt = Date.now();
    lastRequestFailed = false;
  };
  const onFailed = (request: Request) => {
    if (!active.delete(request)) return;
    failed += 1;
    lastActivityAt = Date.now();
    lastRequestFailed = true;
  };

  page.on("request", onRequest);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  return {
    snapshot: () => ({ started, inFlight: active.size, failed, lastActivityAt, lastRequestFailed }),
    dispose: () => {
      page.off("request", onRequest);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
    },
  };
}

/** Chunked uploads pause between pieces, so "finished" needs a quiet moment. */
export function mediaUploadState(snapshot: MediaUploadSnapshot, now: number, quietMs: number) {
  if (snapshot.inFlight > 0) return "sending" as const;
  if (!snapshot.started) return "not_seen" as const;
  if (now - snapshot.lastActivityAt < quietMs) return "settling" as const;
  return snapshot.lastRequestFailed ? "failed" as const : "finished" as const;
}

/** Long enough for a slow connection (0.5 Mbps), and never under 15 minutes. */
export function mediaUploadTimeoutMs(sizeBytes: number) {
  const atHalfMegabit = (Math.max(0, sizeBytes) * 8 * 1000) / 500_000;
  return Math.max(15 * 60_000, Math.min(2 * 60 * 60_000, atHalfMegabit + 5 * 60_000));
}

export async function waitForMediaUploadFinished(page: Page, tracker: MediaUploadTracker, options: {
  app: string;
  sizeBytes: number;
  quietMs?: number;
  notSeenGraceMs?: number;
  timeoutMs?: number;
}) {
  const quietMs = options.quietMs ?? 10_000;
  const notSeenGraceMs = options.notSeenGraceMs ?? 20_000;
  const startedWaitingAt = Date.now();
  const deadline = startedWaitingAt + (options.timeoutMs ?? mediaUploadTimeoutMs(options.sizeBytes));
  let announced = false;

  while (Date.now() < deadline) {
    const state = mediaUploadState(tracker.snapshot(), Date.now(), quietMs);
    if (state === "finished") {
      console.log(`${options.app} received the whole video file.`);
      return;
    }
    if (state === "failed") throw new Error(`${options.app}'s video upload stopped before the whole file was sent. Check ${options.app} before retrying.`);
    if (state === "not_seen" && Date.now() - startedWaitingAt >= notSeenGraceMs) {
      console.warn(`The ${options.app} file transfer could not be observed; relying on ${options.app}'s on-screen confirmation.`);
      return;
    }
    if (state === "sending" && !announced) {
      announced = true;
      console.log(`${options.app} is still receiving the video. Keeping the browser open.`);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`${options.app} did not finish receiving the video in time. Check ${options.app} before retrying.`);
}
