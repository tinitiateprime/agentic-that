import type { AutomationDatabase } from "./database.ts";
import { withImmediateTransaction } from "./database.ts";
import { automationId, type LoginSessionState, type LoginSurface, type SocialPlatform } from "./contracts.ts";
export type { LoginSurface } from "./contracts.ts";

export type LoginAccount = {
  id: string;
  workspaceId: string;
  platform: Extract<SocialPlatform, "instagram" | "facebook" | "x" | "linkedin" | "youtube">;
  displayName: string;
};

type LoginSessionRow = {
  id: string;
  workspace_id: string;
  account_id: string;
  platform: Extract<SocialPlatform, "instagram" | "facebook" | "x" | "linkedin" | "youtube">;
  surface: LoginSurface;
  state: LoginSessionState;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function publicSession(row: LoginSessionRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    accountId: row.account_id,
    platform: row.platform,
    surface: row.surface,
    state: row.state,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export type PublicLoginSession = ReturnType<typeof publicSession>;

export class AutomationLoginStore {
  constructor(private readonly database: AutomationDatabase) {}

  getProfileVersion(workspaceId: string, accountId: string) {
    const profile = this.database.prepare(`
      SELECT profile.version
      FROM browser_profiles profile
      JOIN social_accounts account ON account.id = profile.account_id
      WHERE profile.account_id = ? AND account.workspace_id = ?
    `).get(accountId, workspaceId) as { version: number } | undefined;
    if (!profile) throw new Error("The login account browser profile metadata is missing.");
    return profile.version;
  }

  recoverInterruptedSessions() {
    return withImmediateTransaction(this.database, () => {
      const recoveredAt = new Date().toISOString();
      const rows = this.database.prepare(`
        SELECT * FROM login_sessions WHERE state IN ('STARTING', 'AWAITING_USER')
      `).all() as unknown as LoginSessionRow[];
      for (const row of rows) {
        this.database.prepare(`
          UPDATE login_sessions
          SET state = 'FAILED', error_code = 'SERVER_RESTARTED',
              error_message = 'The local automation server stopped during login. Start login again.',
              updated_at = ?, completed_at = ?
          WHERE id = ?
        `).run(recoveredAt, recoveredAt, row.id);
        this.database.prepare(`
          UPDATE social_accounts SET status = 'LOGIN_REQUIRED', updated_at = ?
          WHERE id = ? AND status <> 'CONNECTED'
        `).run(recoveredAt, row.account_id);
      }
      return rows.length;
    });
  }

  createOrGetSession(workspaceId: string, accountId: string, surface: LoginSurface = "visible") {
    if (!workspaceId.trim()) throw new Error("workspaceId is required.");
    return withImmediateTransaction(this.database, () => {
      const accountRow = this.database.prepare(`
        SELECT id, workspace_id, platform, display_name
        FROM social_accounts
        WHERE id = ? AND workspace_id = ? AND enabled = 1
      `).get(accountId, workspaceId) as
        | { id: string; workspace_id: string; platform: string; display_name: string }
        | undefined;
      if (!accountRow) throw new Error("The selected server login account is unavailable.");
      if (!["instagram", "facebook", "x", "linkedin", "youtube"].includes(accountRow.platform)) {
        throw new Error("Server login is not enabled for this platform yet.");
      }
      const now = new Date().toISOString();
      const publishingLock = this.database.prepare(`
        SELECT account_id FROM account_execution_locks
        WHERE account_id = ? AND lease_owner IS NOT NULL AND lease_expires_at > ?
      `).get(accountId, now);
      if (publishingLock) {
        throw new Error("This account is currently being used by a publishing worker. Try login again afterward.");
      }
      const account: LoginAccount = {
        id: accountRow.id,
        workspaceId: accountRow.workspace_id,
        platform: accountRow.platform as LoginAccount["platform"],
        displayName: accountRow.display_name,
      };
      const active = this.database.prepare(`
        SELECT * FROM login_sessions
        WHERE account_id = ? AND state IN ('STARTING', 'AWAITING_USER')
        ORDER BY created_at DESC LIMIT 1
      `).get(accountId) as LoginSessionRow | undefined;
      if (active) return { session: publicSession(active), account, created: false };

      const id = automationId("login");
      const createdAt = now;
      this.database.prepare(`
        INSERT INTO login_sessions
          (id, workspace_id, account_id, platform, surface, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'STARTING', ?, ?)
      `).run(id, workspaceId, accountId, account.platform, surface, createdAt, createdAt);
      const row = this.database.prepare("SELECT * FROM login_sessions WHERE id = ?").get(id) as LoginSessionRow;
      return { session: publicSession(row), account, created: true };
    });
  }

  getSession(workspaceId: string, sessionId: string) {
    const row = this.database.prepare(`
      SELECT * FROM login_sessions WHERE id = ? AND workspace_id = ?
    `).get(sessionId, workspaceId) as LoginSessionRow | undefined;
    return row ? publicSession(row) : null;
  }

  getSessionForShutdown(sessionId: string) {
    const row = this.database.prepare("SELECT * FROM login_sessions WHERE id = ?").get(sessionId) as LoginSessionRow | undefined;
    return row ? publicSession(row) : null;
  }

  markAwaitingUser(sessionId: string) {
    this.transitionActive(sessionId, "AWAITING_USER");
  }

  markConnected(sessionId: string, savedProfile?: {
    version: number;
    etag: string | null;
    contentSha256?: string;
    encryptedSizeBytes?: number;
    encryptionKeyId?: string;
    encryptionKeyVersion?: string;
  } | null) {
    return withImmediateTransaction(this.database, () => {
      const completedAt = new Date().toISOString();
      const session = this.activeSession(sessionId);
      this.database.prepare(`
        UPDATE login_sessions
        SET state = 'CONNECTED', error_code = NULL, error_message = NULL,
            updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(completedAt, completedAt, sessionId);
      this.database.prepare(`
        UPDATE social_accounts SET status = 'CONNECTED', updated_at = ? WHERE id = ?
      `).run(completedAt, session.account_id);
      const profile = this.database.prepare(`SELECT version FROM browser_profiles WHERE account_id = ?`)
        .get(session.account_id) as { version: number } | undefined;
      if (!profile) throw new Error("The login account browser profile metadata is missing.");
      const nextVersion = savedProfile?.version ?? profile.version + 1;
      if (nextVersion !== profile.version + 1) throw new Error("The saved login profile version is not the next expected version.");
      const updated = this.database.prepare(`
        UPDATE browser_profiles
        SET version = ?, blob_etag = ?, content_sha256 = ?, encrypted_size_bytes = ?,
            encryption_key_id = ?, encryption_key_version = ?,
            encryption_state = CASE WHEN ? IS NULL THEN encryption_state ELSE 'ENCRYPTED' END,
            last_saved_at = ?, updated_at = ?
        WHERE account_id = ? AND version = ?
      `).run(
        nextVersion,
        savedProfile?.etag || null,
        savedProfile?.contentSha256 || null,
        savedProfile?.encryptedSizeBytes ?? null,
        savedProfile?.encryptionKeyId || null,
        savedProfile?.encryptionKeyVersion || null,
        savedProfile ? 1 : null,
        completedAt,
        completedAt,
        session.account_id,
        profile.version,
      );
      if (updated.changes !== 1) throw new Error("The browser profile changed before login completion.");
      return this.getRequiredSession(sessionId);
    });
  }

  markFailed(sessionId: string, state: "FAILED" | "EXPIRED", code: string, message: string) {
    return withImmediateTransaction(this.database, () => {
      const completedAt = new Date().toISOString();
      const session = this.activeSession(sessionId);
      this.database.prepare(`
        UPDATE login_sessions
        SET state = ?, error_code = ?, error_message = ?, updated_at = ?, completed_at = ?
        WHERE id = ?
      `).run(state, code, message, completedAt, completedAt, sessionId);
      this.database.prepare(`
        UPDATE social_accounts SET status = 'LOGIN_REQUIRED', updated_at = ?
        WHERE id = ? AND status <> 'CONNECTED'
      `).run(completedAt, session.account_id);
      return this.getRequiredSession(sessionId);
    });
  }

  cancel(sessionId: string, workspaceId: string) {
    return withImmediateTransaction(this.database, () => {
      const row = this.database.prepare(`
        SELECT * FROM login_sessions WHERE id = ? AND workspace_id = ?
      `).get(sessionId, workspaceId) as LoginSessionRow | undefined;
      if (!row) return null;
      if (!["STARTING", "AWAITING_USER"].includes(row.state)) return publicSession(row);
      const completedAt = new Date().toISOString();
      this.database.prepare(`
        UPDATE login_sessions SET state = 'CANCELLED', updated_at = ?, completed_at = ? WHERE id = ?
      `).run(completedAt, completedAt, sessionId);
      return this.getRequiredSession(sessionId);
    });
  }

  private transitionActive(sessionId: string, state: "AWAITING_USER") {
    const updatedAt = new Date().toISOString();
    const result = this.database.prepare(`
      UPDATE login_sessions SET state = ?, updated_at = ?
      WHERE id = ? AND state IN ('STARTING', 'AWAITING_USER')
    `).run(state, updatedAt, sessionId);
    if (result.changes !== 1) throw new Error("The login session is no longer active.");
    return this.getRequiredSession(sessionId);
  }

  private activeSession(sessionId: string) {
    const row = this.database.prepare(`
      SELECT * FROM login_sessions WHERE id = ? AND state IN ('STARTING', 'AWAITING_USER')
    `).get(sessionId) as LoginSessionRow | undefined;
    if (!row) throw new Error("The login session is no longer active.");
    return row;
  }

  private getRequiredSession(sessionId: string) {
    const row = this.database.prepare("SELECT * FROM login_sessions WHERE id = ?").get(sessionId) as LoginSessionRow | undefined;
    if (!row) throw new Error("The login session was not found.");
    return publicSession(row);
  }
}
