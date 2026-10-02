import { WorkspaceScrapeStore } from "../../../../lib/workspace-scrape-store.ts";
import {
  instagramServiceInfo,
  type InstagramDiscoveryStatus,
  type InstagramPost,
  type InstagramProfileAnalysis,
  type InstagramScrapeDiagnostics
} from "./scraper.ts";

export type InstagramRun = {
  id: string;
  workspaceId: string;
  createdByUserId?: string;
  query: string;
  requestedQuery: string;
  maxResults: number;
  collectionMode?: "latest" | "range" | "engagement";
  recentDays?: number;
  rangeType?: "date" | "month" | "year";
  rangeFrom?: string;
  rangeTo?: string;
  sortBy?: "recent" | "engagement";
  createdAt: string;
  results: InstagramPost[];
  analysis?: InstagramProfileAnalysis;
  discoveryStatus?: InstagramDiscoveryStatus;
  diagnostics?: InstagramScrapeDiagnostics;
  dataSource?: "live" | "recent_cache";
  sourceRunId?: string;
  sourceCreatedAt?: string;
};

export type InstagramJobInput = {
  requestedMode: string;
  requestedQuery: string;
  maxResults: number;
  collectionMode: "latest" | "range" | "engagement";
  recentDays: number;
  onlyPostsNewerThan?: string;
  autoExpandDays: boolean;
  maxAutoExpandDays: number;
  rangeType?: "date" | "month" | "year";
  rangeFrom?: string;
  rangeTo?: string;
  timezoneOffsetMinutes: number;
  sortBy: "recent" | "engagement";
};

export type InstagramJob = {
  id: string;
  workspaceId: string;
  createdByUserId?: string;
  status: "pending" | "running" | "complete" | "failed";
  input: InstagramJobInput;
  createdAt: string;
  updatedAt: string;
  runId?: string;
  error?: string;
};

export const DEFAULT_INSTAGRAM_CACHE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60_000;

export function selectRecentRunFallback(
  runs: InstagramRun[],
  input: InstagramJobInput,
  now = Date.now(),
  maxAgeMs = DEFAULT_INSTAGRAM_CACHE_FALLBACK_MAX_AGE_MS
) {
  if (input.collectionMode === "range" || maxAgeMs <= 0) return null;
  const requestedQuery = input.requestedQuery.trim().toLowerCase();
  const candidates = runs.filter((run) => {
    const createdAt = new Date(run.createdAt).getTime();
    const age = now - createdAt;
    if (!Number.isFinite(createdAt) || age < 0 || age > maxAgeMs) return false;
    if (run.requestedQuery.trim().toLowerCase() !== requestedQuery || !run.results.length) return false;
    if (run.dataSource === "recent_cache") return false;
    if (input.collectionMode === "engagement") {
      return run.collectionMode === "engagement" && Boolean(run.analysis);
    }
    return run.collectionMode === "latest" || run.collectionMode === "engagement";
  });
  return candidates.sort((a, b) => {
    const aSameMode = a.collectionMode === input.collectionMode ? 1 : 0;
    const bSameMode = b.collectionMode === input.collectionMode ? 1 : 0;
    return bSameMode - aSameMode || b.createdAt.localeCompare(a.createdAt);
  })[0] || null;
}

export class InstagramRunStore extends WorkspaceScrapeStore<InstagramRun, InstagramJob, InstagramJobInput> {
  constructor(workspaceId: string) { super("instagram-scraper", instagramServiceInfo.dataDir, workspaceId); }
  async listKeywords() { return [...new Set((await this.listRuns()).map(run => run.requestedQuery))].slice(0, 12); }
}
