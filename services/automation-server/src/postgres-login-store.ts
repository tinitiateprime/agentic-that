import { automationId, type LoginSessionState, type LoginSurface, type SocialPlatform } from "./contracts.ts";
import type { AutomationPostgres } from "./postgres-database.ts";
import type { LoginAccount, PublicLoginSession } from "./login-store.ts";

type Queryable = Pick<AutomationPostgres, "unsafe">;

type LoginSessionRow = {
  id: string;
  workspace_id: string;
  account_id: string;
  platform: Extract<SocialPlatform, "instagram" | "facebook" | "x" | "linkedin" | "youtube">;
  surface: LoginSurface;
  state: LoginSessionState;
  error_code: string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
};

function iso(value: Date | string | null) {
  return value === null ? null : new Date(value).toISOString();
}

function publicSession(row: LoginSessionRow): PublicLoginSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    platform: row.platform,
    surface: row.surface,
    state: row.state,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    completedAt: iso(row.completed_at),
  };
}

async function rows<T extends object>(database: Queryable, statement: string, parameters: unknown[] = []) {
  return await database.unsafe<T[]>(statement, parameters as never[]);
}

async function row<T extends object>(database: Queryable, statement: string, parameters: unknown[] = []) {
  return (await rows<T>(database, statement, parameters))[0];
}

export class PostgresAutomationLoginStore {
  constructor(private readonly database: AutomationPostgres) {}

  async getProfileVersion(workspaceId: string, accountId: string) {
    const profile = await row<{ version: string | number }>(this.database, `
      SELECT profile.version
      FROM browser_profiles profile
      JOIN social_accounts account ON account.id = profile.account_id
      WHERE profile.account_id = $1 AND account.workspace_id = $2
    `, [accountId, workspaceId]);
    if (!profile) throw new Error("The login account browser profile metadata is missing.");
    return Number(profile.version);
  }

