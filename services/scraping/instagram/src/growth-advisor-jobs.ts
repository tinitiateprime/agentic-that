import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@netlify/blobs";
import {
  GrowthAdvisorError,
  growthAdvisorModel,
  requestGeminiGrowthAdvice,
  type AdvisorPlanResult,
  type AdvisorQuestionResult,
  type AdvisorRequest,
  type GeminiRequestOptions
} from "./growth-advisor.ts";

export type GrowthAdvisorJobStatus = "pending" | "running" | "complete" | "failed";
export type GrowthAdvisorJobResult = AdvisorPlanResult | AdvisorQuestionResult;

export type GrowthAdvisorJob = {
  id: string;
  userId: string;
  status: GrowthAdvisorJobStatus;
  input: AdvisorRequest;
  provider: "gemini";
  model: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: GrowthAdvisorJobResult;
  error?: {
    message: string;
    code: string;
    status: number;
  };
};

type JobsDatabase = {
  version: 1;
  jobs: GrowthAdvisorJob[];
};

export type GrowthAdvisorJobRepository = {
  createJob(userId: string, input: AdvisorRequest, model?: string): Promise<GrowthAdvisorJob>;
  getJob(id: string): Promise<GrowthAdvisorJob | null>;
  updateJob(
    id: string,
    updates: Partial<Omit<GrowthAdvisorJob, "id" | "userId" | "input" | "createdAt">>
  ): Promise<GrowthAdvisorJob | null>;
};

type ExecuteDependencies = {
  store?: GrowthAdvisorJobRepository;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  requestAdvice?: (options: GeminiRequestOptions) => Promise<GrowthAdvisorJobResult>;
  sleep?: (milliseconds: number) => Promise<void>;
};

const STORE_NAME = "instagram-growth-advisor";
const LOCAL_JOB_LIMIT = 100;
const RUN_LEASE_MS = 7 * 60_000;
export const GROWTH_ADVISOR_STALE_JOB_MS = 9 * 60_000;
const DEFAULT_BACKGROUND_TIMEOUT_MS = 180_000;
const emptyDatabase = (): JobsDatabase => ({ version: 1, jobs: [] });
let localMutation = Promise.resolve();

const shouldUseNetlifyBlobs = () => (
  process.env.DATA_STORE === "netlify-blobs" ||
  process.env.NETLIFY === "true" ||
  Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);

const configuredApiKey = () => (
  process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || ""
);

