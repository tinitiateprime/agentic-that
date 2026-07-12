import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, open, readFile, rename, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { SecretCipher } from "./crypto.ts";

export type AppUser = { id: string; displayName: string };

export type TelegramAccount = {
  id: string;
  telegramUserId: string;
  displayName: string;
  username: string;
  createdAt: string;
  updatedAt: string;
};

export type TelegramAccountWithSession = TelegramAccount & {
  telegramApiId: number;
  telegramApiHash: string;
  sessionString: string;
};

export type LoginChallenge = {
  id: string;
  telegramApiId: number;
  telegramApiHash: string;
  phone: string;
  phoneCodeHash: string;
  sessionString: string;
  status: "code_sent" | "password_required";
  expiresAt: string;
};

export type MessageRecord = {
  id: string;
  accountId: string;
  direction: "inbound" | "outbound";
  recipient: string;
  text: string;
  telegramMessageId: string;
  createdAt: string;
};

type MessageRecordInput = Omit<MessageRecord, "id" | "createdAt"> & { createdAt?: Date | string };

type AppUserRow = {
  id: string;
  displayName: string;
  tokenHash: string;
  configuredLogin: string;
  passwordHash?: string;
  createdAt: string;
};

type BrowserSessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
};

type TelegramAccountRow = {
  id: string;
  userId: string;
  telegramUserId: string;
  displayName: string;
  username: string;
  telegramApiIdCiphertext?: string;
  telegramApiHashCiphertext?: string;
  sessionCiphertext: string;
  createdAt: string;
  updatedAt: string;
};

type LoginChallengeRow = {
  id: string;
  userId: string;
  telegramApiIdCiphertext?: string;
  telegramApiHashCiphertext?: string;
  phoneCiphertext: string;
  phoneCodeHashCiphertext: string;
  sessionCiphertext: string;
  status: "code_sent" | "password_required";
  expiresAt: string;
  createdAt: string;
};

type MessageRow = {
  id: string;
  accountId: string;
  direction: "inbound" | "outbound";
  recipientCiphertext: string;
  textCiphertext: string;
  telegramMessageId: string;
  createdAt: string;
};

type JsonDatabase = {
  version: 1;
  appUsers: AppUserRow[];
  appSessions: BrowserSessionRow[];
  telegramAccounts: TelegramAccountRow[];
  telegramLoginChallenges: LoginChallengeRow[];
  telegramMessages: MessageRow[];
};

export class AccountAlreadyLinkedError extends Error {}

type BlobStore = {
  get: (key: string, options?: { type?: "json"; consistency?: string }) => Promise<unknown>;
  setJSON: (key: string, value: unknown, options?: { onlyIfNew?: boolean }) => Promise<unknown>;
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const passwordKey = (username: string) => `password:${username.trim().toLowerCase()}`;
const asIso = (value: Date) => value.toISOString();
const nowIso = () => new Date().toISOString();
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const shouldUseNetlifyBlobs = () => (
  process.env.DATA_STORE === "netlify-blobs" ||
  process.env.NETLIFY === "true" ||
  Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
);

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = scryptSync(password, salt, 32).toString("base64url");
  return `scrypt:v1:${salt}:${key}`;
}

