import type { AutomationDatabase } from "./database.ts";
import { withImmediateTransaction } from "./database.ts";
import {
  assertPublishingJobTransition,
  automationId,
  createAccountSchema,
  createPublishingJobSchema,
  publishingJobStateSchema,
  type PublishingJobState,
  type SocialPlatform,
} from "./contracts.ts";
import type { AutomationFileStore } from "./profile-store.ts";

type AccountRow = {
  id: string;
  workspace_id: string;
  platform: string;
  display_name: string;
  status: string;
  enabled: number | boolean;
  created_at: string;
  updated_at: string;
};

type PublishingJobRow = {
  id: string;
  workspace_id: string;
  account_id: string;
  execution_mode: "DRY_RUN" | "LIVE";
  validation_stage: "LOCAL" | "INSTAGRAM_PREVIEW";
  platform?: SocialPlatform;
  state: PublishingJobState;
  scheduled_at: string;
  original_timezone: string;
  caption: string;
  media: string;
  idempotency_key: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  fencing_token: number | null;
  attempt_count: number;
  platform_post_id: string | null;
  platform_post_url: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

class PublishingLeaseLostError extends Error {}

function now() {
  return new Date().toISOString();
}

function leaseExpiry(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function timestamp(value: string | null) {
  return value ? new Date(value).toISOString() : null;
}

function publicAccount(row: AccountRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    displayName: row.display_name,
    status: row.status,
    enabled: Boolean(row.enabled),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function publicJob(row: PublishingJobRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    executionMode: row.execution_mode,
    validationStage: row.validation_stage,
    platform: row.platform || null,
    state: row.state,
    scheduledAt: timestamp(row.scheduled_at),
    originalTimezone: row.original_timezone,
    caption: row.caption,
    media: JSON.parse(row.media) as unknown,
    idempotencyKey: row.idempotency_key,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: timestamp(row.lease_expires_at),
    fencingToken: row.fencing_token,
    attemptCount: row.attempt_count,
    platformPostId: row.platform_post_id,
    platformPostUrl: row.platform_post_url,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export class AutomationJobStore {
  constructor(
    private readonly database: AutomationDatabase,
    private readonly files: AutomationFileStore,
  ) {}

  async createAccount(input: unknown) {
    const value = createAccountSchema.parse(input);
    const id = automationId("account");
    const storageKey = this.files.profileStorageKey(id);
    await this.files.ensureDevelopmentProfile(id);
    return withImmediateTransaction(this.database, () => {
      const createdAt = now();
      this.database.prepare(`
        INSERT INTO social_accounts
          (id, workspace_id, platform, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, value.workspaceId, value.platform, value.displayName, createdAt, createdAt);
      this.database.prepare(`
        INSERT INTO browser_profiles
          (account_id, storage_key, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(id, storageKey, createdAt, createdAt);
      const row = this.database.prepare("SELECT * FROM social_accounts WHERE id = ?").get(id) as AccountRow;
      return publicAccount(row);
    });
  }

  listAccounts(workspaceId: string) {
    const rows = this.database.prepare(`
      SELECT * FROM social_accounts
      WHERE workspace_id = ?
      ORDER BY created_at DESC
    `).all(workspaceId) as unknown as AccountRow[];
    return rows.map(publicAccount);
  }

  createPublishingJob(
    input: unknown,
    executionMode: "DRY_RUN" | "LIVE" = "LIVE",
    validationStage: "LOCAL" | "INSTAGRAM_PREVIEW" = "LOCAL",
  ) {
    if (executionMode === "LIVE" && validationStage !== "LOCAL") {
      throw new Error("A publishing preview cannot be created as a live job.");
    }
    const value = createPublishingJobSchema.parse(input);
    const account = this.database.prepare(`
      SELECT * FROM social_accounts
      WHERE id = ? AND workspace_id = ? AND enabled = 1
    `).get(value.accountId, value.workspaceId) as AccountRow | undefined;
    if (!account) throw new Error("The selected server publishing account is unavailable.");

    const scheduledAt = new Date(value.scheduledAt).toISOString();
    const media = JSON.stringify(value.media);
    const existing = this.database.prepare(`
      SELECT * FROM publishing_jobs WHERE workspace_id = ? AND idempotency_key = ?
    `).get(value.workspaceId, value.idempotencyKey) as PublishingJobRow | undefined;
    if (existing) {
      const sameRequest = existing.account_id === value.accountId
        && existing.execution_mode === executionMode
        && existing.validation_stage === validationStage
        && existing.scheduled_at === scheduledAt
        && existing.original_timezone === value.originalTimezone
        && existing.caption === value.caption
        && existing.media === media;
      if (!sameRequest) {
        throw new Error("The idempotency key is already used by a different publishing request.");
      }
      return publicJob(existing);
    }

    const id = automationId("job");
    const createdAt = now();
    this.database.prepare(`
      INSERT INTO publishing_jobs
        (id, workspace_id, account_id, execution_mode, validation_stage, scheduled_at, original_timezone, caption, media,
         idempotency_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      value.workspaceId,
      value.accountId,
      executionMode,
      validationStage,
      scheduledAt,
      value.originalTimezone,
      value.caption,
      media,
      value.idempotencyKey,
      createdAt,
      createdAt,
    );
    const row = this.database.prepare("SELECT * FROM publishing_jobs WHERE id = ?").get(id) as PublishingJobRow;
    return publicJob(row);
  }

  getPublishingJob(workspaceId: string, jobId: string) {
    const row = this.database.prepare(`
      SELECT * FROM publishing_jobs WHERE id = ? AND workspace_id = ?
    `).get(jobId, workspaceId) as PublishingJobRow | undefined;
    return row ? publicJob(row) : null;
  }

  claimDuePublishingJob(
    workerId: string,
    leaseSeconds = 300,
    executionMode: "DRY_RUN" | "LIVE" = "LIVE",
    validationStage: "LOCAL" | "INSTAGRAM_PREVIEW" = "LOCAL",
  ) {
    if (!workerId.trim()) throw new Error("A worker id is required to claim publishing work.");
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) {
      throw new Error("Publishing leases must be between 30 and 1800 seconds.");
    }

    return withImmediateTransaction(this.database, () => {
      const claimedAt = now();
      const expiresAt = leaseExpiry(leaseSeconds);
      const candidate = this.database.prepare(`
        SELECT job.*, account.platform AS platform
        FROM publishing_jobs job
        JOIN social_accounts account ON account.id = job.account_id
        LEFT JOIN account_execution_locks account_lock ON account_lock.account_id = job.account_id
        WHERE job.state = 'SCHEDULED'
          AND job.execution_mode = ?
          AND job.validation_stage = ?
          AND job.scheduled_at <= ?
          AND account.enabled = 1
          AND account.status = 'CONNECTED'
          AND (account_lock.account_id IS NULL OR account_lock.lease_expires_at <= ?)
          AND NOT EXISTS (
            SELECT 1 FROM login_sessions login
            WHERE login.account_id = job.account_id
              AND login.state IN ('STARTING', 'AWAITING_USER')
          )
        ORDER BY job.scheduled_at, job.created_at
        LIMIT 1
      `).get(executionMode, validationStage, claimedAt, claimedAt) as PublishingJobRow | undefined;
      if (!candidate) return null;

      const existingLock = this.database.prepare(`
        SELECT fencing_token, lease_expires_at FROM account_execution_locks WHERE account_id = ?
      `).get(candidate.account_id) as { fencing_token: number; lease_expires_at: string } | undefined;
      let fencingToken = 1;
      if (existingLock) {
        if (existingLock.lease_expires_at > claimedAt) return null;
        fencingToken = existingLock.fencing_token + 1;
        this.database.prepare(`
          UPDATE account_execution_locks
          SET lease_owner = ?, lease_expires_at = ?, fencing_token = ?, updated_at = ?
          WHERE account_id = ?
        `).run(workerId, expiresAt, fencingToken, claimedAt, candidate.account_id);
      } else {
        this.database.prepare(`
          INSERT INTO account_execution_locks
            (account_id, lease_owner, lease_expires_at, fencing_token, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(candidate.account_id, workerId, expiresAt, fencingToken, claimedAt);
      }

      const update = this.database.prepare(`
        UPDATE publishing_jobs
        SET state = 'PUBLISHING', lease_owner = ?, lease_expires_at = ?, fencing_token = ?,
            attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND state = 'SCHEDULED'
      `).run(workerId, expiresAt, fencingToken, claimedAt, candidate.id);
      if (update.changes !== 1) return null;

      const attemptId = automationId("attempt");
      this.database.prepare(`
        INSERT INTO publishing_attempts
          (id, job_id, account_id, worker_id, fencing_token, state, started_at)
        VALUES (?, ?, ?, ?, ?, 'PUBLISHING', ?)
      `).run(attemptId, candidate.id, candidate.account_id, workerId, fencingToken, claimedAt);
      this.database.prepare(`
        INSERT INTO job_events
          (id, workspace_id, job_id, job_type, event_type, detail, created_at)
        VALUES (?, ?, ?, 'publishing', 'claimed', ?, ?)
      `).run(
        automationId("event"),
        candidate.workspace_id,
        candidate.id,
        JSON.stringify({ workerId, fencingToken, attemptId }),
        claimedAt,
      );
      const claimed = this.database.prepare("SELECT * FROM publishing_jobs WHERE id = ?").get(candidate.id) as PublishingJobRow;
      claimed.platform = candidate.platform;
      return publicJob(claimed);
    });
  }

  heartbeatPublishingJob(jobId: string, workerId: string, fencingToken: number, leaseSeconds = 300) {
    try {
      return withImmediateTransaction(this.database, () => {
        const heartbeatAt = now();
        const expiresAt = leaseExpiry(leaseSeconds);
        const job = this.database.prepare("SELECT account_id FROM publishing_jobs WHERE id = ?").get(jobId) as
          | { account_id: string }
          | undefined;
        if (!job) throw new PublishingLeaseLostError();
        const lockUpdate = this.database.prepare(`
          UPDATE account_execution_locks
          SET lease_expires_at = ?, updated_at = ?
          WHERE account_id = ? AND lease_owner = ? AND fencing_token = ? AND lease_expires_at > ?
        `).run(expiresAt, heartbeatAt, job.account_id, workerId, fencingToken, heartbeatAt);
        if (lockUpdate.changes !== 1) throw new PublishingLeaseLostError();
        const jobUpdate = this.database.prepare(`
          UPDATE publishing_jobs
          SET lease_expires_at = ?, updated_at = ?
          WHERE id = ? AND lease_owner = ? AND fencing_token = ?
            AND state IN ('PUBLISHING', 'VERIFYING')
        `).run(expiresAt, heartbeatAt, jobId, workerId, fencingToken);
        if (jobUpdate.changes !== 1) throw new PublishingLeaseLostError();
        return true;
      });
    } catch (error) {
      if (error instanceof PublishingLeaseLostError) return false;
      throw error;
    }
  }

  getPublishingProfileState(accountId: string) {
    const row = this.database.prepare(`
      SELECT version, last_saved_at FROM browser_profiles WHERE account_id = ?
    `).get(accountId) as { version: number; last_saved_at: string | null } | undefined;
    return row ? { version: row.version, lastSavedAt: row.last_saved_at } : null;
  }

  completePublishingDryRun(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    valid: boolean;
    checks: string[];
    issues: string[];
  }) {
    return withImmediateTransaction(this.database, () => {
      const completedAt = now();
      const current = this.database.prepare(`
        SELECT job.*
        FROM publishing_jobs job
        JOIN account_execution_locks account_lock ON account_lock.account_id = job.account_id
        WHERE job.id = ? AND job.execution_mode = 'DRY_RUN'
          AND job.validation_stage = 'LOCAL'
          AND job.lease_owner = ? AND job.fencing_token = ?
          AND account_lock.lease_owner = ? AND account_lock.fencing_token = ?
          AND account_lock.lease_expires_at > ?
      `).get(
        input.jobId,
        input.workerId,
        input.fencingToken,
        input.workerId,
        input.fencingToken,
        completedAt,
      ) as PublishingJobRow | undefined;
      if (!current) throw new Error("The dry-run publishing lease is no longer owned by this worker.");

      const errorCode = input.valid ? "DRY_RUN_COMPLETE" : "DRY_RUN_VALIDATION_FAILED";
      const errorMessage = input.valid
        ? "Dry-run checks passed. No social platform was opened and no post was published."
        : `Dry-run validation failed: ${input.issues.join(" ")}`;
      this.database.prepare(`
        UPDATE publishing_jobs
        SET state = 'CANCELLED', error_code = ?, error_message = ?,
            lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(errorCode, errorMessage, completedAt, input.jobId);
      this.database.prepare(`
        UPDATE account_execution_locks
        SET lease_owner = NULL, lease_expires_at = ?, updated_at = ?
        WHERE account_id = ? AND lease_owner = ? AND fencing_token = ?
      `).run(new Date(0).toISOString(), completedAt, current.account_id, input.workerId, input.fencingToken);
      const detail = JSON.stringify({
        dryRun: true,
        valid: input.valid,
        checks: input.checks,
        issues: input.issues,
        networkAccess: false,
        published: false,
      });
      this.database.prepare(`
        UPDATE publishing_attempts
        SET state = ?, completed_at = ?, detail = ?
        WHERE job_id = ? AND worker_id = ? AND fencing_token = ?
      `).run(
        input.valid ? "DRY_RUN_COMPLETE" : "DRY_RUN_VALIDATION_FAILED",
        completedAt,
        detail,
        input.jobId,
        input.workerId,
        input.fencingToken,
      );
      this.database.prepare(`
        INSERT INTO job_events
          (id, workspace_id, job_id, job_type, event_type, detail, created_at)
        VALUES (?, ?, ?, 'publishing', 'dry_run_completed', ?, ?)
      `).run(automationId("event"), current.workspace_id, current.id, detail, completedAt);
      const row = this.database.prepare("SELECT * FROM publishing_jobs WHERE id = ?").get(input.jobId) as PublishingJobRow;
      return publicJob(row);
    });
  }

  completePublishingPreview(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    valid: boolean;
    checks: string[];
    issues: string[];
    screenshotKey?: string;
    loginRequired?: boolean;
  }) {
    return withImmediateTransaction(this.database, () => {
      const completedAt = now();
      const current = this.database.prepare(`
        SELECT job.*
        FROM publishing_jobs job
        JOIN account_execution_locks account_lock ON account_lock.account_id = job.account_id
        WHERE job.id = ? AND job.execution_mode = 'DRY_RUN'
          AND job.validation_stage = 'INSTAGRAM_PREVIEW'
          AND job.lease_owner = ? AND job.fencing_token = ?
          AND account_lock.lease_owner = ? AND account_lock.fencing_token = ?
          AND account_lock.lease_expires_at > ?
      `).get(
        input.jobId,
        input.workerId,
        input.fencingToken,
        input.workerId,
        input.fencingToken,
        completedAt,
      ) as PublishingJobRow | undefined;
      if (!current) throw new Error("The preview publishing lease is no longer owned by this worker.");

      const errorCode = input.valid
        ? "PREVIEW_COMPLETE"
        : input.loginRequired ? "PREVIEW_LOGIN_REQUIRED" : "PREVIEW_FAILED";
      const errorMessage = input.valid
        ? "Instagram composer preview prepared and closed before Share. Nothing was published."
        : `Instagram preview failed: ${input.issues.join(" ")}`;
      this.database.prepare(`
        UPDATE publishing_jobs
        SET state = 'CANCELLED', error_code = ?, error_message = ?,
            lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(errorCode, errorMessage, completedAt, input.jobId);
      this.database.prepare(`
        UPDATE account_execution_locks
        SET lease_owner = NULL, lease_expires_at = ?, updated_at = ?
        WHERE account_id = ? AND lease_owner = ? AND fencing_token = ?
      `).run(new Date(0).toISOString(), completedAt, current.account_id, input.workerId, input.fencingToken);
      if (input.loginRequired) {
        this.database.prepare(`
          UPDATE social_accounts SET status = 'LOGIN_REQUIRED', updated_at = ? WHERE id = ?
        `).run(completedAt, current.account_id);
      }
      const detail = JSON.stringify({
        preview: true,
        valid: input.valid,
        checks: input.checks,
        issues: input.issues,
        screenshotKey: input.screenshotKey || null,
        networkAccess: true,
        finalShareClicked: false,
        published: false,
      });
      this.database.prepare(`
        UPDATE publishing_attempts
        SET state = ?, completed_at = ?, detail = ?
        WHERE job_id = ? AND worker_id = ? AND fencing_token = ?
      `).run(errorCode, completedAt, detail, input.jobId, input.workerId, input.fencingToken);
      this.database.prepare(`
        INSERT INTO job_events
          (id, workspace_id, job_id, job_type, event_type, detail, created_at)
        VALUES (?, ?, ?, 'publishing', 'preview_completed', ?, ?)
      `).run(automationId("event"), current.workspace_id, current.id, detail, completedAt);
      const row = this.database.prepare("SELECT * FROM publishing_jobs WHERE id = ?").get(input.jobId) as PublishingJobRow;
      return publicJob(row);
    });
  }

  finishPublishingJob(input: {
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
    return withImmediateTransaction(this.database, () => {
      const completedAt = now();
      const current = this.database.prepare(`
        SELECT job.*
        FROM publishing_jobs job
        JOIN account_execution_locks account_lock ON account_lock.account_id = job.account_id
        WHERE job.id = ?
          AND job.lease_owner = ? AND job.fencing_token = ?
          AND account_lock.lease_owner = ? AND account_lock.fencing_token = ?
          AND account_lock.lease_expires_at > ?
      `).get(
        input.jobId,
        input.workerId,
        input.fencingToken,
        input.workerId,
        input.fencingToken,
        completedAt,
      ) as PublishingJobRow | undefined;
      if (!current) throw new Error("The publishing lease is no longer owned by this worker.");
      assertPublishingJobTransition(current.state, targetState);

      this.database.prepare(`
        UPDATE publishing_jobs
        SET state = ?, platform_post_id = ?, platform_post_url = ?, error_code = ?, error_message = ?,
            lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(
        targetState,
        input.platformPostId || null,
        input.platformPostUrl || null,
        input.errorCode || null,
        input.errorMessage || null,
        completedAt,
        input.jobId,
      );
      this.database.prepare(`
        UPDATE account_execution_locks
        SET lease_owner = NULL, lease_expires_at = ?, updated_at = ?
        WHERE account_id = ? AND lease_owner = ? AND fencing_token = ?
      `).run(new Date(0).toISOString(), completedAt, current.account_id, input.workerId, input.fencingToken);
      this.database.prepare(`
        UPDATE publishing_attempts
        SET state = ?, completed_at = ?, detail = ?
        WHERE job_id = ? AND worker_id = ? AND fencing_token = ?
      `).run(
        targetState,
        completedAt,
        JSON.stringify({
          platformPostId: input.platformPostId || null,
          platformPostUrl: input.platformPostUrl || null,
          errorCode: input.errorCode || null,
          errorMessage: input.errorMessage || null,
        }),
        input.jobId,
        input.workerId,
        input.fencingToken,
      );
      this.database.prepare(`
        INSERT INTO job_events
          (id, workspace_id, job_id, job_type, event_type, detail, created_at)
        VALUES (?, ?, ?, 'publishing', ?, ?, ?)
      `).run(
        automationId("event"),
        current.workspace_id,
        current.id,
        targetState.toLowerCase(),
        JSON.stringify({ fencingToken: input.fencingToken }),
        completedAt,
      );
      const row = this.database.prepare("SELECT * FROM publishing_jobs WHERE id = ?").get(input.jobId) as PublishingJobRow;
      return publicJob(row);
    });
  }

  quarantineExpiredPublishingJobs() {
    return withImmediateTransaction(this.database, () => {
      const checkedAt = now();
      const rows = this.database.prepare(`
        SELECT * FROM publishing_jobs
        WHERE state IN ('PUBLISHING', 'VERIFYING') AND lease_expires_at <= ?
      `).all(checkedAt) as unknown as PublishingJobRow[];
      for (const row of rows) {
        const nonPublishing = row.execution_mode === "DRY_RUN";
        const finalState = nonPublishing ? "CANCELLED" : "UNCERTAIN";
        const errorCode = nonPublishing ? "VALIDATION_LEASE_EXPIRED" : "WORKER_LEASE_EXPIRED";
        const errorMessage = nonPublishing
          ? "The non-publishing validation worker stopped. Nothing was published; run the check again."
          : "The worker lease expired during publishing. Verify the platform before retrying.";
        this.database.prepare(`
          UPDATE publishing_jobs
          SET state = ?, error_code = ?, error_message = ?,
              lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
          WHERE id = ?
        `).run(finalState, errorCode, errorMessage, checkedAt, row.id);
        this.database.prepare(`
          UPDATE account_execution_locks
          SET lease_owner = NULL, lease_expires_at = ?, updated_at = ?
          WHERE account_id = ? AND fencing_token = ?
        `).run(new Date(0).toISOString(), checkedAt, row.account_id, row.fencing_token);
        this.database.prepare(`
          UPDATE publishing_attempts
          SET state = ?, completed_at = ?, detail = ?
          WHERE job_id = ? AND fencing_token = ? AND completed_at IS NULL
        `).run(
          finalState,
          checkedAt,
          JSON.stringify({
            errorCode,
            published: false,
            finalShareClicked: nonPublishing ? false : null,
          }),
          row.id,
          row.fencing_token,
        );
        this.database.prepare(`
          INSERT INTO job_events
            (id, workspace_id, job_id, job_type, event_type, detail, created_at)
          VALUES (?, ?, ?, 'publishing', 'lease_expired', ?, ?)
        `).run(
          automationId("event"),
          row.workspace_id,
          row.id,
          JSON.stringify({ fencingToken: row.fencing_token, errorCode }),
          checkedAt,
        );
      }
      return rows.map(row => {
        const current = this.database.prepare("SELECT * FROM publishing_jobs WHERE id = ?").get(row.id) as PublishingJobRow;
        return publicJob(current);
      });
    });
  }
}
