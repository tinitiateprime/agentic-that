import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
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
  status: "pending" | "running" | "complete" | "failed";
  input: InstagramJobInput;
  createdAt: string;
  updatedAt: string;
  runId?: string;
  error?: string;
};

type RunsDatabase = {
  version: 1;
  runs: InstagramRun[];
};

type JobsDatabase = {
  version: 1;
  jobs: InstagramJob[];
};

const emptyDatabase = (): RunsDatabase => ({ version: 1, runs: [] });
const emptyJobsDatabase = (): JobsDatabase => ({ version: 1, jobs: [] });
export const DEFAULT_INSTAGRAM_CACHE_FALLBACK_MAX_AGE_MS = 6 * 60 * 60_000;
let localRunMutation = Promise.resolve();
let localJobMutation = Promise.resolve();
const shouldUseNetlifyBlobs = () => (
  process.env.DATA_STORE === "netlify-blobs" ||
  process.env.NETLIFY === "true" ||
  Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);

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

export class InstagramRunStore {
  private readonly dataFile = path.join(instagramServiceInfo.dataDir, "runs.json");
  private readonly jobsFile = path.join(instagramServiceInfo.dataDir, "jobs.json");
  private readonly useBlobs = shouldUseNetlifyBlobs();

  constructor(private readonly workspaceId: string) {
    if (!workspaceId) throw new Error("InstagramRunStore requires a workspace ID.");
  }

  private belongsToWorkspace(value: { workspaceId?: string }) {
    return value.workspaceId === this.workspaceId;
  }

