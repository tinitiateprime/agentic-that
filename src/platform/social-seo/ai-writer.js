// Asks the user's connected AI apps (through the Companion) to write a post
// for each app from a photo or video. Shared by Publishing's Create with AI
// page and the "Write with AI" button in the Create composer, so both run the
// same steps: offer the whole video first, and fall back to the speech and
// picture sheets for any AI that can't watch it.
import { generateWithCompanionAis, prepareMediaForAi, stageVideoForAi } from "./companion-ai";
import { runVideoFirst } from "./video-first";

// Uploading a long video to an AI app and having it watched can take a long time.
export const WHOLE_VIDEO_TIMEOUT_MS = 70 * 60 * 1000;

/** The apps the AI writes for. */
export const AI_PLATFORMS = ["instagram", "facebook", "linkedin", "youtube", "x", "reddit"];

/**
 * Turns one Companion event into a status change for that AI:
 * done (with results), failed or out of allowance (limit), or still working.
 */
export function aiStatusFromEvent(event) {
  if (event.ok === true) return { state: "done", results: event.results, complete: event.complete, raw: event.raw, ms: event.ms, live: "", watchedVideo: Boolean(event.watchedVideo) };
  if (event.ok === false) return { state: event.limit ? "limit" : "failed", message: event.message };
  return { state: event.state, step: event.step, detail: event.detail || "", live: event.live || "" };
}

/**
 * Runs the AIs `ids` on `media` (items from probeMediaFile, first one used for
 * video). `update(id, change)` receives every status change; `onNotice` gets a
 * note about the speech when there is one. Throws if the Companion connection
 * drops; per-AI failures arrive through `update`.
 */
export async function askCompanionAis({ media, ids, postDetails, labels = {}, update, onNotice }) {
  const showEvent = (event) => {
    if (event.provider) update(event.provider, aiStatusFromEvent(event));
  };
  // The speech and pictures are prepared once, for every AI that ends up needing them.
  const usingSpeech = new Set();
  let preparing = null;
  const askWithSpeech = async (providers) => {
    providers.forEach((id) => usingSpeech.add(id));
    try {
      preparing ??= prepareMediaForAi(media, (detail) => usingSpeech.forEach((id) => update(id, { state: "working", detail })));
      const prepared = await preparing;
      if (prepared.speechNote) onNotice?.(prepared.speechNote);
      await generateWithCompanionAis({
        ...postDetails,
        providers,
        images: prepared.images,
        mediaKind: prepared.mediaKind,
        durationSeconds: prepared.durationSeconds,
        transcript: prepared.transcript,
      }, showEvent);
    } catch (speechError) {
      providers.forEach((id) => update(id, { state: "failed", message: speechError.message }));
    }
  };
  const videoId = media[0]?.kind === "video" ? await stageVideoForAi(media[0], (detail) => ids.forEach((id) => update(id, { state: "working", detail }))) : null;
  if (videoId) {
    await runVideoFirst({
      ids,
      askWithVideo: (onEvent) => generateWithCompanionAis({ ...postDetails, providers: ids, images: [], videoId, mediaKind: "video", durationSeconds: media[0].durationSeconds }, onEvent, WHOLE_VIDEO_TIMEOUT_MS),
      askWithSpeech,
      onRefused: (id) => update(id, { state: "working", step: "opening", live: "", detail: `${labels[id] || id} can't watch this whole video, so it will use the speech and pictures instead.` }),
      onEvent: showEvent,
    });
  } else {
    await askWithSpeech(ids);
  }
}

// The brand and business details saved once on Create with AI (same keys), so
// the composer's "Write with AI" uses them too.
export function savedWritingDetails() {
  const read = (key) => { try { return window.localStorage.getItem(key) || ""; } catch { return ""; } };
  let business = { city: "", details: "" };
  try {
    const value = JSON.parse(read("agenticthat-social-seo-business") || "{}");
    business = { city: String(value.city || ""), details: String(value.details || "") };
  } catch { /* nothing saved */ }
  return { brandName: read("agenticthat-social-seo-brand").trim(), city: business.city.trim(), businessDetails: business.details.trim() };
}
