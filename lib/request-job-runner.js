import { randomUUID } from "node:crypto";
import { mutateDatabaseDocument } from "./database-document-store.js";

// Claim a short step atomically, run network work outside the transaction, and
// commit only if the lease is still ours. No work continues after the response.
export async function runRequestJobStep(key, ownerId, processStep, options = {}) {
  const mutate = options.mutate || mutateDatabaseDocument;
  const now = options.now || Date.now;
  const leaseId = randomUUID();
  const claim = await mutate(key, {}, document => {
    if (document.ownerId !== ownerId) throw Object.assign(new Error("Job not found."), { status: 404 });
    if (["complete", "failed"].includes(document.stage) || document.leaseUntil > now()) return { document, result: null };
    const next = { ...document, leaseId, leaseUntil: now() + 90_000 };
    return { document: next, result: structuredClone(next) };
  });
  if (!claim) return { advanced: false };
  let next;
  try { next = await processStep(claim); }
  catch (error) {
    await mutate(key, {}, document => ({ document: document.leaseId === leaseId ? { ...document, leaseId: null, leaseUntil: 0 } : document, result: undefined }));
    throw error;
  }
  return mutate(key, {}, document => {
    if (document.leaseId !== leaseId) return { document, result: { advanced: false } };
    return { document: { ...next, ownerId: document.ownerId, leaseId: null, leaseUntil: 0 }, result: { advanced: true, stage: next.stage } };
  });
}