function verifyPassword(password: string, storedHash = "") {
  const [algorithm, version, salt, expectedKey] = storedHash.split(":");
  if (algorithm !== "scrypt" || version !== "v1" || !salt || !expectedKey) return false;
  const expected = Buffer.from(expectedKey, "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function emptyDatabase(): JsonDatabase {
  return {
    version: 1,
    appUsers: [],
    appSessions: [],
    telegramAccounts: [],
    telegramLoginChallenges: [],
    telegramMessages: []
  };
}

function parseIso(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeCreatedAt(value: Date | string | undefined) {
  if (!value) return nowIso();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? asIso(date) : nowIso();
}

function coerceDatabase(raw: unknown): JsonDatabase {
  if (!raw || typeof raw !== "object") return emptyDatabase();
  const input = raw as Partial<JsonDatabase>;
  return {
    version: 1,
    appUsers: Array.isArray(input.appUsers) ? input.appUsers as AppUserRow[] : [],
    appSessions: Array.isArray(input.appSessions) ? input.appSessions as BrowserSessionRow[] : [],
    telegramAccounts: Array.isArray(input.telegramAccounts) ? input.telegramAccounts as TelegramAccountRow[] : [],
    telegramLoginChallenges: Array.isArray(input.telegramLoginChallenges)
      ? input.telegramLoginChallenges as LoginChallengeRow[]
      : [],
    telegramMessages: Array.isArray(input.telegramMessages) ? input.telegramMessages as MessageRow[] : []
  };
}

export class MultiUserStore {
  private readonly dataDir: string;
  private readonly dataFile: string;
  private readonly lockFile: string;
  private readonly cipher: SecretCipher;
  private readonly useNetlifyBlobs: boolean;
  private blobStorePromise: Promise<BlobStore> | null = null;
  private queue = Promise.resolve();

  constructor(dataDir: string, sessionEncryptionKey: string) {
    this.dataDir = path.resolve(process.cwd(), dataDir || "data");
    this.dataFile = path.join(this.dataDir, "store.json");
    this.lockFile = path.join(this.dataDir, "store.lock");
    this.cipher = new SecretCipher(sessionEncryptionKey);
    this.useNetlifyBlobs = shouldUseNetlifyBlobs();
  }

  async initialize() {
    if (this.useNetlifyBlobs) {
      const store = await this.getBlobStore();
      const existing = await store.get("store", { type: "json", consistency: "strong" });
      if (!existing) await store.setJSON("store", emptyDatabase(), { onlyIfNew: true });
      return;
    }
    await mkdir(this.dataDir, { recursive: true });
    try {
      await access(this.dataFile, fsConstants.F_OK);
    } catch {
      await this.writeDatabase(emptyDatabase());
    }
  }

  async close() {
    await this.queue;
  }

  async createUser(displayName: string) {
    const id = randomUUID();
    const accessToken = `tgr_${randomBytes(32).toString("base64url")}`;
    const user: AppUser = { id, displayName };
    await this.updateDatabase((database) => {
      database.appUsers.push({
        id,
        displayName,
        tokenHash: hashToken(accessToken),
        configuredLogin: "",
        createdAt: nowIso()
      });
      return null;
    });
    return { user, accessToken };
  }

  async createPasswordUser(username: string, password: string, displayName: string) {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) throw new Error("Username is required.");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");

    const accessToken = `tgr_${randomBytes(32).toString("base64url")}`;
    const loginId = passwordKey(normalizedUsername);
    return this.updateDatabase((database) => {
      if (database.appUsers.some((user) => user.configuredLogin === loginId)) {
        throw new Error("Username is already taken.");
      }

      const row: AppUserRow = {
        id: randomUUID(),
        displayName: displayName.trim() || username.trim(),
        tokenHash: hashToken(accessToken),
        configuredLogin: loginId,
        passwordHash: hashPassword(password),
        createdAt: nowIso()
      };
      database.appUsers.push(row);
      return { user: { id: row.id, displayName: row.displayName }, accessToken };
    });
  }

  async findUserByPassword(username: string, password: string): Promise<AppUser | null> {
    const database = await this.readDatabase();
    const loginId = passwordKey(username);
    const row = database.appUsers.find((user) => user.configuredLogin === loginId);
    return row && verifyPassword(password, row.passwordHash) ? { id: row.id, displayName: row.displayName } : null;
  }

  async findOrCreateConfiguredUser(loginId: string, displayName: string): Promise<AppUser> {
    return this.updateDatabase((database) => {
      const existing = database.appUsers.find((user) => user.configuredLogin === loginId);
      if (existing) {
        existing.displayName = displayName;
        return { id: existing.id, displayName: existing.displayName };
      }

      const row: AppUserRow = {
        id: randomUUID(),
        displayName,
        tokenHash: hashToken(`configured-login:${randomBytes(32).toString("base64url")}`),
        configuredLogin: loginId,
        createdAt: nowIso()
      };
      database.appUsers.push(row);
      return { id: row.id, displayName: row.displayName };
    });
  }

  async findUserByAccessToken(accessToken: string): Promise<AppUser | null> {
    const database = await this.readDatabase();
    const row = database.appUsers.find((user) => user.tokenHash === hashToken(accessToken));
    return row ? { id: row.id, displayName: row.displayName } : null;
  }

  async createBrowserSession(accessToken: string, ttlHours: number) {
    const user = await this.findUserByAccessToken(accessToken);
    if (!user) return null;
    return this.createBrowserSessionForUser(user, ttlHours);
  }

  async createBrowserSessionForUser(user: AppUser, ttlHours: number) {
    const id = randomUUID();
    const sessionToken = `tgs_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60_000);
    await this.updateDatabase((database) => {
      database.appSessions = database.appSessions.filter((session) => parseIso(session.expiresAt) > Date.now());
      database.appSessions.push({
        id,
        userId: user.id,
        tokenHash: hashToken(sessionToken),
        expiresAt: asIso(expiresAt),
        createdAt: nowIso()
      });
      return null;
    });
    return { user, sessionToken, expiresAt: asIso(expiresAt) };
  }

  async findUserByBrowserSession(sessionToken: string): Promise<AppUser | null> {
    const database = await this.readDatabase();
    const session = database.appSessions.find((row) => (
      row.tokenHash === hashToken(sessionToken) && parseIso(row.expiresAt) > Date.now()
    ));
    if (!session) return null;
    const user = database.appUsers.find((row) => row.id === session.userId);
    return user ? { id: user.id, displayName: user.displayName } : null;
  }

  async deleteBrowserSession(sessionToken: string) {
    await this.updateDatabase((database) => {
      database.appSessions = database.appSessions.filter((session) => session.tokenHash !== hashToken(sessionToken));
      return null;
    });
  }

  async createLoginChallenge(
    userId: string,
    telegramApiId: number,
    telegramApiHash: string,
    phone: string,
    phoneCodeHash: string,
    sessionString: string,
    ttlMinutes: number
  ) {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    await this.updateDatabase((database) => {
      database.telegramLoginChallenges = database.telegramLoginChallenges.filter((challenge) => (
        parseIso(challenge.expiresAt) > Date.now() && challenge.userId !== userId
      ));
      database.telegramLoginChallenges.push({
        id,
        userId,
        telegramApiIdCiphertext: this.cipher.encrypt(String(telegramApiId)),
        telegramApiHashCiphertext: this.cipher.encrypt(telegramApiHash),
        phoneCiphertext: this.cipher.encrypt(phone),
        phoneCodeHashCiphertext: this.cipher.encrypt(phoneCodeHash),
        sessionCiphertext: this.cipher.encrypt(sessionString),
        status: "code_sent",
        expiresAt: asIso(expiresAt),
        createdAt: nowIso()
      });
      return null;
    });
    return { id, expiresAt: asIso(expiresAt) };
  }

  async getLoginChallenge(userId: string, challengeId: string): Promise<LoginChallenge | null> {
    return this.updateDatabase((database) => {
      const row = database.telegramLoginChallenges.find((challenge) => (
        challenge.id === challengeId && challenge.userId === userId
      ));
      if (!row) return null;
      if (parseIso(row.expiresAt) <= Date.now()) {
        database.telegramLoginChallenges = database.telegramLoginChallenges.filter((challenge) => challenge.id !== challengeId);
        return null;
      }
      return {
        id: row.id,
        telegramApiId: this.decryptTelegramApiId(row),
        telegramApiHash: this.decryptTelegramApiHash(row),
        phone: this.cipher.decrypt(row.phoneCiphertext),
        phoneCodeHash: this.cipher.decrypt(row.phoneCodeHashCiphertext),
        sessionString: this.cipher.decrypt(row.sessionCiphertext),
        status: row.status,
        expiresAt: row.expiresAt
      };
    });
  }

  async markPasswordRequired(userId: string, challengeId: string, sessionString: string) {
    await this.updateDatabase((database) => {
      const challenge = database.telegramLoginChallenges.find((row) => row.id === challengeId && row.userId === userId);
      if (challenge) {
        challenge.status = "password_required";
        challenge.sessionCiphertext = this.cipher.encrypt(sessionString);
      }
      return null;
    });
  }

  async deleteLoginChallenge(userId: string, challengeId: string) {
    await this.updateDatabase((database) => {
      database.telegramLoginChallenges = database.telegramLoginChallenges.filter((challenge) => (
        challenge.id !== challengeId || challenge.userId !== userId
      ));
      return null;
    });
  }

  async saveTelegramAccount(
    userId: string,
    input: { telegramApiId: number; telegramApiHash: string; telegramUserId: string; displayName: string; username: string; sessionString: string }
  ): Promise<TelegramAccount> {
    return this.updateDatabase((database) => {
      const existing = database.telegramAccounts.find((account) => account.telegramUserId === input.telegramUserId);
      if (existing && existing.userId !== userId) {
        throw new AccountAlreadyLinkedError("This Telegram account is already linked to another app user.");
      }

      if (existing) {
        existing.displayName = input.displayName;
        existing.username = input.username || "";
        existing.telegramApiIdCiphertext = this.cipher.encrypt(String(input.telegramApiId));
        existing.telegramApiHashCiphertext = this.cipher.encrypt(input.telegramApiHash);
        existing.sessionCiphertext = this.cipher.encrypt(input.sessionString);
        existing.updatedAt = nowIso();
        return this.toAccount(existing);
      }

      const createdAt = nowIso();
      const row: TelegramAccountRow = {
        id: randomUUID(),
        userId,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        username: input.username || "",
        telegramApiIdCiphertext: this.cipher.encrypt(String(input.telegramApiId)),
        telegramApiHashCiphertext: this.cipher.encrypt(input.telegramApiHash),
        sessionCiphertext: this.cipher.encrypt(input.sessionString),
        createdAt,
        updatedAt: createdAt
      };
      database.telegramAccounts.push(row);
      return this.toAccount(row);
    });
  }

  async listAccounts(userId: string): Promise<TelegramAccount[]> {
    const database = await this.readDatabase();
    return database.telegramAccounts
      .filter((account) => account.userId === userId)
      .sort((left, right) => parseIso(left.createdAt) - parseIso(right.createdAt))
      .map((account) => this.toAccount(account));
  }

  async getAccountWithSession(userId: string, accountId: string): Promise<TelegramAccountWithSession | null> {
    const database = await this.readDatabase();
    const account = database.telegramAccounts.find((row) => row.id === accountId && row.userId === userId);
    return account ? this.toAccountWithSession(account) : null;
  }

  async getAllAccountsWithSessions(): Promise<TelegramAccountWithSession[]> {
    const database = await this.readDatabase();
    return database.telegramAccounts
      .sort((left, right) => parseIso(left.createdAt) - parseIso(right.createdAt))
      .map((account) => this.toAccountWithSession(account));
  }

  async deleteAccount(userId: string, accountId: string): Promise<TelegramAccountWithSession | null> {
    let deleted: TelegramAccountWithSession | null = null;
    await this.updateDatabase((database) => {
      const account = database.telegramAccounts.find((row) => row.id === accountId && row.userId === userId);
      if (!account) return null;
      deleted = this.toAccountWithSession(account);
      database.telegramAccounts = database.telegramAccounts.filter((row) => row.id !== accountId);
      database.telegramMessages = database.telegramMessages.filter((message) => message.accountId !== accountId);
      return null;
    });
    return deleted;
  }

  async recordMessage(input: MessageRecordInput): Promise<MessageRecord> {
    return this.updateDatabase((database) => {
      const duplicate = database.telegramMessages
        .filter((row) => (
          row.accountId === input.accountId &&
          row.direction === input.direction &&
          row.telegramMessageId === input.telegramMessageId
        ))
        .sort((left, right) => parseIso(left.createdAt) - parseIso(right.createdAt))
        .find((row) => this.cipher.decrypt(row.recipientCiphertext) === input.recipient);
      if (duplicate) return this.toMessageRecord(duplicate);

      const row: MessageRow = {
        id: randomUUID(),
        accountId: input.accountId,
        direction: input.direction,
        recipientCiphertext: this.cipher.encrypt(input.recipient),
        textCiphertext: this.cipher.encrypt(input.text),
        telegramMessageId: input.telegramMessageId,
        createdAt: normalizeCreatedAt(input.createdAt)
      };
      database.telegramMessages.push(row);
      return this.toMessageRecord(row);
    });
  }

  async listMessages(userId: string, accountId: string, limit = 50): Promise<MessageRecord[]> {
    const database = await this.readDatabase();
    const account = database.telegramAccounts.find((row) => row.id === accountId && row.userId === userId);
    if (!account) return [];
    const cappedLimit = Math.min(Math.max(limit, 1), 500);
    return database.telegramMessages
      .filter((message) => message.accountId === accountId)
      .sort((left, right) => parseIso(right.createdAt) - parseIso(left.createdAt))
      .slice(0, cappedLimit)
      .map((message) => this.toMessageRecord(message));
  }

  async issueAccessTokenForAccount(accountId: string) {
    const accessToken = `tgr_${randomBytes(32).toString("base64url")}`;
    const user = await this.updateDatabase((database) => {
      const account = database.telegramAccounts.find((row) => row.id === accountId);
      if (!account) return null;
      const owner = database.appUsers.find((row) => row.id === account.userId);
      if (!owner) return null;
      owner.tokenHash = hashToken(accessToken);
      return { id: owner.id, displayName: owner.displayName };
    });
    return user ? { user, accessToken } : null;
  }

  private async updateDatabase<T>(operation: (database: JsonDatabase) => T | Promise<T>): Promise<T> {
    const run = async () => this.withFileLock(async () => {
      const database = await this.readDatabase();
      const result = await operation(database);
      await this.writeDatabase(database);
      return result;
    });
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readDatabase(): Promise<JsonDatabase> {
    if (this.useNetlifyBlobs) {
      const store = await this.getBlobStore();
      const database = await store.get("store", { type: "json", consistency: "strong" });
      return coerceDatabase(database);
    }

    await mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await readFile(this.dataFile, "utf8");
      return coerceDatabase(JSON.parse(raw) as unknown);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return emptyDatabase();
      }
      throw error;
    }
  }

  private async writeDatabase(database: JsonDatabase) {
    if (this.useNetlifyBlobs) {
      const store = await this.getBlobStore();
      await store.setJSON("store", database);
      return;
    }

    await mkdir(this.dataDir, { recursive: true });
    const tempFile = path.join(this.dataDir, `store.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tempFile, `${JSON.stringify(database, null, 2)}\n`, "utf8");
    await rename(tempFile, this.dataFile);
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.useNetlifyBlobs) return operation();

    let handle: FileHandle | null = null;
    const startedAt = Date.now();
    while (!handle) {
      try {
        await mkdir(this.dataDir, { recursive: true });
        handle = await open(this.lockFile, "wx");
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
        await this.removeStaleLock();
        if (Date.now() - startedAt > 10_000) {
          throw new Error(`Timed out waiting for JSON datastore lock at ${this.lockFile}.`);
        }
        await sleep(50);
      }
    }

    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(this.lockFile).catch(() => undefined);
    }
  }

  private async removeStaleLock() {
    try {
      const info = await stat(this.lockFile);
      if (Date.now() - info.mtimeMs > 30_000) await unlink(this.lockFile);
    } catch {
      // Another process may have released the lock.
    }
  }

  private async getBlobStore(): Promise<BlobStore> {
    this.blobStorePromise ??= import("@netlify/blobs").then(({ getStore }) => getStore("agentic-that-telegram") as BlobStore);
    return this.blobStorePromise;
  }

  private toAccount(row: TelegramAccountRow): TelegramAccount {
    return {
      id: row.id,
      telegramUserId: row.telegramUserId,
      displayName: row.displayName,
      username: row.username,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private toAccountWithSession(row: TelegramAccountRow): TelegramAccountWithSession {
    return {
      ...this.toAccount(row),
      telegramApiId: this.decryptTelegramApiId(row),
      telegramApiHash: this.decryptTelegramApiHash(row),
      sessionString: this.cipher.decrypt(row.sessionCiphertext)
    };
  }

  private decryptTelegramApiId(row: Pick<TelegramAccountRow | LoginChallengeRow, "telegramApiIdCiphertext">) {
    if (!row.telegramApiIdCiphertext) return 0;
    const value = Number(this.cipher.decrypt(row.telegramApiIdCiphertext));
    return Number.isInteger(value) && value > 0 ? value : 0;
  }

  private decryptTelegramApiHash(row: Pick<TelegramAccountRow | LoginChallengeRow, "telegramApiHashCiphertext">) {
    return row.telegramApiHashCiphertext ? this.cipher.decrypt(row.telegramApiHashCiphertext) : "";
  }

  private toMessageRecord(row: MessageRow): MessageRecord {
    return {
      id: row.id,
      accountId: row.accountId,
      direction: row.direction,
      recipient: this.cipher.decrypt(row.recipientCiphertext),
      text: this.cipher.decrypt(row.textCiphertext),
      telegramMessageId: row.telegramMessageId,
      createdAt: row.createdAt
    };
  }
}
