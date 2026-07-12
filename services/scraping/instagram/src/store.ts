import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import { instagramServiceInfo, type InstagramPost } from "./scraper.ts";

export type InstagramRun = {
  id: string;
  query: string;
  requestedQuery: string;
  maxResults: number;
  recentDays: number;
  createdAt: string;
  results: InstagramPost[];
};

type RunsDatabase = {
  version: 1;
  runs: InstagramRun[];
};

const emptyDatabase = (): RunsDatabase => ({ version: 1, runs: [] });
const shouldUseNetlifyBlobs = () => (
  process.env.DATA_STORE === "netlify-blobs" ||
  process.env.NETLIFY === "true" ||
  Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);

export class InstagramRunStore {
  private readonly dataFile = path.join(instagramServiceInfo.dataDir, "runs.json");
  private readonly useBlobs = shouldUseNetlifyBlobs();

  async listRuns() {
    const database = await this.readDatabase();
    return database.runs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    return (await this.listRuns()).find((run) => run.id === id) || null;
  }

  async saveRun(input: Omit<InstagramRun, "id" | "createdAt">) {
    const run: InstagramRun = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    };
    const database = await this.readDatabase();
    database.runs = [run, ...database.runs].slice(0, 50);
    await this.writeDatabase(database);
    return run;
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
}

function coerceDatabase(value: unknown): RunsDatabase {
  if (!value || typeof value !== "object") return emptyDatabase();
  const input = value as Partial<RunsDatabase>;
  return {
    version: 1,
    runs: Array.isArray(input.runs) ? input.runs as InstagramRun[] : []
  };
}
