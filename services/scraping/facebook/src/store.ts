import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
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
  status: "pending" | "running" | "complete" | "failed";
  input: FacebookJobInput;
  createdAt: string;
  updatedAt: string;
  runId?: string;
  error?: string;
};

type RunsDatabase = { version: 1; runs: FacebookRun[] };
type JobsDatabase = { version: 1; jobs: FacebookJob[] };

const emptyRuns = (): RunsDatabase => ({ version: 1, runs: [] });
const emptyJobs = (): JobsDatabase => ({ version: 1, jobs: [] });
let runMutation = Promise.resolve();
let jobMutation = Promise.resolve();

const useNetlifyBlobs = () => (
  process.env.DATA_STORE === "netlify-blobs"
  || process.env.NETLIFY === "true"
  || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);

function validRun(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const run = value as Partial<FacebookRun>;
  if (!run.id || !run.createdAt || !run.requestedQuery || !Array.isArray(run.results)) return null;
  return run as FacebookRun;
}

function validJob(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const job = value as Partial<FacebookJob>;
  if (!job.id || !job.input || !job.createdAt || !job.updatedAt) return null;
  if (!["pending", "running", "complete", "failed"].includes(String(job.status))) return null;
  return job as FacebookJob;
}

export class FacebookRunStore {
  private readonly runsFile = path.join(facebookServiceInfo.dataDir, "runs.json");
  private readonly jobsFile = path.join(facebookServiceInfo.dataDir, "jobs.json");
  private readonly blobs = useNetlifyBlobs();

  async listRuns() {
    if (this.blobs) {
      const store = getStore("facebook-scraper");
      const listed = await store.list({ prefix: "runs/" });
      const runs = await Promise.all(listed.blobs.map(async ({ key }) => validRun(await store.get(key, { type: "json", consistency: "strong" }))));
      return runs.filter((run): run is FacebookRun => Boolean(run)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
    }
    return (await this.readRuns()).runs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listQueries() {
    const seen = new Set<string>();
    for (const run of await this.listRuns()) {
      seen.add(run.requestedQuery);
      if (seen.size >= 12) break;
    }
    return [...seen];
  }

  async getRun(id: string) {
    if (this.blobs) return validRun(await getStore("facebook-scraper").get(`runs/${id}`, { type: "json", consistency: "strong" }));
    return (await this.listRuns()).find(run => run.id === id) || null;
  }

  async saveRun(input: Omit<FacebookRun, "id" | "createdAt">) {
    const run: FacebookRun = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    if (this.blobs) {
      await getStore("facebook-scraper").setJSON(`runs/${run.id}`, run);
      return run;
    }
    return this.mutateRuns(database => {
      database.runs = [run, ...database.runs].slice(0, 50);
      return run;
    });
  }

  async createJob(input: FacebookJobInput) {
    const timestamp = new Date().toISOString();
    const job: FacebookJob = { id: randomUUID(), status: "pending", input, createdAt: timestamp, updatedAt: timestamp };
    if (this.blobs) {
      await getStore("facebook-scraper").setJSON(`jobs/${job.id}`, job);
      return job;
    }
    return this.mutateJobs(database => {
      database.jobs = [job, ...database.jobs].slice(0, 100);
      return job;
    });
  }

  async getJob(id: string) {
    if (this.blobs) return validJob(await getStore("facebook-scraper").get(`jobs/${id}`, { type: "json", consistency: "strong" }));
    return (await this.readJobs()).jobs.find(job => job.id === id) || null;
  }

  async updateJob(id: string, updates: Partial<Omit<FacebookJob, "id" | "input" | "createdAt">>) {
    if (this.blobs) {
      const current = await this.getJob(id);
      if (!current) return null;
      const job: FacebookJob = { ...current, ...updates, updatedAt: new Date().toISOString() };
      await getStore("facebook-scraper").setJSON(`jobs/${id}`, job);
      return job;
    }
    return this.mutateJobs(database => {
      const index = database.jobs.findIndex(job => job.id === id);
      if (index === -1) return null;
      database.jobs[index] = { ...database.jobs[index], ...updates, updatedAt: new Date().toISOString() };
      return database.jobs[index];
    });
  }

  private async readRuns(): Promise<RunsDatabase> {
    try {
      const value = JSON.parse(await readFile(this.runsFile, "utf8")) as Partial<RunsDatabase>;
      return { version: 1, runs: Array.isArray(value.runs) ? value.runs : [] };
    } catch { return emptyRuns(); }
  }

  private async writeRuns(database: RunsDatabase) {
    await mkdir(path.dirname(this.runsFile), { recursive: true });
    await writeFile(this.runsFile, JSON.stringify(database, null, 2), "utf8");
  }

  private async mutateRuns<T>(mutator: (database: RunsDatabase) => T | Promise<T>) {
    const operation = runMutation.then(async () => {
      const database = await this.readRuns();
      const result = await mutator(database);
      await this.writeRuns(database);
      return result;
    });
    runMutation = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async readJobs(): Promise<JobsDatabase> {
    try {
      const value = JSON.parse(await readFile(this.jobsFile, "utf8")) as Partial<JobsDatabase>;
      return { version: 1, jobs: Array.isArray(value.jobs) ? value.jobs : [] };
    } catch { return emptyJobs(); }
  }

  private async writeJobs(database: JobsDatabase) {
    await mkdir(path.dirname(this.jobsFile), { recursive: true });
    await writeFile(this.jobsFile, JSON.stringify(database, null, 2), "utf8");
  }

  private async mutateJobs<T>(mutator: (database: JobsDatabase) => T | Promise<T>) {
    const operation = jobMutation.then(async () => {
      const database = await this.readJobs();
      const result = await mutator(database);
      await this.writeJobs(database);
      return result;
    });
    jobMutation = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
