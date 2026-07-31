// Netlify Blobs are only reachable when the Netlify runtime injects a blobs
// context (exposed as globalThis.netlifyBlobsContext or the NETLIFY_BLOBS_CONTEXT
// environment variable). Outside that runtime — for example a local
// `npm run dev` — the context is absent even when DATA_STORE="netlify-blobs" or
// NETLIFY="true" were copied from the production environment, so every blob
// call throws MissingBlobsEnvironmentError. Store modules use this to fall back
// to their local JSON (or database) backend instead of crashing at startup.
export function isNetlifyBlobsEnvironmentAvailable() {
  if (globalThis.netlifyBlobsContext) return true;
  return Boolean((process.env.NETLIFY_BLOBS_CONTEXT || "").trim());
}