  async recoverInterruptedSessions() {
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const interrupted = await rows<LoginSessionRow>(tx, `
        SELECT * FROM login_sessions
        WHERE state IN ('STARTING', 'AWAITING_USER')
        FOR UPDATE SKIP LOCKED
      `);
      if (!interrupted.length) return 0;
      const ids = interrupted.map(session => session.id);
      await rows(tx, `
        UPDATE login_sessions
        SET state = 'FAILED', error_code = 'SERVER_RESTARTED',
            error_message = 'The automation server stopped during login. Start login again.',
            updated_at = clock_timestamp(), completed_at = clock_timestamp()
        WHERE id = ANY($1::text[])
      `, [ids]);
      const accountIds = interrupted.map(session => session.account_id);
      await rows(tx, `
        UPDATE social_accounts SET status = 'LOGIN_REQUIRED', updated_at = clock_timestamp()
        WHERE id = ANY($1::text[]) AND status <> 'CONNECTED'
      `, [accountIds]);
      return interrupted.length;
    });
  }

  async createOrGetSession(workspaceId: string, accountId: string, surface: LoginSurface = "visible") {
    if (!workspaceId.trim()) throw new Error("workspaceId is required.");
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const accountRow = await row<{
        id: string;
        workspace_id: string;
        platform: LoginAccount["platform"];
        display_name: string;
      }>(tx, `
        SELECT id, workspace_id, platform, display_name
        FROM social_accounts
        WHERE id = $1 AND workspace_id = $2 AND enabled = true
        FOR UPDATE
      `, [accountId, workspaceId]);
      if (!accountRow) throw new Error("The selected server login account is unavailable.");
      const publishingLock = await row<{ account_id: string }>(tx, `
        SELECT account_id FROM account_execution_locks
        WHERE account_id = $1 AND lease_owner IS NOT NULL AND lease_expires_at > clock_timestamp()
      `, [accountId]);
      if (publishingLock) throw new Error("This account is currently being used by a publishing worker. Try login again afterward.");
      const account: LoginAccount = {
        id: accountRow.id,
        workspaceId: accountRow.workspace_id,
        platform: accountRow.platform,
        displayName: accountRow.display_name,
      };
      const active = await row<LoginSessionRow>(tx, `
        SELECT * FROM login_sessions
        WHERE account_id = $1 AND state IN ('STARTING', 'AWAITING_USER')
        ORDER BY created_at DESC LIMIT 1
      `, [accountId]);
      if (active) return { session: publicSession(active), account, created: false };
      const id = automationId("login");
      const created = await row<LoginSessionRow>(tx, `
        INSERT INTO login_sessions (id, workspace_id, account_id, platform, surface, state)
        VALUES ($1, $2, $3, $4, $5, 'STARTING')
        RETURNING *
      `, [id, workspaceId, accountId, account.platform, surface]);
      if (!created) throw new Error("The login session was not created.");
      return { session: publicSession(created), account, created: true };
    });
  }

  async getSession(workspaceId: string, sessionId: string) {
    const found = await row<LoginSessionRow>(this.database, `
      SELECT * FROM login_sessions WHERE id = $1 AND workspace_id = $2
    `, [sessionId, workspaceId]);
    return found ? publicSession(found) : null;
  }

  async getSessionForShutdown(sessionId: string) {
    const found = await row<LoginSessionRow>(this.database, "SELECT * FROM login_sessions WHERE id = $1", [sessionId]);
    return found ? publicSession(found) : null;
  }

  async markAwaitingUser(sessionId: string) {
    await this.transitionActive(sessionId, "AWAITING_USER");
  }

  async markConnected(sessionId: string, savedProfile?: {
    version: number;
    etag: string | null;
    contentSha256?: string;
    encryptedSizeBytes?: number;
    encryptionKeyId?: string;
    encryptionKeyVersion?: string;
  } | null) {
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const session = await this.activeSession(tx, sessionId);
      await rows(tx, `
        UPDATE login_sessions
        SET state = 'CONNECTED', error_code = NULL, error_message = NULL,
            updated_at = clock_timestamp(), completed_at = clock_timestamp()
        WHERE id = $1
      `, [sessionId]);
      await rows(tx, `
        UPDATE social_accounts SET status = 'CONNECTED', updated_at = clock_timestamp() WHERE id = $1
      `, [session.account_id]);
      const profile = await row<{ version: string | number }>(tx, `
        SELECT version FROM browser_profiles WHERE account_id = $1 FOR UPDATE
      `, [session.account_id]);
      if (!profile) throw new Error("The login account browser profile metadata is missing.");
      const currentVersion = Number(profile.version);
      const nextVersion = savedProfile?.version ?? currentVersion + 1;
      if (nextVersion !== currentVersion + 1) throw new Error("The saved login profile version is not the next expected version.");
      const updatedProfile = await row<{ account_id: string }>(tx, `
        UPDATE browser_profiles
        SET version = $2, blob_etag = $3, content_sha256 = $6,
            encrypted_size_bytes = $7, encryption_key_id = $8, encryption_key_version = $9,
            encryption_state = CASE WHEN $4::boolean THEN 'ENCRYPTED' ELSE encryption_state END,
            last_saved_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE account_id = $1 AND version = $5
        RETURNING account_id
      `, [
        session.account_id,
        nextVersion,
        savedProfile?.etag || null,
        Boolean(savedProfile),
        currentVersion,
        savedProfile?.contentSha256 || null,
        savedProfile?.encryptedSizeBytes ?? null,
        savedProfile?.encryptionKeyId || null,
        savedProfile?.encryptionKeyVersion || null,
      ]);
      if (!updatedProfile) throw new Error("The browser profile changed before login completion.");
      return await this.getRequiredSession(tx, sessionId);
    });
  }

  async markFailed(sessionId: string, state: "FAILED" | "EXPIRED", code: string, message: string) {
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const session = await this.activeSession(tx, sessionId);
      await rows(tx, `
        UPDATE login_sessions
        SET state = $2, error_code = $3, error_message = $4,
            updated_at = clock_timestamp(), completed_at = clock_timestamp()
        WHERE id = $1
      `, [sessionId, state, code, message]);
      await rows(tx, `
        UPDATE social_accounts SET status = 'LOGIN_REQUIRED', updated_at = clock_timestamp()
        WHERE id = $1 AND status <> 'CONNECTED'
      `, [session.account_id]);
      return await this.getRequiredSession(tx, sessionId);
    });
  }

  async cancel(sessionId: string, workspaceId: string) {
    return await this.database.begin(async transaction => {
      const tx = transaction as unknown as Queryable;
      const found = await row<LoginSessionRow>(tx, `
        SELECT * FROM login_sessions WHERE id = $1 AND workspace_id = $2 FOR UPDATE
      `, [sessionId, workspaceId]);
      if (!found) return null;
      if (!["STARTING", "AWAITING_USER"].includes(found.state)) return publicSession(found);
      const cancelled = await row<LoginSessionRow>(tx, `
        UPDATE login_sessions
        SET state = 'CANCELLED', updated_at = clock_timestamp(), completed_at = clock_timestamp()
        WHERE id = $1 RETURNING *
      `, [sessionId]);
      if (!cancelled) throw new Error("The login session was not cancelled.");
      return publicSession(cancelled);
    });
  }

  private async transitionActive(sessionId: string, state: "AWAITING_USER") {
    const updated = await row<LoginSessionRow>(this.database, `
      UPDATE login_sessions SET state = $2, updated_at = clock_timestamp()
      WHERE id = $1 AND state IN ('STARTING', 'AWAITING_USER')
      RETURNING *
    `, [sessionId, state]);
    if (!updated) throw new Error("The login session is no longer active.");
    return publicSession(updated);
  }

  private async activeSession(database: Queryable, sessionId: string) {
    const found = await row<LoginSessionRow>(database, `
      SELECT * FROM login_sessions
      WHERE id = $1 AND state IN ('STARTING', 'AWAITING_USER')
      FOR UPDATE
    `, [sessionId]);
    if (!found) throw new Error("The login session is no longer active.");
    return found;
  }

  private async getRequiredSession(database: Queryable, sessionId: string) {
    const found = await row<LoginSessionRow>(database, "SELECT * FROM login_sessions WHERE id = $1", [sessionId]);
    if (!found) throw new Error("The login session was not found.");
    return publicSession(found);
  }
}