  async listRuns() {
    if (this.useBlobs) {
      const store = getStore("instagram-scraper");
      const listed = await store.list({ prefix: "runs/" });
      const runs = await Promise.all(listed.blobs.map(async ({ key }) => {
        const value = await store.get(key, { type: "json", consistency: "strong" });
        return coerceRun(value);
      }));
      if (runs.some(Boolean)) {
        return runs
          .filter((run): run is InstagramRun => run !== null && this.belongsToWorkspace(run))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 50);
      }
    }
    const database = await this.readDatabase();
    return database.runs.filter((run) => this.belongsToWorkspace(run)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listKeywords() {
    const seen = new Set<string>();
    for (const run of await this.listRuns()) {
      seen.add(run.requestedQuery);
      if (seen.size >= 12) break;
    }
    return [...seen];
  }

  async getRun(id: string) {
    if (this.useBlobs) {
      const value = await getStore("instagram-scraper").get(`runs/${id}`, {
        type: "json",
        consistency: "strong"
      });
      const run = coerceRun(value);
      if (run && this.belongsToWorkspace(run)) return run;
    }
    return (await this.listRuns()).find((run) => run.id === id) || null;
  }

  async saveRun(input: Omit<InstagramRun, "id" | "workspaceId" | "createdAt">) {
    const run: InstagramRun = {
      ...input,
      id: randomUUID(),
      workspaceId: this.workspaceId,
      createdAt: new Date().toISOString()
    };
    if (this.useBlobs) {
      await getStore("instagram-scraper").setJSON(`runs/${run.id}`, run);
      return run;
    }
    return this.mutateLocalRuns((database) => {
      database.runs = [run, ...database.runs].slice(0, 50);
      return run;
    });
  }

  async createJob(input: InstagramJobInput) {
    const timestamp = new Date().toISOString();
    const job: InstagramJob = {
      id: randomUUID(),
      workspaceId: this.workspaceId,
      status: "pending",
      input,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (this.useBlobs) {
      await getStore("instagram-scraper").setJSON(`jobs/${job.id}`, job);
      return job;
    }
    return this.mutateLocalJobs((database) => {
      database.jobs = [job, ...database.jobs].slice(0, 100);
      return job;
    });
  }

  async getJob(id: string) {
    if (this.useBlobs) {
      const value = await getStore("instagram-scraper").get(`jobs/${id}`, {
        type: "json",
        consistency: "strong"
      });
      const job = coerceJob(value);
      return job && this.belongsToWorkspace(job) ? job : null;
    }
    return (await this.readJobsDatabase()).jobs.find((job) => job.id === id && this.belongsToWorkspace(job)) || null;
  }

  async updateJob(id: string, updates: Partial<Omit<InstagramJob, "id" | "input" | "createdAt">>) {
    if (this.useBlobs) {
      const current = await this.getJob(id);
      if (!current) return null;
      const job: InstagramJob = { ...current, ...updates, updatedAt: new Date().toISOString() };
      await getStore("instagram-scraper").setJSON(`jobs/${id}`, job);
      return job;
    }
    return this.mutateLocalJobs((database) => {
      const index = database.jobs.findIndex((job) => job.id === id && this.belongsToWorkspace(job));
      if (index === -1) return null;
      database.jobs[index] = {
        ...database.jobs[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      return database.jobs[index];
    });
  }

  private async readDatabase(): Promise<RunsDatabase> {
    if (this.useBlobs) {
      const store = getStore("instagram-scraper");
      const value = await store.get("runs", { type: "json", consistency: "strong" });
      return coerceDatabase(value);
    }

    try {
      return coerceDatabase(JSON.parse(await readFile(this.dataFile, "utf8")));
    } catch {
      return emptyDatabase();
    }
  }

  private async writeDatabase(database: RunsDatabase) {
    if (this.useBlobs) {
      const store = getStore("instagram-scraper");
      await store.setJSON("runs", database);
      return;
    }

    await mkdir(path.dirname(this.dataFile), { recursive: true });
    await writeFile(this.dataFile, JSON.stringify(database, null, 2), "utf8");
  }

  private async mutateLocalRuns<T>(mutator: (database: RunsDatabase) => T | Promise<T>) {
    const operation = localRunMutation.then(async () => {
      const database = await this.readDatabase();
      const result = await mutator(database);
      await this.writeDatabase(database);
      return result;
    });
    localRunMutation = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async readJobsDatabase(): Promise<JobsDatabase> {
    try {
      return coerceJobsDatabase(JSON.parse(await readFile(this.jobsFile, "utf8")));
    } catch {
      return emptyJobsDatabase();
    }
  }

  private async writeJobsDatabase(database: JobsDatabase) {
    await mkdir(path.dirname(this.jobsFile), { recursive: true });
    await writeFile(this.jobsFile, JSON.stringify(database, null, 2), "utf8");
  }

  private async mutateLocalJobs<T>(mutator: (database: JobsDatabase) => T | Promise<T>) {
    const operation = localJobMutation.then(async () => {
      const database = await this.readJobsDatabase();
      const result = await mutator(database);
      await this.writeJobsDatabase(database);
      return result;
    });
    localJobMutation = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function coerceDatabase(value: unknown): RunsDatabase {
  if (!value || typeof value !== "object") return emptyDatabase();
  const input = value as Partial<RunsDatabase>;
  return {
    version: 1,
    runs: Array.isArray(input.runs) ? input.runs as InstagramRun[] : []
  };
}

function coerceRun(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const run = value as Partial<InstagramRun>;
  if (!run.id || !run.createdAt || !run.requestedQuery || !Array.isArray(run.results)) return null;
  return run as InstagramRun;
}

function coerceJobsDatabase(value: unknown): JobsDatabase {
  if (!value || typeof value !== "object") return emptyJobsDatabase();
  const input = value as Partial<JobsDatabase>;
  return {
    version: 1,
    jobs: Array.isArray(input.jobs) ? input.jobs as InstagramJob[] : []
  };
}

function coerceJob(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const job = value as Partial<InstagramJob>;
  if (!job.id || !job.input || !job.createdAt || !job.updatedAt) return null;
  if (!["pending", "running", "complete", "failed"].includes(String(job.status))) return null;
  return job as InstagramJob;
}