const configuredBackgroundTimeoutMs = () => {
  const value = Number(process.env.GEMINI_BACKGROUND_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 60_000
    ? Math.min(Math.round(value), 300_000)
    : DEFAULT_BACKGROUND_TIMEOUT_MS;
};

export class GrowthAdvisorJobStore implements GrowthAdvisorJobRepository {
  private readonly dataFile = path.join(
    process.cwd(),
    "services",
    "scraping",
    "instagram",
    "data",
    "growth-advisor-jobs.json"
  );
  private readonly useBlobs = shouldUseNetlifyBlobs();

  async createJob(userId: string, input: AdvisorRequest, model = growthAdvisorModel()) {
    const timestamp = new Date().toISOString();
    const job: GrowthAdvisorJob = {
      id: randomUUID(),
      userId,
      status: "pending",
      input,
      provider: "gemini",
      model,
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (this.useBlobs) {
      await getStore(STORE_NAME).setJSON(`jobs/${job.id}`, job);
      return job;
    }
    return this.mutateLocal((database) => {
      database.jobs = [job, ...database.jobs].slice(0, LOCAL_JOB_LIMIT);
      return job;
    });
  }

  async getJob(id: string) {
    if (this.useBlobs) {
      const value = await getStore(STORE_NAME).get(`jobs/${id}`, {
        type: "json",
        consistency: "strong"
      });
      return coerceJob(value);
    }
    return (await this.readLocal()).jobs.find((job) => job.id === id) || null;
  }

  async updateJob(
    id: string,
    updates: Partial<Omit<GrowthAdvisorJob, "id" | "userId" | "input" | "createdAt">>
  ) {
    if (this.useBlobs) {
      const current = await this.getJob(id);
      if (!current) return null;
      const job: GrowthAdvisorJob = { ...current, ...updates, updatedAt: new Date().toISOString() };
      await getStore(STORE_NAME).setJSON(`jobs/${id}`, job);
      return job;
    }
    return this.mutateLocal((database) => {
      const index = database.jobs.findIndex((job) => job.id === id);
      if (index === -1) return null;
      database.jobs[index] = {
        ...database.jobs[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      return database.jobs[index];
    });
  }

  private async readLocal(): Promise<JobsDatabase> {
    try {
      const value = JSON.parse(await readFile(this.dataFile, "utf8"));
      if (!value || typeof value !== "object") return emptyDatabase();
      return {
        version: 1,
        jobs: Array.isArray(value.jobs) ? value.jobs.map(coerceJob).filter(Boolean) as GrowthAdvisorJob[] : []
      };
    } catch {
      return emptyDatabase();
    }
  }

  private async writeLocal(database: JobsDatabase) {
    await mkdir(path.dirname(this.dataFile), { recursive: true });
    await writeFile(this.dataFile, JSON.stringify(database, null, 2), "utf8");
  }

  private async mutateLocal<T>(mutator: (database: JobsDatabase) => T | Promise<T>) {
    const operation = localMutation.then(async () => {
      const database = await this.readLocal();
      const result = await mutator(database);
      await this.writeLocal(database);
      return result;
    });
    localMutation = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

export function growthAdvisorJobPayload(job: GrowthAdvisorJob) {
  return {
    job: {
      id: job.id,
      status: job.status,
      provider: job.provider,
      model: job.model,
      attempts: job.attempts,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error
    },
    result: job.status === "complete" ? job.result : undefined
  };
}

export async function failStaleGrowthAdvisorJob(
  job: GrowthAdvisorJob,
  store: GrowthAdvisorJobRepository = new GrowthAdvisorJobStore()
) {
  if (job.status !== "running" || Date.now() - Date.parse(job.updatedAt) < GROWTH_ADVISOR_STALE_JOB_MS) {
    return job;
  }
  return await store.updateJob(job.id, {
    status: "failed",
    completedAt: new Date().toISOString(),
    error: {
      message: "AI analysis did not finish. Please generate the plan again.",
      code: "AI_JOB_STALLED",
      status: 504
    }
  }) || job;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const isRetryable = (error: unknown) => {
  if (error instanceof GrowthAdvisorError) {
    return ["AI_PROVIDER_ERROR", "EMPTY_AI_RESPONSE", "INVALID_AI_RESPONSE", "AI_OUTPUT_TRUNCATED"]
      .includes(error.code);
  }
  return error instanceof TypeError;
};

const jobFailure = (error: unknown) => {
  if (error instanceof Error && error.name === "AbortError") {
    return {
      message: "Gemini took too long to finish the analysis. Please generate the plan again.",
      code: "AI_TIMEOUT",
      status: 504
    };
  }
  if (error instanceof GrowthAdvisorError) {
    return { message: error.message, code: error.code, status: error.status };
  }
  return {
    message: "AI advice could not be generated right now.",
    code: "AI_ERROR",
    status: 500
  };
};

export async function executeGrowthAdvisorJob(id: string, dependencies: ExecuteDependencies = {}) {
  const store = dependencies.store || new GrowthAdvisorJobStore();
  const current = await store.getJob(id);
  if (!current) return null;
  if (current.status === "complete" || current.status === "failed") return current;
  if (current.status === "running" && Date.now() - Date.parse(current.updatedAt) < RUN_LEASE_MS) return current;

  const apiKey = dependencies.apiKey ?? configuredApiKey();
  if (!apiKey) {
    return store.updateJob(id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: {
        message: "AI is not configured yet. Add GEMINI_API_KEY to the server environment.",
        code: "AI_NOT_CONFIGURED",
        status: 503
      }
    });
  }

  const model = dependencies.model || current.model || growthAdvisorModel();
  const running = await store.updateJob(id, {
    status: "running",
    model,
    attempts: current.attempts + 1,
    startedAt: current.startedAt || new Date().toISOString(),
    error: undefined
  });
  if (!running) return null;

  const requestAdvice = dependencies.requestAdvice || requestGeminiGrowthAdvice;
  const sleep = dependencies.sleep || wait;
  const timeoutMs = dependencies.timeoutMs || configuredBackgroundTimeoutMs();

  try {
    let result: GrowthAdvisorJobResult | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        result = await requestAdvice({
          ...running.input,
          apiKey,
          model,
          signal: controller.signal,
          onTelemetry: (event) => console.info("Instagram growth advisor Gemini", {
            jobId: id,
            attempt: attempt + 1,
            ...event
          })
        });
        break;
      } catch (error) {
        if (attempt === 0 && isRetryable(error)) {
          console.warn("Instagram growth advisor retrying Gemini", {
            jobId: id,
            code: error instanceof GrowthAdvisorError ? error.code : error instanceof Error ? error.name : "UnknownError"
          });
          await sleep(1_500);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!result) throw new GrowthAdvisorError("AI did not return an answer.", "EMPTY_AI_RESPONSE", 502);
    return store.updateJob(id, {
      status: "complete",
      completedAt: new Date().toISOString(),
      result,
      error: undefined
    });
  } catch (error) {
    console.error("Instagram growth advisor job failed", { jobId: id, error });
    return store.updateJob(id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: jobFailure(error)
    });
  }
}

function coerceJob(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const job = value as Partial<GrowthAdvisorJob>;
  if (!job.id || !job.userId || !job.input || !job.createdAt || !job.updatedAt) return null;
  if (!["pending", "running", "complete", "failed"].includes(String(job.status))) return null;
  return job as GrowthAdvisorJob;
}
