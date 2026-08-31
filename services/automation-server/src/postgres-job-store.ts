import {
  assertPublishingJobTransition,
  automationId,
  createAccountSchema,
  createPublishingJobSchema,
  createScrapingJobSchema,
  publishingJobStateSchema,
  resolveUncertainPublishingJobSchema,
  updateAccountSchema,
  type PublishingJobState,
  type SocialPlatform,
  type ScrapingJobState,
} from "./contracts.ts";
import type { AutomationFileStore } from "./profile-store.ts";
import type { AutomationPostgres } from "./postgres-database.ts";

type Queryable = Pick<AutomationPostgres, "unsafe">;

type AccountRow = {
  id: string;
  workspace_id: string;
  platform: SocialPlatform;
  display_name: string;
  status: string;
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type PublishingJobRow = {
  id: string;
  workspace_id: string;
  account_id: string;
  execution_mode: "DRY_RUN" | "LIVE";
  validation_stage: "LOCAL" | "INSTAGRAM_PREVIEW";
  live_authorized: boolean;
  platform?: SocialPlatform;
  state: PublishingJobState;
  scheduled_at: Date | string;
  original_timezone: string;
  caption: string;
  media: unknown;
  platform_options: unknown;
  idempotency_key: string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  fencing_token: string | number | null;
  attempt_count: number;
  platform_post_id: string | null;
  platform_post_url: string | null;
  error_code: string | null;
  error_message: string | null;
  progress_message: string | null;
  resolved_by: string | null;
  resolved_at: Date | string | null;
  resolution_note: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ScrapingJobRow = {
  id: string;
  workspace_id: string;
  platform: "instagram" | "facebook";
  input: unknown;
  idempotency_key: string;
  state: ScrapingJobState;
  result_key: string | null;
  scheduled_at: Date | string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  fencing_token: string | number | null;
  attempt_count: number;
  error_code: string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
};

function iso(value: Date | string | null) {
  return value === null ? null : new Date(value).toISOString();
}

function publicAccount(row: AccountRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    displayName: row.display_name,
    status: row.status,
    enabled: row.enabled,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function jsonValue(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

function publicJob(row: PublishingJobRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    executionMode: row.execution_mode,
    validationStage: row.validation_stage,
    liveAuthorized: row.live_authorized,
    platform: row.platform || null,
    state: row.state,
    scheduledAt: iso(row.scheduled_at),
    originalTimezone: row.original_timezone,
    caption: row.caption,
    media: jsonValue(row.media),
    platformOptions: jsonValue(row.platform_options),
    idempotencyKey: row.idempotency_key,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: iso(row.lease_expires_at),
    fencingToken: row.fencing_token === null ? null : Number(row.fencing_token),
    attemptCount: Number(row.attempt_count),
    platformPostId: row.platform_post_id,
    platformPostUrl: row.platform_post_url,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    progressMessage: row.progress_message,
    resolvedBy: row.resolved_by,
    resolvedAt: iso(row.resolved_at),
    resolutionNote: row.resolution_note,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function publicScrapingJob(row: ScrapingJobRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    input: jsonValue(row.input),
    state: row.state,
    resultKey: row.result_key,
    scheduledAt: iso(row.scheduled_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: iso(row.lease_expires_at),
    fencingToken: row.fencing_token === null ? null : Number(row.fencing_token),
    attemptCount: Number(row.attempt_count),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: iso(row.completed_at),
  };
}

async function rows<T extends object>(database: Queryable, statement: string, parameters: unknown[] = []) {
  return await database.unsafe<T[]>(statement, parameters as never[]);
}

async function row<T extends object>(database: Queryable, statement: string, parameters: unknown[] = []) {
  return (await rows<T>(database, statement, parameters))[0];
}

export class PostgresAutomationJobStore {
  constructor(
    private readonly database: AutomationPostgres,
    private readonly files: AutomationFileStore,
  ) {}

  async createAccount(input: unknown) {
    const value = createAccountSchema.parse(input);
    const id = automationId("account");
    const storageKey = this.files.profileStorageKey(id);
    await this.files.ensureDevelopmentProfile(id);
    const created = await row<AccountRow>(this.database, `
      WITH account AS (
        INSERT INTO social_accounts (id, workspace_id, platform, display_name)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      ), profile AS (
        INSERT INTO browser_profiles (account_id, workspace_id, storage_key)
        SELECT id, workspace_id, $5 FROM account
      )
      SELECT * FROM account
    `, [id, value.workspaceId, value.platform, value.displayName, storageKey]);
    if (!created) throw new Error("The server publishing account was not created.");
    return publicAccount(created);
  }

  async listAccounts(workspaceId: string) {
    const result = await rows<AccountRow>(this.database, `
      SELECT * FROM social_accounts
      WHERE workspace_id = $1 AND status <> 'DISABLED'
      ORDER BY created_at DESC
    `, [workspaceId]);
    return result.map(publicAccount);
  }

  async updateAccount(accountId: string, input: unknown) {
    const value = updateAccountSchema.parse(input);
    const updated = await row<AccountRow>(this.database, `
      UPDATE social_accounts
      SET display_name = COALESCE($3, display_name),
          enabled = COALESCE($4, enabled),
          updated_at = clock_timestamp()
      WHERE id = $1 AND workspace_id = $2 AND status <> 'DISABLED'
      RETURNING *
    `, [accountId, value.workspaceId, value.displayName ?? null, value.enabled ?? null]);
    if (!updated) throw new Error("Server publishing account not found.");
    return publicAccount(updated);
  }

  async removeAccount(workspaceId: string, accountId: string) {
    const result = await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const account = await row<AccountRow>(tx, `
        SELECT * FROM social_accounts
        WHERE id = $1 AND workspace_id = $2 AND status <> 'DISABLED'
        FOR UPDATE
      `, [accountId, workspaceId]);
      if (!account) throw new Error("Server publishing account not found.");
      const activeLogin = await row<{ found: number }>(tx, `
        SELECT 1 AS found FROM login_sessions
        WHERE account_id = $1 AND state IN ('STARTING', 'AWAITING_USER') LIMIT 1
      `, [accountId]);
      if (activeLogin) throw new Error("Cancel the active account login before removing this account.");
      const activeJob = await row<{ found: number }>(tx, `
        SELECT 1 AS found FROM publishing_jobs
        WHERE account_id = $1 AND state IN ('SCHEDULED', 'PUBLISHING', 'VERIFYING') LIMIT 1
      `, [accountId]);
      if (activeJob) throw new Error("Cancel or finish this account's active publishing jobs before removing it.");
      const count = await row<{ count: string | number }>(tx, `
        SELECT COUNT(*) AS count FROM publishing_jobs WHERE account_id = $1
      `, [accountId]);
      const archived = Number(count?.count || 0) > 0;
      if (archived) {
        await rows(tx, "DELETE FROM browser_profiles WHERE account_id = $1", [accountId]);
        await rows(tx, `
          UPDATE social_accounts
          SET status = 'DISABLED', enabled = false, updated_at = clock_timestamp()
          WHERE id = $1
        `, [accountId]);
      } else {
        await rows(tx, "DELETE FROM social_accounts WHERE id = $1 AND workspace_id = $2", [accountId, workspaceId]);
      }
      return { ok: true, archived };
    });
    await this.files.removeDevelopmentProfile(accountId, workspaceId);
    return result;
  }

  async createPublishingJob(
    input: unknown,
    executionMode: "DRY_RUN" | "LIVE" = "LIVE",
    validationStage: "LOCAL" | "INSTAGRAM_PREVIEW" = "LOCAL",
    liveAuthorized = false,
  ) {
    if (executionMode === "LIVE" && validationStage !== "LOCAL") {
      throw new Error("A publishing preview cannot be created as a live job.");
    }
    if (executionMode === "LIVE" && !liveAuthorized) {
      throw new Error("A live publishing job requires explicit final-action authorization.");
    }
    if (executionMode !== "LIVE" && liveAuthorized) {
      throw new Error("Only live publishing jobs can carry final-action authorization.");
    }
    const value = createPublishingJobSchema.parse(input);
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const account = await row<AccountRow>(tx, `
        SELECT * FROM social_accounts
        WHERE id = $1 AND workspace_id = $2 AND enabled = true
      `, [value.accountId, value.workspaceId]);
      if (!account) throw new Error("The selected server publishing account is unavailable.");
      const existing = await row<PublishingJobRow>(tx, `
        SELECT job.*, account.platform AS platform
        FROM publishing_jobs job JOIN social_accounts account ON account.id = job.account_id
        WHERE job.workspace_id = $1 AND job.idempotency_key = $2
        FOR UPDATE OF job
      `, [value.workspaceId, value.idempotencyKey]);
      const scheduledAt = new Date(value.scheduledAt).toISOString();
      if (existing) {
        const sameRequest = existing.account_id === value.accountId
          && existing.execution_mode === executionMode
          && existing.validation_stage === validationStage
          && existing.live_authorized === liveAuthorized
          && iso(existing.scheduled_at) === scheduledAt
          && existing.original_timezone === value.originalTimezone
          && existing.caption === value.caption
          && JSON.stringify(jsonValue(existing.media)) === JSON.stringify(value.media)
          && JSON.stringify(jsonValue(existing.platform_options)) === JSON.stringify(value.platformOptions);
        if (!sameRequest) throw new Error("The idempotency key is already used by a different publishing request.");
        return publicJob(existing);
      }
      const id = automationId("job");
      const created = await row<PublishingJobRow>(tx, `
        INSERT INTO publishing_jobs
          (id, workspace_id, account_id, execution_mode, validation_stage, live_authorized,
           scheduled_at, original_timezone, caption, media, platform_options, idempotency_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
        RETURNING *, $13::text AS platform
      `, [
        id,
        value.workspaceId,
        value.accountId,
        executionMode,
        validationStage,
        liveAuthorized,
        scheduledAt,
        value.originalTimezone,
        value.caption,
        JSON.stringify(value.media),
        JSON.stringify(value.platformOptions),
        value.idempotencyKey,
        account.platform,
      ]);
      if (!created) throw new Error("The publishing job was not created.");
      return publicJob(created);
    });
  }

  async getPublishingJob(workspaceId: string, jobId: string) {
    const found = await row<PublishingJobRow>(this.database, `
      SELECT job.*, account.platform AS platform
      FROM publishing_jobs job JOIN social_accounts account ON account.id = job.account_id
      WHERE job.id = $1 AND job.workspace_id = $2
    `, [jobId, workspaceId]);
    return found ? publicJob(found) : null;
  }

  async listPublishingJobs(workspaceId: string, limit = 30) {
    const normalized = workspaceId.trim();
    if (!normalized) throw new Error("A workspace id is required to list publishing jobs.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Publishing job list limits must be between 1 and 100.");
    }
    const result = await rows<PublishingJobRow>(this.database, `
      SELECT job.*, account.platform AS platform
      FROM publishing_jobs job JOIN social_accounts account ON account.id = job.account_id
      WHERE job.workspace_id = $1 AND job.execution_mode = 'LIVE' AND job.validation_stage = 'LOCAL'
      ORDER BY job.created_at DESC LIMIT $2
    `, [normalized, limit]);
    return result.map(publicJob);
  }

  async cancelScheduledPublishingJob(workspaceId: string, jobId: string) {
    const normalizedWorkspaceId = workspaceId.trim();
    const normalizedJobId = jobId.trim();
    if (!normalizedWorkspaceId || !normalizedJobId) throw new Error("Workspace and job ids are required to cancel publishing.");
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const current = await row<PublishingJobRow>(tx, `
        SELECT job.*, account.platform AS platform
        FROM publishing_jobs job JOIN social_accounts account ON account.id = job.account_id
        WHERE job.id = $1 AND job.workspace_id = $2
          AND job.execution_mode = 'LIVE' AND job.validation_stage = 'LOCAL'
        FOR UPDATE OF job
      `, [normalizedJobId, normalizedWorkspaceId]);
      if (!current) return { status: "NOT_FOUND" as const, job: null };
      if (current.state !== "SCHEDULED") return { status: "CONFLICT" as const, job: publicJob(current) };
      assertPublishingJobTransition(current.state, "CANCELLED");
      const cancelled = await row<PublishingJobRow>(tx, `
        UPDATE publishing_jobs
        SET state = 'CANCELLED', error_code = 'USER_CANCELLED',
            error_message = 'The scheduled post was cancelled before publishing started.',
            updated_at = clock_timestamp()
        WHERE id = $1 AND state = 'SCHEDULED'
        RETURNING *, $2::text AS platform
      `, [normalizedJobId, current.platform]);
      await rows(tx, `
        INSERT INTO job_events (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES ($1, $2, $3, 'publishing', 'cancelled', $4::jsonb)
      `, [automationId("event"), normalizedWorkspaceId, normalizedJobId, JSON.stringify({ source: "website", finalShareClicked: false })]);
      if (!cancelled) throw new Error("The scheduled publishing job changed while it was being cancelled.");
      return { status: "CANCELLED" as const, job: publicJob(cancelled) };
    });
  }

  async claimDuePublishingJob(
    workerId: string,
    leaseSeconds = 300,
    executionMode: "DRY_RUN" | "LIVE" = "LIVE",
    validationStage: "LOCAL" | "INSTAGRAM_PREVIEW" = "LOCAL",
  ) {
    if (!workerId.trim()) throw new Error("A worker id is required to claim publishing work.");
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) {
      throw new Error("Publishing leases must be between 30 and 1800 seconds.");
    }
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const candidate = await row<PublishingJobRow>(tx, `
        SELECT job.*, account.platform AS platform
        FROM publishing_jobs job
        JOIN social_accounts account ON account.id = job.account_id
        LEFT JOIN account_execution_locks account_lock ON account_lock.account_id = job.account_id
        WHERE job.state = 'SCHEDULED'
          AND job.execution_mode = $1
          AND job.validation_stage = $2
          AND job.live_authorized = $3
          AND job.scheduled_at <= clock_timestamp()
          AND account.enabled = true
          AND account.status = 'CONNECTED'
          AND (account_lock.account_id IS NULL OR account_lock.lease_expires_at <= clock_timestamp())
          AND NOT EXISTS (
            SELECT 1 FROM login_sessions login
            WHERE login.account_id = job.account_id AND login.state IN ('STARTING', 'AWAITING_USER')
          )
        ORDER BY job.scheduled_at, job.created_at
        FOR UPDATE OF job SKIP LOCKED
        LIMIT 1
      `, [executionMode, validationStage, executionMode === "LIVE"]);
      if (!candidate) return null;
      const lock = await row<{ fencing_token: string | number }>(tx, `
        INSERT INTO account_execution_locks
          (account_id, lease_owner, lease_expires_at, fencing_token, updated_at)
        VALUES ($1, $2, clock_timestamp() + ($3 * interval '1 second'), 1, clock_timestamp())
        ON CONFLICT (account_id) DO UPDATE
          SET lease_owner = EXCLUDED.lease_owner,
              lease_expires_at = EXCLUDED.lease_expires_at,
              fencing_token = account_execution_locks.fencing_token + 1,
              updated_at = clock_timestamp()
          WHERE account_execution_locks.lease_expires_at <= clock_timestamp()
        RETURNING fencing_token
      `, [candidate.account_id, workerId, leaseSeconds]);
      if (!lock) return null;
      const fencingToken = Number(lock.fencing_token);
      const claimed = await row<PublishingJobRow>(tx, `
        UPDATE publishing_jobs
        SET state = 'PUBLISHING', lease_owner = $2,
            lease_expires_at = clock_timestamp() + ($3 * interval '1 second'),
            fencing_token = $4, attempt_count = attempt_count + 1,
            updated_at = clock_timestamp()
        WHERE id = $1 AND state = 'SCHEDULED'
        RETURNING *, $5::text AS platform
      `, [candidate.id, workerId, leaseSeconds, fencingToken, candidate.platform]);
      if (!claimed) return null;
      const attemptId = automationId("attempt");
      await rows(tx, `
        INSERT INTO publishing_attempts
          (id, job_id, account_id, worker_id, fencing_token, state)
        VALUES ($1, $2, $3, $4, $5, 'PUBLISHING')
      `, [attemptId, candidate.id, candidate.account_id, workerId, fencingToken]);
      await rows(tx, `
        INSERT INTO job_events (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES ($1, $2, $3, 'publishing', 'claimed', $4::jsonb)
      `, [automationId("event"), candidate.workspace_id, candidate.id, JSON.stringify({ workerId, fencingToken, attemptId })]);
      return publicJob(claimed);
    });
  }

  async heartbeatPublishingJob(jobId: string, workerId: string, fencingToken: number, leaseSeconds = 300) {
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const lock = await row<{ account_id: string }>(tx, `
        UPDATE account_execution_locks account_lock
        SET lease_expires_at = clock_timestamp() + ($4 * interval '1 second'), updated_at = clock_timestamp()
        FROM publishing_jobs job
        WHERE job.id = $1 AND account_lock.account_id = job.account_id
          AND account_lock.lease_owner = $2 AND account_lock.fencing_token = $3
          AND account_lock.lease_expires_at > clock_timestamp()
        RETURNING account_lock.account_id
      `, [jobId, workerId, fencingToken, leaseSeconds]);
      if (!lock) return false;
      const job = await row<{ id: string }>(tx, `
        UPDATE publishing_jobs
        SET lease_expires_at = clock_timestamp() + ($4 * interval '1 second'), updated_at = clock_timestamp()
        WHERE id = $1 AND lease_owner = $2 AND fencing_token = $3
          AND state IN ('PUBLISHING', 'VERIFYING')
        RETURNING id
      `, [jobId, workerId, fencingToken, leaseSeconds]);
      return Boolean(job);
    });
  }

  async recordPublishingProgress(jobId: string, workerId: string, fencingToken: number, message: string) {
    const progress = message.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!progress) return false;
    const updated = await row<{ id: string }>(this.database, `
      UPDATE publishing_jobs
      SET progress_message = $4, updated_at = clock_timestamp()
      WHERE id = $1 AND lease_owner = $2 AND fencing_token = $3
        AND state IN ('PUBLISHING', 'VERIFYING')
      RETURNING id
    `, [jobId, workerId, fencingToken, progress]);
    return Boolean(updated);
  }

  async markPublishingFinalActionStarting(jobId: string, workerId: string, fencingToken: number) {
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const current = await row<{ id: string; workspace_id: string }>(tx, `
        SELECT job.id, job.workspace_id
        FROM publishing_jobs job
        JOIN account_execution_locks account_lock ON account_lock.account_id = job.account_id
        WHERE job.id = $1 AND job.execution_mode = 'LIVE' AND job.live_authorized = true
          AND job.state = 'PUBLISHING' AND job.lease_owner = $2 AND job.fencing_token = $3
          AND job.lease_expires_at > clock_timestamp()
          AND account_lock.lease_owner = $2 AND account_lock.fencing_token = $3
          AND account_lock.lease_expires_at > clock_timestamp()
        FOR UPDATE OF job
      `, [jobId, workerId, fencingToken]);
      if (!current) throw new Error("The live publishing lease was lost before the final action.");
      const updated = await row<{ id: string }>(tx, `
        UPDATE publishing_jobs
        SET state = 'VERIFYING', progress_message = 'Final publish action submitted; waiting for confirmation.',
            updated_at = clock_timestamp()
        WHERE id = $1 AND state = 'PUBLISHING' AND lease_owner = $2 AND fencing_token = $3
        RETURNING id
      `, [jobId, workerId, fencingToken]);
      if (!updated) throw new Error("The live publishing job changed before the final action.");
      await rows(tx, `
        INSERT INTO job_events (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES ($1, $2, $3, 'publishing', 'final_action_starting', $4::jsonb)
      `, [automationId("event"), current.workspace_id, jobId, JSON.stringify({ workerId, fencingToken })]);
      return true;
    });
  }

  async getPublishingProfileState(accountId: string) {
    const profile = await row<{ version: string | number; last_saved_at: Date | string | null }>(this.database, `
      SELECT version, last_saved_at FROM browser_profiles WHERE account_id = $1
    `, [accountId]);
    return profile ? { version: Number(profile.version), lastSavedAt: iso(profile.last_saved_at) } : null;
  }

  async recordPublishingProfileSaved(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    expectedVersion: number;
    savedVersion: number;
    blobEtag?: string | null;
    contentSha256?: string;
    encryptedSizeBytes?: number;
    encryptionKeyId?: string;
    encryptionKeyVersion?: string;
  }) {
    if (input.savedVersion !== input.expectedVersion + 1) {
      throw new Error("The saved browser profile version is not the next expected version.");
    }
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const job = await row<{ account_id: string }>(tx, `
        SELECT account_id FROM publishing_jobs
        WHERE id = $1 AND lease_owner = $2 AND fencing_token = $3
          AND state IN ('PUBLISHING', 'VERIFYING')
        FOR UPDATE
      `, [input.jobId, input.workerId, input.fencingToken]);
      if (!job) throw new Error("The publishing lease was lost before the browser profile was saved.");
      const updated = await row<{ version: string | number; last_saved_at: Date | string }>(tx, `
        UPDATE browser_profiles
        SET version = $2, blob_etag = $3, content_sha256 = $5,
            encrypted_size_bytes = $6, encryption_key_id = $7, encryption_key_version = $8,
            encryption_state = 'ENCRYPTED',
            last_saved_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE account_id = $1 AND version = $4
        RETURNING version, last_saved_at
      `, [
        job.account_id,
        input.savedVersion,
        input.blobEtag || null,
        input.expectedVersion,
        input.contentSha256 || null,
        input.encryptedSizeBytes ?? null,
        input.encryptionKeyId || null,
        input.encryptionKeyVersion || null,
      ]);
      if (!updated) throw new Error("The browser profile database version changed before it was saved.");
      return { version: Number(updated.version), lastSavedAt: iso(updated.last_saved_at)! };
    });
  }

  async completePublishingDryRun(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    valid: boolean;
    checks: string[];
    issues: string[];
  }) {
    return await this.completeNonPublishing(input, "LOCAL");
  }

  async completePublishingPreview(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    valid: boolean;
    checks: string[];
    issues: string[];
    screenshotKey?: string;
    loginRequired?: boolean;
  }) {
    return await this.completeNonPublishing(input, "INSTAGRAM_PREVIEW");
  }

  private async completeNonPublishing(
    input: {
      jobId: string;
      workerId: string;
      fencingToken: number;
      valid: boolean;
      checks: string[];
      issues: string[];
      screenshotKey?: string;
      loginRequired?: boolean;
    },
    stage: "LOCAL" | "INSTAGRAM_PREVIEW",
  ) {
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const current = await this.requireOwnedJob(tx, input.jobId, input.workerId, input.fencingToken, "DRY_RUN", stage);
      const preview = stage === "INSTAGRAM_PREVIEW";
      const errorCode = preview
        ? input.valid ? "PREVIEW_COMPLETE" : input.loginRequired ? "PREVIEW_LOGIN_REQUIRED" : "PREVIEW_FAILED"
        : input.valid ? "DRY_RUN_COMPLETE" : "DRY_RUN_VALIDATION_FAILED";
      const errorMessage = preview
        ? input.valid
          ? "Instagram composer preview prepared and closed before Share. Nothing was published."
          : `Instagram preview failed: ${input.issues.join(" ")}`
        : input.valid
          ? "Dry-run checks passed. No social platform was opened and no post was published."
          : `Dry-run validation failed: ${input.issues.join(" ")}`;
      const completed = await row<PublishingJobRow>(tx, `
        UPDATE publishing_jobs
        SET state = 'CANCELLED', error_code = $2, error_message = $3,
            progress_message = NULL, lease_owner = NULL, lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING *
      `, [input.jobId, errorCode, errorMessage]);
      await this.releaseAccountLock(tx, current.account_id, input.workerId, input.fencingToken);
      if (input.loginRequired) {
        await rows(tx, `UPDATE social_accounts SET status = 'LOGIN_REQUIRED', updated_at = clock_timestamp() WHERE id = $1`, [current.account_id]);
      }
      const detail = {
        preview,
        dryRun: !preview,
        valid: input.valid,
        checks: input.checks,
        issues: input.issues,
        screenshotKey: input.screenshotKey || null,
        networkAccess: preview,
        finalShareClicked: false,
        published: false,
      };
      await rows(tx, `
        UPDATE publishing_attempts SET state = $1, completed_at = clock_timestamp(), detail = $2::jsonb
        WHERE job_id = $3 AND worker_id = $4 AND fencing_token = $5
      `, [errorCode, JSON.stringify(detail), input.jobId, input.workerId, input.fencingToken]);
      await rows(tx, `
        INSERT INTO job_events (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES ($1, $2, $3, 'publishing', $4, $5::jsonb)
      `, [automationId("event"), current.workspace_id, input.jobId, preview ? "preview_completed" : "dry_run_completed", JSON.stringify(detail)]);
      if (!completed) throw new Error("The non-publishing job was not completed.");
      completed.platform = current.platform;
      return publicJob(completed);
    });
  }

  async finishPublishingJob(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    state: "PUBLISHED" | "FAILED" | "LOGIN_REQUIRED" | "UNCERTAIN";
    platformPostId?: string;
    platformPostUrl?: string;
    errorCode?: string;
    errorMessage?: string;
  }) {
    const targetState = publishingJobStateSchema.parse(input.state);
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const current = await this.requireOwnedJob(tx, input.jobId, input.workerId, input.fencingToken, "LIVE", "LOCAL");
      assertPublishingJobTransition(current.state, targetState);
      const completed = await row<PublishingJobRow>(tx, `
        UPDATE publishing_jobs
        SET state = $2, platform_post_id = $3, platform_post_url = $4,
            error_code = $5, error_message = $6, progress_message = NULL,
            lease_owner = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING *
      `, [
        input.jobId,
        targetState,
        input.platformPostId || null,
        input.platformPostUrl || null,
        input.errorCode || null,
        input.errorMessage || null,
      ]);
      await this.releaseAccountLock(tx, current.account_id, input.workerId, input.fencingToken);
      if (targetState === "LOGIN_REQUIRED") {
        await rows(tx, `UPDATE social_accounts SET status = 'LOGIN_REQUIRED', updated_at = clock_timestamp() WHERE id = $1`, [current.account_id]);
      }
      const detail = {
        platformPostId: input.platformPostId || null,
        platformPostUrl: input.platformPostUrl || null,
        errorCode: input.errorCode || null,
        errorMessage: input.errorMessage || null,
      };
      await rows(tx, `
        UPDATE publishing_attempts SET state = $1, completed_at = clock_timestamp(), detail = $2::jsonb
        WHERE job_id = $3 AND worker_id = $4 AND fencing_token = $5
      `, [targetState, JSON.stringify(detail), input.jobId, input.workerId, input.fencingToken]);
      await rows(tx, `
        INSERT INTO job_events (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES ($1, $2, $3, 'publishing', $4, $5::jsonb)
      `, [automationId("event"), current.workspace_id, input.jobId, targetState.toLowerCase(), JSON.stringify({ fencingToken: input.fencingToken })]);
      if (!completed) throw new Error("The publishing job was not completed.");
      completed.platform = current.platform;
      return publicJob(completed);
    });
  }

  async resolveUncertainPublishingJob(jobId: string, input: unknown) {
    const value = resolveUncertainPublishingJobSchema.parse(input);
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const current = await row<PublishingJobRow>(tx, `
        SELECT job.*, account.platform AS platform
        FROM publishing_jobs job JOIN social_accounts account ON account.id = job.account_id
        WHERE job.id = $1 AND job.workspace_id = $2
        FOR UPDATE OF job
      `, [jobId, value.workspaceId]);
      if (!current) return { status: "NOT_FOUND" as const, job: null };
      if (current.state !== "UNCERTAIN") return { status: "CONFLICT" as const, job: publicJob(current) };
      assertPublishingJobTransition(current.state, value.resolution);
      const resolved = await row<PublishingJobRow>(tx, `
        UPDATE publishing_jobs
        SET state = $3, platform_post_id = COALESCE($4, platform_post_id),
            platform_post_url = COALESCE($5, platform_post_url), error_code = NULL,
            error_message = NULL, resolved_by = $6, resolved_at = clock_timestamp(),
            resolution_note = $7, updated_at = clock_timestamp()
        WHERE id = $1 AND workspace_id = $2 AND state = 'UNCERTAIN'
        RETURNING *, $8::text AS platform
      `, [
        jobId,
        value.workspaceId,
        value.resolution,
        value.platformPostId || null,
        value.platformPostUrl || null,
        value.resolvedBy,
        value.note,
        current.platform,
      ]);
      await rows(tx, `
        INSERT INTO job_events (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES ($1, $2, $3, 'publishing', 'uncertain_resolved', $4::jsonb)
      `, [automationId("event"), value.workspaceId, jobId, JSON.stringify({
        resolution: value.resolution,
        resolvedBy: value.resolvedBy,
        note: value.note,
        platformPostId: value.platformPostId || null,
        platformPostUrl: value.platformPostUrl || null,
      })]);
      if (!resolved) throw new Error("The uncertain job changed before it was resolved.");
      return { status: "RESOLVED" as const, job: publicJob(resolved) };
    });
  }

  async quarantineExpiredPublishingJobs() {
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const expired = await rows<PublishingJobRow>(tx, `
        SELECT job.*, account.platform AS platform
        FROM publishing_jobs job JOIN social_accounts account ON account.id = job.account_id
        WHERE job.state IN ('PUBLISHING', 'VERIFYING') AND job.lease_expires_at <= clock_timestamp()
        FOR UPDATE OF job SKIP LOCKED
      `);
      const quarantined = [];
      for (const current of expired) {
        const nonPublishing = current.execution_mode === "DRY_RUN";
        const finalState = nonPublishing ? "CANCELLED" : "UNCERTAIN";
        const errorCode = nonPublishing ? "VALIDATION_LEASE_EXPIRED" : "WORKER_LEASE_EXPIRED";
        const errorMessage = nonPublishing
          ? "The non-publishing validation worker stopped. Nothing was published; run the check again."
          : "The worker lease expired during publishing. Verify the platform before retrying.";
        const updated = await row<PublishingJobRow>(tx, `
          UPDATE publishing_jobs
          SET state = $2, error_code = $3, error_message = $4,
              progress_message = NULL, lease_owner = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp()
          WHERE id = $1
          RETURNING *, $5::text AS platform
        `, [current.id, finalState, errorCode, errorMessage, current.platform]);
        await rows(tx, `
          UPDATE account_execution_locks
          SET lease_owner = NULL, lease_expires_at = '-infinity'::timestamptz, updated_at = clock_timestamp()
          WHERE account_id = $1 AND fencing_token = $2
        `, [current.account_id, current.fencing_token]);
        await rows(tx, `
          UPDATE publishing_attempts
          SET state = $1, completed_at = clock_timestamp(), detail = $2::jsonb
          WHERE job_id = $3 AND fencing_token = $4 AND completed_at IS NULL
        `, [finalState, JSON.stringify({ errorCode, published: false, finalShareClicked: nonPublishing ? false : null }), current.id, current.fencing_token]);
        await rows(tx, `
          INSERT INTO job_events (id, workspace_id, job_id, job_type, event_type, detail)
          VALUES ($1, $2, $3, 'publishing', 'lease_expired', $4::jsonb)
        `, [automationId("event"), current.workspace_id, current.id, JSON.stringify({ fencingToken: current.fencing_token, errorCode })]);
        if (updated) quarantined.push(publicJob(updated));
      }
      return quarantined;
    });
  }

  async getOperationalMetrics() {
    const publishing = await rows<{ state: PublishingJobState; count: string | number }>(this.database, `
      SELECT state, COUNT(*) AS count FROM publishing_jobs GROUP BY state
    `);
    const oldest = await row<{ scheduled_at: Date | string }>(this.database, `
      SELECT scheduled_at FROM publishing_jobs
      WHERE state = 'SCHEDULED' ORDER BY scheduled_at LIMIT 1
    `);
    const accounts = await rows<{ status: string; count: string | number }>(this.database, `
      SELECT status, COUNT(*) AS count FROM social_accounts GROUP BY status
    `);
    const scraping = await rows<{ state: ScrapingJobState; count: string | number }>(this.database, `
      SELECT state, COUNT(*) AS count FROM scraping_jobs GROUP BY state
    `);
    return {
      publishing: Object.fromEntries(publishing.map(item => [item.state, Number(item.count)])),
      scraping: Object.fromEntries(scraping.map(item => [item.state, Number(item.count)])),
      accounts: Object.fromEntries(accounts.map(item => [item.status, Number(item.count)])),
      oldestScheduledAt: oldest ? iso(oldest.scheduled_at) : null,
      collectedAt: new Date().toISOString(),
    };
  }

  async createScrapingJob(input: unknown) {
    const value = createScrapingJobSchema.parse(input);
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const existing = await row<ScrapingJobRow>(tx, `
        SELECT * FROM scraping_jobs WHERE workspace_id = $1 AND idempotency_key = $2 FOR UPDATE
      `, [value.workspaceId, value.idempotencyKey]);
      if (existing) {
        if (existing.platform !== value.platform || JSON.stringify(jsonValue(existing.input)) !== JSON.stringify(value.input)) {
          throw new Error("The scraping idempotency key is already used by a different request.");
        }
        return publicScrapingJob(existing);
      }
      const id = automationId("scrape");
      const created = await row<ScrapingJobRow>(tx, `
        INSERT INTO scraping_jobs (id, workspace_id, platform, public_url, input, idempotency_key)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        RETURNING *
      `, [id, value.workspaceId, value.platform, value.input.query, JSON.stringify(value.input), value.idempotencyKey]);
      if (!created) throw new Error("The scraping job was not created.");
      return publicScrapingJob(created);
    });
  }

  async listScrapingJobs(workspaceId: string, limit = 30) {
    if (!workspaceId.trim()) throw new Error("A workspace id is required to list scraping jobs.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Scraping job list limits must be between 1 and 100.");
    return (await rows<ScrapingJobRow>(this.database, `
      SELECT * FROM scraping_jobs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2
    `, [workspaceId, limit])).map(publicScrapingJob);
  }

  async getScrapingJob(workspaceId: string, jobId: string) {
    const found = await row<ScrapingJobRow>(this.database, `SELECT * FROM scraping_jobs WHERE id = $1 AND workspace_id = $2`, [jobId, workspaceId]);
    return found ? publicScrapingJob(found) : null;
  }

  async claimDueScrapingJob(workerId: string, leaseSeconds = 600) {
    if (!workerId.trim()) throw new Error("A worker id is required to claim scraping work.");
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const candidate = await row<ScrapingJobRow>(tx, `
        SELECT * FROM scraping_jobs
        WHERE state = 'SCHEDULED' AND scheduled_at <= clock_timestamp()
        ORDER BY scheduled_at, created_at
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      if (!candidate) return null;
      const fencingToken = Number(candidate.fencing_token || 0) + 1;
      const claimed = await row<ScrapingJobRow>(tx, `
        UPDATE scraping_jobs
        SET state = 'RUNNING', lease_owner = $2,
            lease_expires_at = clock_timestamp() + ($3 * interval '1 second'),
            fencing_token = $4, attempt_count = attempt_count + 1, updated_at = clock_timestamp()
        WHERE id = $1 AND state = 'SCHEDULED'
        RETURNING *
      `, [candidate.id, workerId, leaseSeconds, fencingToken]);
      if (!claimed) return null;
      await rows(tx, `
        INSERT INTO job_events (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES ($1, $2, $3, 'scraping', 'claimed', $4::jsonb)
      `, [automationId("event"), candidate.workspace_id, candidate.id, JSON.stringify({ workerId, fencingToken })]);
      return publicScrapingJob(claimed);
    });
  }

  async heartbeatScrapingJob(jobId: string, workerId: string, fencingToken: number, leaseSeconds = 600) {
    const updated = await row<{ id: string }>(this.database, `
      UPDATE scraping_jobs
      SET lease_expires_at = clock_timestamp() + ($4 * interval '1 second'), updated_at = clock_timestamp()
      WHERE id = $1 AND state = 'RUNNING' AND lease_owner = $2 AND fencing_token = $3
        AND lease_expires_at > clock_timestamp()
      RETURNING id
    `, [jobId, workerId, fencingToken, leaseSeconds]);
    return Boolean(updated);
  }

  async finishScrapingJob(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    state: "COMPLETE" | "FAILED";
    resultKey?: string;
    errorCode?: string;
    errorMessage?: string;
  }) {
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const current = await row<ScrapingJobRow>(tx, `
        SELECT * FROM scraping_jobs
        WHERE id = $1 AND state = 'RUNNING' AND lease_owner = $2 AND fencing_token = $3
          AND lease_expires_at > clock_timestamp()
        FOR UPDATE
      `, [input.jobId, input.workerId, input.fencingToken]);
      if (!current) throw new Error("The scraping lease is no longer owned by this worker.");
      const completed = await row<ScrapingJobRow>(tx, `
        UPDATE scraping_jobs
        SET state = $2, result_key = $3, error_code = $4, error_message = $5,
            lease_owner = NULL, lease_expires_at = NULL,
            updated_at = clock_timestamp(), completed_at = clock_timestamp()
        WHERE id = $1 RETURNING *
      `, [input.jobId, input.state, input.resultKey || null, input.errorCode || null, input.errorMessage || null]);
      await rows(tx, `
        INSERT INTO job_events (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES ($1, $2, $3, 'scraping', $4, $5::jsonb)
      `, [automationId("event"), current.workspace_id, current.id, input.state.toLowerCase(), JSON.stringify({ fencingToken: input.fencingToken })]);
      if (!completed) throw new Error("The scraping job was not completed.");
      return publicScrapingJob(completed);
    });
  }

  async quarantineExpiredScrapingJobs() {
    const expired = await rows<{ id: string }>(this.database, `
      UPDATE scraping_jobs
      SET state = 'FAILED', error_code = 'SCRAPING_LEASE_EXPIRED',
          error_message = 'The scraping worker stopped before completing this job.',
          lease_owner = NULL, lease_expires_at = NULL,
          updated_at = clock_timestamp(), completed_at = clock_timestamp()
      WHERE state = 'RUNNING' AND lease_expires_at <= clock_timestamp()
      RETURNING id
    `);
    return expired.length;
  }

  private async requireOwnedJob(
    database: Queryable,
    jobId: string,
    workerId: string,
    fencingToken: number,
    mode: "DRY_RUN" | "LIVE",
    stage: "LOCAL" | "INSTAGRAM_PREVIEW",
  ) {
    const current = await row<PublishingJobRow>(database, `
      SELECT job.*, account.platform AS platform
      FROM publishing_jobs job
      JOIN social_accounts account ON account.id = job.account_id
      JOIN account_execution_locks account_lock ON account_lock.account_id = job.account_id
      WHERE job.id = $1 AND job.execution_mode = $4 AND job.validation_stage = $5
        AND job.lease_owner = $2 AND job.fencing_token = $3
        AND account_lock.lease_owner = $2 AND account_lock.fencing_token = $3
        AND account_lock.lease_expires_at > clock_timestamp()
      FOR UPDATE OF job
    `, [jobId, workerId, fencingToken, mode, stage]);
    if (!current) throw new Error("The publishing lease is no longer owned by this worker.");
    return current;
  }

  private async releaseAccountLock(database: Queryable, accountId: string, workerId: string, fencingToken: number) {
    await rows(database, `
      UPDATE account_execution_locks
      SET lease_owner = NULL, lease_expires_at = '-infinity'::timestamptz, updated_at = clock_timestamp()
      WHERE account_id = $1 AND lease_owner = $2 AND fencing_token = $3
    `, [accountId, workerId, fencingToken]);
  }
}
