import assert from "node:assert/strict";
import test from "node:test";
import { GrowthAdvisorError, type AdvisorRequest } from "./growth-advisor.ts";
import {
  executeGrowthAdvisorJob,
  growthAdvisorJobPayload,
  type GrowthAdvisorJob,
  type GrowthAdvisorJobRepository
} from "./growth-advisor-jobs.ts";

const input: AdvisorRequest = {
  operation: "plan",
  report: {
    business_context: { business_type: "Cafe", goal: "Increase sales" },
    profiles: [{ username: "one" }, { username: "two" }]
  }
};

const plan = {
  executive_summary: "Test one clear offer.",
  verified_findings: [],
  business_opportunities: [],
  seven_day_plan: [],
  thirty_day_plan: [],
  questions_to_validate: [],
  assumptions: []
};

class MemoryJobStore implements GrowthAdvisorJobRepository {
  job: GrowthAdvisorJob;

  constructor() {
    const timestamp = new Date().toISOString();
    this.job = {
      id: "job-1",
      userId: "user-1",
      status: "pending",
      input,
      provider: "gemini",
      model: "gemini-3.6-flash",
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }

  async createJob() {
    return this.job;
  }

  async getJob(id: string) {
    return id === this.job.id ? this.job : null;
  }

  async updateJob(id: string, updates: Partial<GrowthAdvisorJob>) {
    if (id !== this.job.id) return null;
    this.job = { ...this.job, ...updates, updatedAt: new Date().toISOString() };
    return this.job;
  }
}

test("completes an AI job once and returns the stored result on repeat execution", async () => {
  const store = new MemoryJobStore();
  let calls = 0;
  const completed = await executeGrowthAdvisorJob("job-1", {
    store,
    apiKey: "server-only-key",
    requestAdvice: async (options) => {
      calls += 1;
      assert.equal(options.operation, "plan");
      assert.equal(options.model, "gemini-3.6-flash");
      return plan;
    }
  });

  assert.equal(completed?.status, "complete");
  assert.deepEqual(completed?.result, plan);
  assert.equal(calls, 1);
  const repeated = await executeGrowthAdvisorJob("job-1", {
    store,
    apiKey: "server-only-key",
    requestAdvice: async () => {
      calls += 1;
      return plan;
    }
  });
  assert.equal(repeated?.status, "complete");
  assert.equal(calls, 1);
});

test("retries one malformed Gemini response and then completes", async () => {
  const store = new MemoryJobStore();
  let calls = 0;
  let delays = 0;
  const completed = await executeGrowthAdvisorJob("job-1", {
    store,
    apiKey: "server-only-key",
    sleep: async () => { delays += 1; },
    requestAdvice: async () => {
      calls += 1;
      if (calls === 1) throw new GrowthAdvisorError("Invalid output", "INVALID_AI_RESPONSE", 502);
      return plan;
    }
  });

  assert.equal(completed?.status, "complete");
  assert.equal(calls, 2);
  assert.equal(delays, 1);
});

test("stores a terminal timeout error instead of leaving the job running", async () => {
  const store = new MemoryJobStore();
  const completed = await executeGrowthAdvisorJob("job-1", {
    store,
    apiKey: "server-only-key",
    timeoutMs: 5,
    requestAdvice: async (options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        reject(new DOMException("The request was aborted.", "AbortError"));
      }, { once: true });
    })
  });

  assert.equal(completed?.status, "failed");
  assert.equal(completed?.error?.code, "AI_TIMEOUT");
  assert.equal(completed?.error?.status, 504);
});

test("public job payload hides the user and benchmark input", () => {
  const store = new MemoryJobStore();
  const payload = growthAdvisorJobPayload(store.job);
  assert.equal(payload.job.id, "job-1");
  assert.equal("userId" in payload.job, false);
  assert.equal("input" in payload.job, false);
});
