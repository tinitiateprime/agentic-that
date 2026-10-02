import { WorkspaceScrapeStore } from "../../../../lib/workspace-scrape-store.ts";
import {
  facebookServiceInfo,
  type FacebookCollectionMode,
  type FacebookDiscoveryStatus,
  type FacebookInputMode,
  type FacebookPost,
  type FacebookProfileAnalysis,
  type FacebookProfileType,
  type FacebookRangeType,
  type FacebookScrapeDiagnostics,
} from "./scraper.ts";

export type FacebookJobInput = {
  inputMode: FacebookInputMode;
  profileType: FacebookProfileType;
  requestedQuery: string;
  maxResults: number;
  collectionMode: FacebookCollectionMode;
  recentDays: number;
  rangeType?: FacebookRangeType;
  rangeFrom?: string;
  rangeTo?: string;
  timezoneOffsetMinutes: number;
  skipComments?: boolean;
};

export type FacebookRun = {
  id: string;
  workspaceId: string;
  createdByUserId?: string;
  requestedQuery: string;
  query: string;
  inputMode: FacebookInputMode;
  profileType: FacebookProfileType;
  maxResults: number;
  collectionMode: FacebookCollectionMode;
  recentDays: number;
  rangeType?: FacebookRangeType;
  rangeFrom?: string;
  rangeTo?: string;
  createdAt: string;
  results: FacebookPost[];
  analysis?: FacebookProfileAnalysis;
  discoveryStatus: FacebookDiscoveryStatus;
  diagnostics: FacebookScrapeDiagnostics;
  dataSource: "live";
};

export type FacebookJob = {
  id: string;
  workspaceId: string;
  createdByUserId?: string;
  status: "pending" | "running" | "complete" | "failed";
  input: FacebookJobInput;
  createdAt: string;
  updatedAt: string;
  runId?: string;
  error?: string;
};

export class FacebookRunStore extends WorkspaceScrapeStore<FacebookRun, FacebookJob, FacebookJobInput> {
  constructor(workspaceId: string) { super("facebook-scraper", facebookServiceInfo.dataDir, workspaceId); }
  async listQueries() { return [...new Set((await this.listRuns()).map(run => run.requestedQuery))].slice(0, 12); }
}
