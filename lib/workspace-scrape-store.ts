import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { DurableDocumentStore } from "./durable-document-store.ts";

type RecordBase = { id: string; workspaceId: string; createdAt: string };
type JobBase<I> = RecordBase & { status: "pending" | "running" | "complete" | "failed"; input: I; updatedAt: string; createdByUserId?: string; error?: string };
type Records<T> = { version: 1; records: T[] };

export class WorkspaceScrapeStore<R extends RecordBase, J extends JobBase<I>, I> {
  private readonly runs: DurableDocumentStore<Records<R>>;
  private readonly jobs: DurableDocumentStore<Records<J>>;

  constructor(namespace: string, directory: string, private readonly workspaceId: string) {
    if (!workspaceId) throw new Error("Scraper storage requires a workspace ID.");
    const root = path.join(directory, "workspaces", createHash("sha256").update(workspaceId).digest("hex"));
    const empty = <T>(): Records<T> => ({ version: 1, records: [] });
    const coerce = <T extends RecordBase>(value: unknown): Records<T> => {
      const records = (value as Records<T> | null)?.records;
      return { version: 1, records: Array.isArray(records) ? records.filter(record => record?.id && record.workspaceId === workspaceId) : [] };
    };
    this.runs = new DurableDocumentStore(`${namespace}/workspaces/${workspaceId}/runs`, path.join(root, "runs.json"), empty<R>, coerce<R>);
    this.jobs = new DurableDocumentStore(`${namespace}/workspaces/${workspaceId}/jobs`, path.join(root, "jobs.json"), empty<J>, coerce<J>);
  }

  async listRuns() {
    return (await this.runs.read()).records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getRun(id: string) { return (await this.listRuns()).find(run => run.id === id) || null; }
  async saveRun(input: Omit<R, "id" | "workspaceId" | "createdAt">) {
    const run = { ...input, id: randomUUID(), workspaceId: this.workspaceId, createdAt: new Date().toISOString() } as R;
    return this.runs.mutate(document => { document.records = [run, ...document.records].slice(0, 50); return run; });
  }
  async createJob(input: I, createdByUserId?: string) {
    const timestamp = new Date().toISOString();
    const job = { id: randomUUID(), workspaceId: this.workspaceId, createdByUserId, status: "pending", input, createdAt: timestamp, updatedAt: timestamp } as J;
    return this.jobs.mutate(document => { document.records = [job, ...document.records].slice(0, 100); return job; });
  }
  async getJob(id: string) { return (await this.jobs.read()).records.find(job => job.id === id) || null; }
  async updateJob(id: string, updates: Partial<Omit<J, "id" | "input" | "createdAt">>) {
    return this.jobs.mutate(document => {
      const index = document.records.findIndex(job => job.id === id);
      if (index === -1) return null;
      document.records[index] = { ...document.records[index], ...updates, workspaceId: this.workspaceId, updatedAt: new Date().toISOString() };
      return document.records[index];
    });
  }
  async claimJob(id: string) {
    return this.jobs.mutate(document => {
      const job = document.records.find(item => item.id === id);
      if (!job || job.status !== "pending") return null;
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      delete job.error;
      return job;
    });
  }
}
