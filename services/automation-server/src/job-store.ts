import type { AutomationSql } from "./database.ts";
import {
  assertPublishingJobTransition,
  automationId,
  createAccountSchema,
  createPublishingJobSchema,
  publishingJobStateSchema,
  type PublishingJobState,
} from "./contracts.ts";
import type { AutomationFileStore } from "./profile-store.ts";

type AccountRow = {
  id: string;
  workspace_id: string;
  platform: string;
  display_name: string;
  status: string;
  enabled: boolean;
  created_at: string | Date;
  updated_at: string | Date;
};

type PublishingJobRow = {
  id: string;
  workspace_id: string;
  account_id: string;
  state: PublishingJobState;
  scheduled_at: string | Date;
  original_timezone: string;
  caption: string;
  media: unknown;
  idempotency_key: string;
  lease_owner: string | null;
  lease_expires_at: string | Date | null;
  fencing_token: number | string | null;
  attempt_count: number;
  platform_post_id: string | null;
  platform_post_url: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

class PublishingLeaseLostError extends Error {}

function timestamp(value: string | Date | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicAccount(row: AccountRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    platform: row.platform,
    displayName: row.display_name,
    status: row.status,
    enabled: row.enabled,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function publicJob(row: PublishingJobRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    state: row.state,
    scheduledAt: timestamp(row.scheduled_at),
    originalTimezone: row.original_timezone,
    caption: row.caption,
    media: row.media,
    idempotencyKey: row.idempotency_key,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: timestamp(row.lease_expires_at),
    fencingToken: row.fencing_token === null ? null : Number(row.fencing_token),
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
    private readonly sql: AutomationSql,
    private readonly files: AutomationFileStore,
  ) {}

  async createAccount(input: unknown) {
    const value = createAccountSchema.parse(input);
    const id = automationId("account");
    const storageKey = this.files.profileStorageKey(id);
    await this.files.ensureDevelopmentProfile(id);
    const [row] = await this.sql.begin(async tx => {
      const rows = await tx<AccountRow[]>`
        INSERT INTO agentic_that_server.social_accounts
          (id, workspace_id, platform, display_name)
        VALUES (${id}, ${value.workspaceId}, ${value.platform}, ${value.displayName})
        RETURNING *`;
      await tx`
        INSERT INTO agentic_that_server.browser_profiles (account_id, storage_key)
        VALUES (${id}, ${storageKey})`;
      return rows;
    });
    return publicAccount(row);
  }

  async listAccounts(workspaceId: string) {
    const rows = await this.sql<AccountRow[]>`
      SELECT * FROM agentic_that_server.social_accounts
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC`;
    return rows.map(publicAccount);
  }

  async createPublishingJob(input: unknown) {
    const value = createPublishingJobSchema.parse(input);
    const [account] = await this.sql<AccountRow[]>`
      SELECT * FROM agentic_that_server.social_accounts
      WHERE id = ${value.accountId} AND workspace_id = ${value.workspaceId} AND enabled = true`;
    if (!account) throw new Error("The selected server publishing account is unavailable.");
    const id = automationId("job");
    const rows = await this.sql<PublishingJobRow[]>`
      INSERT INTO agentic_that_server.publishing_jobs
        (id, workspace_id, account_id, scheduled_at, original_timezone, caption, media, idempotency_key)
      VALUES (
        ${id}, ${value.workspaceId}, ${value.accountId}, ${value.scheduledAt},
        ${value.originalTimezone}, ${value.caption}, ${this.sql.json(value.media)}, ${value.idempotencyKey}
      )
      ON CONFLICT (workspace_id, idempotency_key) DO UPDATE
      SET updated_at = agentic_that_server.publishing_jobs.updated_at
      WHERE agentic_that_server.publishing_jobs.account_id = EXCLUDED.account_id
        AND agentic_that_server.publishing_jobs.scheduled_at = EXCLUDED.scheduled_at
        AND agentic_that_server.publishing_jobs.original_timezone = EXCLUDED.original_timezone
        AND agentic_that_server.publishing_jobs.caption = EXCLUDED.caption
        AND agentic_that_server.publishing_jobs.media = EXCLUDED.media
      RETURNING *`;
    const [row] = rows;
    if (!row) {
      throw new Error("The idempotency key is already used by a different publishing request.");
    }
    return publicJob(row);
  }

  async getPublishingJob(workspaceId: string, jobId: string) {
    const [row] = await this.sql<PublishingJobRow[]>`
      SELECT * FROM agentic_that_server.publishing_jobs
      WHERE id = ${jobId} AND workspace_id = ${workspaceId}`;
    return row ? publicJob(row) : null;
  }

  async claimDuePublishingJob(workerId: string, leaseSeconds = 300) {
    if (!workerId.trim()) throw new Error("A worker id is required to claim publishing work.");
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) {
      throw new Error("Publishing leases must be between 30 and 1800 seconds.");
    }

    return this.sql.begin(async tx => {
      const [candidate] = await tx<PublishingJobRow[]>`
        SELECT job.*
        FROM agentic_that_server.publishing_jobs job
        JOIN agentic_that_server.social_accounts account ON account.id = job.account_id
        LEFT JOIN agentic_that_server.account_execution_locks account_lock
          ON account_lock.account_id = job.account_id
        WHERE job.state = 'SCHEDULED'
          AND job.scheduled_at <= now()
          AND account.enabled = true
          AND account.status = 'CONNECTED'
          AND (account_lock.account_id IS NULL OR account_lock.lease_expires_at <= now())
        ORDER BY job.scheduled_at, job.created_at
        FOR UPDATE OF job SKIP LOCKED
        LIMIT 1`;
      if (!candidate) return null;

      const [lock] = await tx<{ fencing_token: number | string }[]>`
        INSERT INTO agentic_that_server.account_execution_locks
          (account_id, lease_owner, lease_expires_at, fencing_token, updated_at)
        VALUES (
          ${candidate.account_id}, ${workerId}, now() + (${leaseSeconds} * interval '1 second'), 1, now()
        )
        ON CONFLICT (account_id) DO UPDATE SET
          lease_owner = EXCLUDED.lease_owner,
          lease_expires_at = EXCLUDED.lease_expires_at,
          fencing_token = agentic_that_server.account_execution_locks.fencing_token + 1,
          updated_at = now()
        WHERE agentic_that_server.account_execution_locks.lease_expires_at <= now()
        RETURNING fencing_token`;
      if (!lock) return null;

      const fencingToken = Number(lock.fencing_token);
      const [claimed] = await tx<PublishingJobRow[]>`
        UPDATE agentic_that_server.publishing_jobs
        SET state = 'PUBLISHING',
            lease_owner = ${workerId},
            lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
            fencing_token = ${fencingToken},
            attempt_count = attempt_count + 1,
            updated_at = now()
        WHERE id = ${candidate.id} AND state = 'SCHEDULED'
        RETURNING *`;
      if (!claimed) return null;

      const attemptId = automationId("attempt");
      await tx`
        INSERT INTO agentic_that_server.publishing_attempts
          (id, job_id, account_id, worker_id, fencing_token, state)
        VALUES (${attemptId}, ${claimed.id}, ${claimed.account_id}, ${workerId}, ${fencingToken}, 'PUBLISHING')`;
      await tx`
        INSERT INTO agentic_that_server.job_events
          (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES (
          ${automationId("event")}, ${claimed.workspace_id}, ${claimed.id}, 'publishing', 'claimed',
          ${tx.json({ workerId, fencingToken, attemptId })}
        )`;
      return publicJob(claimed);
    });
  }

  async heartbeatPublishingJob(jobId: string, workerId: string, fencingToken: number, leaseSeconds = 300) {
    try {
      return await this.sql.begin(async tx => {
        const [lock] = await tx<{ account_id: string }[]>`
          UPDATE agentic_that_server.account_execution_locks account_lock
          SET lease_expires_at = now() + (${leaseSeconds} * interval '1 second'), updated_at = now()
          FROM agentic_that_server.publishing_jobs job
          WHERE job.id = ${jobId}
            AND job.account_id = account_lock.account_id
            AND account_lock.lease_owner = ${workerId}
            AND account_lock.fencing_token = ${fencingToken}
            AND account_lock.lease_expires_at > now()
          RETURNING account_lock.account_id`;
        if (!lock) throw new PublishingLeaseLostError();
        const rows = await tx`
          UPDATE agentic_that_server.publishing_jobs
          SET lease_expires_at = now() + (${leaseSeconds} * interval '1 second'), updated_at = now()
          WHERE id = ${jobId}
            AND lease_owner = ${workerId}
            AND fencing_token = ${fencingToken}
            AND state IN ('PUBLISHING', 'VERIFYING')
          RETURNING id`;
        if (rows.length !== 1) throw new PublishingLeaseLostError();
        return true;
      });
    } catch (error) {
      if (error instanceof PublishingLeaseLostError) return false;
      throw error;
    }
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
    return this.sql.begin(async tx => {
      const [current] = await tx<PublishingJobRow[]>`
        SELECT job.*
        FROM agentic_that_server.publishing_jobs job
        JOIN agentic_that_server.account_execution_locks account_lock
          ON account_lock.account_id = job.account_id
        WHERE job.id = ${input.jobId}
          AND job.lease_owner = ${input.workerId}
          AND job.fencing_token = ${input.fencingToken}
          AND account_lock.lease_owner = ${input.workerId}
          AND account_lock.fencing_token = ${input.fencingToken}
          AND account_lock.lease_expires_at > now()
        FOR UPDATE OF job, account_lock`;
      if (!current) throw new Error("The publishing lease is no longer owned by this worker.");
      assertPublishingJobTransition(current.state, targetState);
      const [row] = await tx<PublishingJobRow[]>`
        UPDATE agentic_that_server.publishing_jobs
        SET state = ${targetState},
            platform_post_id = ${input.platformPostId || null},
            platform_post_url = ${input.platformPostUrl || null},
            error_code = ${input.errorCode || null},
            error_message = ${input.errorMessage || null},
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE id = ${input.jobId}
        RETURNING *`;
      await tx`
        UPDATE agentic_that_server.account_execution_locks
        SET lease_owner = NULL, lease_expires_at = to_timestamp(0), updated_at = now()
        WHERE account_id = ${row.account_id}
          AND lease_owner = ${input.workerId}
          AND fencing_token = ${input.fencingToken}`;
      await tx`
        UPDATE agentic_that_server.publishing_attempts
        SET state = ${targetState}, completed_at = now(),
            detail = ${tx.json({
              platformPostId: input.platformPostId || null,
              platformPostUrl: input.platformPostUrl || null,
              errorCode: input.errorCode || null,
              errorMessage: input.errorMessage || null,
            })}
        WHERE job_id = ${input.jobId}
          AND worker_id = ${input.workerId}
          AND fencing_token = ${input.fencingToken}`;
      await tx`
        INSERT INTO agentic_that_server.job_events
          (id, workspace_id, job_id, job_type, event_type, detail)
        VALUES (
          ${automationId("event")}, ${row.workspace_id}, ${row.id}, 'publishing', ${targetState.toLowerCase()},
          ${tx.json({ fencingToken: input.fencingToken })}
        )`;
      return publicJob(row);
    });
  }

  async quarantineExpiredPublishingJobs() {
    return this.sql.begin(async tx => {
      const rows = await tx<PublishingJobRow[]>`
        UPDATE agentic_that_server.publishing_jobs
        SET state = 'UNCERTAIN',
            error_code = 'WORKER_LEASE_EXPIRED',
            error_message = 'The worker lease expired during publishing. Verify the platform before retrying.',
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
        WHERE state IN ('PUBLISHING', 'VERIFYING')
          AND lease_expires_at <= now()
        RETURNING *`;
      for (const row of rows) {
        await tx`
          UPDATE agentic_that_server.account_execution_locks
          SET lease_owner = NULL, lease_expires_at = to_timestamp(0), updated_at = now()
          WHERE account_id = ${row.account_id}
            AND fencing_token = ${Number(row.fencing_token)}`;
        await tx`
          UPDATE agentic_that_server.publishing_attempts
          SET state = 'UNCERTAIN', completed_at = now(),
              detail = detail || ${tx.json({ errorCode: "WORKER_LEASE_EXPIRED" })}
          WHERE job_id = ${row.id}
            AND fencing_token = ${Number(row.fencing_token)}
            AND completed_at IS NULL`;
        await tx`
          INSERT INTO agentic_that_server.job_events
            (id, workspace_id, job_id, job_type, event_type, detail)
          VALUES (
            ${automationId("event")}, ${row.workspace_id}, ${row.id}, 'publishing', 'lease_expired',
            ${tx.json({ fencingToken: Number(row.fencing_token) })}
          )`;
      }
      return rows.map(publicJob);
    });
  }
}
