import {
  initializeDatabaseDocument,
  mutateDatabaseDocument,
  readDatabaseDocument,
} from "../../../lib/database-document-store.js";

const COMPANION_DOCUMENT_KEY = "platform.workspace-companions.v1";
const MAX_LABEL_LENGTH = 80;

function companionDocument(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.companions)) {
    return { version: 1, companions: [] };
  }
  return { version: 1, companions: value.companions };
}

async function initializeCompanions() {
  await initializeDatabaseDocument(COMPANION_DOCUMENT_KEY, { version: 1, companions: [] });
}

function normalizeOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Enter the Companion URL.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid Companion URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("The Companion URL must start with http:// or https://.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Enter only the Companion origin, for example https://companion.company.com.");
  }
  return url.origin;
}

function publicCompanion(companion) {
  if (!companion) return null;
  return {
    workspaceId: companion.workspaceId,
    origin: companion.origin,
    label: companion.label,
    companionInstanceId: companion.companionInstanceId || "",
    registeredByUserId: companion.registeredByUserId || "",
    updatedAt: companion.updatedAt,
  };
}

export async function getWorkspaceCompanion(workspaceId) {
  await initializeCompanions();
  const document = companionDocument(await readDatabaseDocument(COMPANION_DOCUMENT_KEY));
  return publicCompanion(document.companions.find((item) => item.workspaceId === workspaceId));
}

export async function registerWorkspaceCompanion(principal, input) {
  const origin = normalizeOrigin(input?.origin);
  const label = String(input?.label || "Workspace Companion").trim().slice(0, MAX_LABEL_LENGTH) || "Workspace Companion";
  const companionInstanceId = String(input?.companionInstanceId || "").trim().slice(0, 120);
  await initializeCompanions();
  return mutateDatabaseDocument(
    COMPANION_DOCUMENT_KEY,
    { version: 1, companions: [] },
    async (value) => {
      const document = companionDocument(value);
      const now = new Date().toISOString();
      const next = {
        workspaceId: principal.workspaceId,
        origin,
        label,
        companionInstanceId,
        registeredByUserId: principal.userId,
        updatedAt: now,
      };
      const index = document.companions.findIndex((item) => item.workspaceId === principal.workspaceId);
      if (index >= 0) document.companions[index] = next;
      else document.companions.push(next);
      return { document, result: publicCompanion(next) };
    }
  );
}

export async function removeWorkspaceCompanion(principal) {
  await initializeCompanions();
  return mutateDatabaseDocument(
    COMPANION_DOCUMENT_KEY,
    { version: 1, companions: [] },
    async (value) => {
      const document = companionDocument(value);
      const before = document.companions.length;
      document.companions = document.companions.filter((item) => item.workspaceId !== principal.workspaceId);
      return { document, result: { ok: true, removed: before !== document.companions.length } };
    }
  );
}
