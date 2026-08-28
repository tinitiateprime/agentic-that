import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, open, readFile, rename, stat, unlink, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { SecretCipher } from "./crypto.ts";

export type AppUser = {
  id: string;
  displayName: string;
  platformUserId?: string;
  workspaceId?: string;
  accessLevel?: "view" | "operate" | "configure";
};

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

export type SavedTelegramAccount = {
  account: TelegramAccount;
  transferred: boolean;
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

export type TelegramPostStatus = "Draft" | "Scheduled" | "Sending" | "Posted" | "Partially failed" | "Failed" | "Cancelled";

export type TelegramPostTarget = {
  recipient: string;
  source: string;
  firstName: string;
  kind: "manual" | "contact" | "group";
};

export type TelegramPostDelivery = TelegramPostTarget & {
  id: string;
  status: "Pending" | "Sending" | "Sent" | "Failed";
  sentAt: string;
  telegramMessageId: string;
  error: string;
};

export type TelegramPost = {
  id: string;
  accountId: string;
  title: string;
  type: string;
  category: string;
  tags: string[];
  status: TelegramPostStatus;
  scheduledAt: string;
  body: string;
  mediaUrl: string;
  mediaUploadId: string;
  mediaName: string;
  mediaMimeType: string;
  mediaSize: number;
  recipient: string;
  contacts: string[];
  groups: string[];
  targets: TelegramPostTarget[];
  deliveries: TelegramPostDelivery[];
  createdAt: string;
  updatedAt: string;
  sentAt: string;
  lastError: string;
};

export type TelegramPostInput = Omit<TelegramPost, "id" | "status" | "deliveries" | "createdAt" | "updatedAt" | "sentAt" | "lastError">;

export type ClaimedTelegramPost = TelegramPost & {
  ownerId: string;
  leaseOwner: string;
};

type MessageRecordInput = Omit<MessageRecord, "id" | "createdAt"> & { createdAt?: Date | string };

type AppUserRow = {
  id: string;
  displayName: string;
  tokenHash: string;
  configuredLogin: string;
  passwordHash?: string;
  platformWorkspaceId?: string;
  platformUserId?: string;
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

type TelegramPostRow = {
  id: string;
  userId: string;
  accountId: string;
  title: string;
  type: string;
  category: string;
  tags: string[];
  status: TelegramPostStatus;
  scheduledAt: string;
  bodyCiphertext: string;
  mediaUrlCiphertext: string;
  mediaUploadId: string;
  mediaName: string;
  mediaMimeType: string;
  mediaSize: number;
  recipientCiphertext: string;
  contactIds: string[];
  groupIds: string[];
  deliveriesCiphertext: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string;
  lastErrorCiphertext: string;
};

type JsonDatabase = {
  version: 2;
  appUsers: AppUserRow[];
  appSessions: BrowserSessionRow[];
  telegramAccounts: TelegramAccountRow[];
  telegramLoginChallenges: LoginChallengeRow[];
  telegramMessages: MessageRow[];
  telegramPosts: TelegramPostRow[];
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
    version: 2,
    appUsers: [],
    appSessions: [],
    telegramAccounts: [],
    telegramLoginChallenges: [],
    telegramMessages: [],
    telegramPosts: []
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
    version: 2,
    appUsers: Array.isArray(input.appUsers) ? input.appUsers as AppUserRow[] : [],
    appSessions: Array.isArray(input.appSessions) ? input.appSessions as BrowserSessionRow[] : [],
    telegramAccounts: Array.isArray(input.telegramAccounts) ? input.telegramAccounts as TelegramAccountRow[] : [],
    telegramLoginChallenges: Array.isArray(input.telegramLoginChallenges)
      ? input.telegramLoginChallenges as LoginChallengeRow[]
      : [],
    telegramMessages: Array.isArray(input.telegramMessages) ? input.telegramMessages as MessageRow[] : [],
    telegramPosts: Array.isArray(input.telegramPosts) ? input.telegramPosts as TelegramPostRow[] : []
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
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await chmod(this.dataDir, 0o700);
    try {
      await access(this.dataFile, fsConstants.F_OK);
      await chmod(this.dataFile, 0o600);
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

  async findOrCreatePlatformWorkspaceUser(
    workspaceId: string,
    platformUserId: string,
    displayName: string,
    accessLevel: "view" | "operate" | "configure"
  ): Promise<AppUser> {
    // Service-token authentication happens on every API request. Once a
    // workspace has been linked, resolving that identity must be read-only;
    // rewriting the shared Netlify Blob for every /me and /accounts request
    // causes needless write contention and can make an otherwise healthy
    // connected account appear unavailable.
    const database = await this.readDatabase();
    const linkedUser = database.appUsers.find((user) => user.platformWorkspaceId === workspaceId);
    if (linkedUser) {
      return {
        id: linkedUser.id,
        displayName: displayName || linkedUser.displayName,
        platformUserId,
        workspaceId,
        accessLevel
      };
    }

    return this.updateDatabase((database) => {
      // Recheck while holding the local mutation queue in case two first-time
      // requests for the same workspace arrived together.
      const existing = database.appUsers.find((user) => user.platformWorkspaceId === workspaceId);
      if (existing) {
        return {
          id: existing.id,
          displayName: displayName || existing.displayName,
          platformUserId,
          workspaceId,
          accessLevel
        };
      }

      const row: AppUserRow = {
        id: randomUUID(),
        displayName: displayName || "AgenticThat workspace",
        tokenHash: hashToken(`platform-workspace:${randomBytes(32).toString("base64url")}`),
        configuredLogin: "",
        platformWorkspaceId: workspaceId,
        platformUserId,
        createdAt: nowIso()
      };
      database.appUsers.push(row);
      return {
        id: row.id,
        displayName: row.displayName,
        platformUserId,
        workspaceId,
        accessLevel
      };
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
    input: { telegramApiId: number; telegramApiHash: string; telegramUserId: string; displayName: string; username: string; sessionString: string },
    options: { allowVerifiedTransfer?: boolean } = {}
  ): Promise<SavedTelegramAccount> {
    return this.updateDatabase((database) => {
      const existing = database.telegramAccounts.find((account) => account.telegramUserId === input.telegramUserId);
      const transferred = Boolean(existing && existing.userId !== userId);
      if (existing && existing.userId !== userId) {
        if (!options.allowVerifiedTransfer) {
          throw new AccountAlreadyLinkedError("This Telegram account is already linked to another app user.");
        }
        existing.userId = userId;
      }

      if (existing) {
        existing.displayName = input.displayName;
        existing.username = input.username || "";
        existing.telegramApiIdCiphertext = this.cipher.encrypt(String(input.telegramApiId));
        existing.telegramApiHashCiphertext = this.cipher.encrypt(input.telegramApiHash);
        existing.sessionCiphertext = this.cipher.encrypt(input.sessionString);
        existing.updatedAt = nowIso();
        return { account: this.toAccount(existing), transferred };
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
      return { account: this.toAccount(row), transferred: false };
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
      database.telegramPosts = database.telegramPosts.filter((post) => post.accountId !== accountId);
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

  async createPost(userId: string, input: TelegramPostInput): Promise<TelegramPost> {
    return this.updateDatabase((database) => {
      const account = database.telegramAccounts.find((row) => row.id === input.accountId && row.userId === userId);
      if (!account) throw new Error("Telegram account was not found.");
      const now = nowIso();
      const row: TelegramPostRow = {
        id: `telegram_post_${randomUUID().replaceAll("-", "")}`,
        userId,
        accountId: input.accountId,
        title: input.title,
        type: input.type,
        category: input.category,
        tags: [...input.tags],
        status: "Draft",
        scheduledAt: input.scheduledAt,
        bodyCiphertext: this.encryptPostText(input.body),
        mediaUrlCiphertext: this.encryptPostText(input.mediaUrl),
        mediaUploadId: input.mediaUploadId,
        mediaName: input.mediaName,
        mediaMimeType: input.mediaMimeType,
        mediaSize: input.mediaSize,
        recipientCiphertext: this.encryptPostText(input.recipient),
        contactIds: [...input.contacts],
        groupIds: [...input.groups],
        deliveriesCiphertext: this.encryptPostDeliveries(input.targets),
        leaseOwner: "",
        leaseExpiresAt: "",
        createdAt: now,
        updatedAt: now,
        sentAt: "",
        lastErrorCiphertext: this.encryptPostText("")
      };
      database.telegramPosts.push(row);
      return this.toTelegramPost(row);
    });
  }

  async updatePost(userId: string, postId: string, input: TelegramPostInput): Promise<TelegramPost | null> {
    return this.updateDatabase((database) => {
      const row = database.telegramPosts.find((post) => post.id === postId && post.userId === userId);
      if (!row) return null;
      if (row.status === "Scheduled" || row.status === "Sending") {
        throw new Error("Cancel this scheduled post before editing it.");
      }
      if (row.status === "Posted") {
        throw new Error("Copy a delivered post before editing or sending it again.");
      }
      const account = database.telegramAccounts.find((account) => account.id === input.accountId && account.userId === userId);
      if (!account) throw new Error("Telegram account was not found.");
      row.accountId = input.accountId;
      row.title = input.title;
      row.type = input.type;
      row.category = input.category;
      row.tags = [...input.tags];
      row.status = "Draft";
      row.scheduledAt = input.scheduledAt;
      row.bodyCiphertext = this.encryptPostText(input.body);
      row.mediaUrlCiphertext = this.encryptPostText(input.mediaUrl);
      row.mediaUploadId = input.mediaUploadId;
      row.mediaName = input.mediaName;
      row.mediaMimeType = input.mediaMimeType;
      row.mediaSize = input.mediaSize;
      row.recipientCiphertext = this.encryptPostText(input.recipient);
      row.contactIds = [...input.contacts];
      row.groupIds = [...input.groups];
      row.deliveriesCiphertext = this.encryptPostDeliveries(input.targets);
      row.leaseOwner = "";
      row.leaseExpiresAt = "";
      row.sentAt = "";
      row.lastErrorCiphertext = this.encryptPostText("");
      row.updatedAt = nowIso();
      return this.toTelegramPost(row);
    });
  }

  async listPosts(userId: string, accountId = ""): Promise<TelegramPost[]> {
    const database = await this.readDatabase();
    return database.telegramPosts
      .filter((post) => post.userId === userId && (!accountId || post.accountId === accountId))
      .sort((left, right) => parseIso(right.createdAt) - parseIso(left.createdAt))
      .map((post) => this.toTelegramPost(post));
  }

  async queuePost(userId: string, postId: string, scheduledAt: string): Promise<TelegramPost | null> {
    return this.updateDatabase((database) => {
      const row = database.telegramPosts.find((post) => post.id === postId && post.userId === userId);
      if (!row) return null;
      if (row.status === "Sending") throw new Error("This Telegram post is already sending.");
      if (row.status === "Posted") throw new Error("Copy a delivered post before sending it again.");
      const scheduledTime = parseIso(scheduledAt);
      if (!scheduledTime) throw new Error("A valid scheduled date and time is required.");
      const deliveries = this.decryptPostDeliveries(row);
      if (!deliveries.length) throw new Error("Choose at least one Telegram recipient.");
      if (!this.decryptPostText(row.bodyCiphertext).trim() && !this.decryptPostText(row.mediaUrlCiphertext).trim() && !row.mediaUploadId) {
        throw new Error("Add text or media before scheduling this post.");
      }
      row.status = "Scheduled";
      row.scheduledAt = new Date(scheduledTime).toISOString();
      row.deliveriesCiphertext = this.cipher.encrypt(JSON.stringify(deliveries.map((delivery) => ({
        ...delivery,
        status: "Pending",
        sentAt: "",
        telegramMessageId: "",
        error: ""
      }))));
      row.leaseOwner = "";
      row.leaseExpiresAt = "";
      row.sentAt = "";
      row.lastErrorCiphertext = this.encryptPostText("");
      row.updatedAt = nowIso();
      return this.toTelegramPost(row);
    });
  }

  async cancelPost(userId: string, postId: string): Promise<TelegramPost | null> {
    return this.updateDatabase((database) => {
      const row = database.telegramPosts.find((post) => post.id === postId && post.userId === userId);
      if (!row) return null;
      if (row.status !== "Scheduled") throw new Error("Only a waiting scheduled post can be cancelled.");
      row.status = "Cancelled";
      row.leaseOwner = "";
      row.leaseExpiresAt = "";
      row.updatedAt = nowIso();
      return this.toTelegramPost(row);
    });
  }

  async deletePost(userId: string, postId: string): Promise<boolean> {
    return this.updateDatabase((database) => {
      const row = database.telegramPosts.find((post) => post.id === postId && post.userId === userId);
      if (!row) return false;
      if (row.status === "Scheduled" || row.status === "Sending") {
        throw new Error("Cancel this scheduled post before deleting it.");
      }
      database.telegramPosts = database.telegramPosts.filter((post) => post.id !== postId);
      return true;
    });
  }

  async claimDuePost(workerId: string, now = new Date(), leaseMs = 120_000): Promise<ClaimedTelegramPost | null> {
    const nowTime = now.getTime();
    const snapshot = await this.readDatabase();
    const hasDuePost = snapshot.telegramPosts.some((post) => (
      (post.status === "Scheduled" && parseIso(post.scheduledAt) <= nowTime) ||
      (post.status === "Sending" && parseIso(post.leaseExpiresAt) <= nowTime)
    ));
    if (!hasDuePost) return null;

    return this.updateDatabase((database) => {
      const candidates = database.telegramPosts
        .filter((post) => (
          (post.status === "Scheduled" && parseIso(post.scheduledAt) <= nowTime) ||
          (post.status === "Sending" && parseIso(post.leaseExpiresAt) <= nowTime)
        ))
        .sort((left, right) => parseIso(left.scheduledAt) - parseIso(right.scheduledAt));
      for (const row of candidates) {
        const accountBusy = database.telegramPosts.some((post) => (
          post.id !== row.id && post.accountId === row.accountId && post.status === "Sending" && parseIso(post.leaseExpiresAt) > nowTime
        ));
        if (accountBusy) continue;
        let deliveries = this.decryptPostDeliveries(row);
        if (row.status === "Sending") {
          deliveries = deliveries.map((delivery) => delivery.status === "Sending" ? {
            ...delivery,
            status: "Failed",
            error: "The previous server process stopped before delivery confirmation. This recipient was not retried to prevent a duplicate message."
          } : delivery);
          row.deliveriesCiphertext = this.cipher.encrypt(JSON.stringify(deliveries));
        }
        if (!deliveries.some((delivery) => delivery.status === "Pending")) {
          this.finalizePostRow(row, deliveries);
          continue;
        }
        row.status = "Sending";
        row.leaseOwner = workerId;
        row.leaseExpiresAt = new Date(nowTime + leaseMs).toISOString();
        row.updatedAt = now.toISOString();
        return { ...this.toTelegramPost(row), ownerId: row.userId, leaseOwner: workerId };
      }
      return null;
    });
  }

  async renewPostLease(postId: string, workerId: string, leaseMs = 120_000): Promise<boolean> {
    return this.updateDatabase((database) => {
      const row = database.telegramPosts.find((post) => (
        post.id === postId && post.status === "Sending" && post.leaseOwner === workerId
      ));
      if (!row) return false;
      row.leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      row.updatedAt = nowIso();
      return true;
    });
  }

  async claimNextPostDelivery(postId: string, workerId: string): Promise<TelegramPostDelivery | null> {
    return this.updateDatabase((database) => {
      const row = database.telegramPosts.find((post) => post.id === postId && post.status === "Sending" && post.leaseOwner === workerId);
      if (!row || parseIso(row.leaseExpiresAt) <= Date.now()) return null;
      const deliveries = this.decryptPostDeliveries(row);
      const delivery = deliveries.find((item) => item.status === "Pending");
      if (!delivery) return null;
      delivery.status = "Sending";
      row.deliveriesCiphertext = this.cipher.encrypt(JSON.stringify(deliveries));
      row.updatedAt = nowIso();
      return { ...delivery };
    });
  }

  async completePostDelivery(
    postId: string,
    workerId: string,
    deliveryId: string,
    result: { status: "Sent" | "Failed"; sentAt?: string; telegramMessageId?: string; error?: string }
  ): Promise<boolean> {
    return this.updateDatabase((database) => {
      const row = database.telegramPosts.find((post) => post.id === postId && post.status === "Sending" && post.leaseOwner === workerId);
      if (!row) return false;
      const deliveries = this.decryptPostDeliveries(row);
      const delivery = deliveries.find((item) => item.id === deliveryId && item.status === "Sending");
      if (!delivery) return false;
      delivery.status = result.status;
      delivery.sentAt = result.sentAt || (result.status === "Sent" ? nowIso() : "");
      delivery.telegramMessageId = result.telegramMessageId || "";
      delivery.error = (result.error || "").slice(0, 1000);
      row.deliveriesCiphertext = this.cipher.encrypt(JSON.stringify(deliveries));
      row.leaseExpiresAt = new Date(Date.now() + 120_000).toISOString();
      row.updatedAt = nowIso();
      return true;
    });
  }

  async finishClaimedPost(postId: string, workerId: string): Promise<TelegramPost | null> {
    return this.updateDatabase((database) => {
      const row = database.telegramPosts.find((post) => post.id === postId && post.status === "Sending" && post.leaseOwner === workerId);
      if (!row) return null;
      const deliveries = this.decryptPostDeliveries(row);
      if (deliveries.some((delivery) => delivery.status === "Pending" || delivery.status === "Sending")) {
        throw new Error("Telegram post still has unfinished recipients.");
      }
      this.finalizePostRow(row, deliveries);
      return this.toTelegramPost(row);
    });
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

    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await chmod(this.dataDir, 0o700);
    const tempFile = path.join(this.dataDir, `store.${process.pid}.${Date.now()}.tmp`);
    await writeFile(tempFile, `${JSON.stringify(database, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempFile, this.dataFile);
    await chmod(this.dataFile, 0o600);
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.useNetlifyBlobs) return operation();

    let handle: FileHandle | null = null;
    const startedAt = Date.now();
    while (!handle) {
      try {
        await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
        handle = await open(this.lockFile, "wx", 0o600);
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

  private encryptPostDeliveries(targets: TelegramPostTarget[]) {
    const deliveries: TelegramPostDelivery[] = targets.map((target) => ({
      ...target,
      id: `telegram_delivery_${randomUUID().replaceAll("-", "")}`,
      status: "Pending",
      sentAt: "",
      telegramMessageId: "",
      error: ""
    }));
    return this.cipher.encrypt(JSON.stringify(deliveries));
  }

  private encryptPostText(value: string) {
    return this.cipher.encrypt(JSON.stringify(value));
  }

  private decryptPostText(value: string) {
    return JSON.parse(this.cipher.decrypt(value)) as string;
  }

  private decryptPostDeliveries(row: Pick<TelegramPostRow, "deliveriesCiphertext">): TelegramPostDelivery[] {
    try {
      const value = JSON.parse(this.cipher.decrypt(row.deliveriesCiphertext)) as unknown;
      return Array.isArray(value) ? value as TelegramPostDelivery[] : [];
    } catch {
      return [];
    }
  }

  private finalizePostRow(row: TelegramPostRow, deliveries: TelegramPostDelivery[]) {
    const sent = deliveries.filter((delivery) => delivery.status === "Sent");
    const failed = deliveries.filter((delivery) => delivery.status === "Failed");
    row.status = sent.length === deliveries.length
      ? "Posted"
      : sent.length > 0
        ? "Partially failed"
        : "Failed";
    row.sentAt = sent.length ? sent.map((delivery) => delivery.sentAt).filter(Boolean).sort().at(-1) || nowIso() : "";
    row.lastErrorCiphertext = this.encryptPostText(failed.map((delivery) => `${delivery.recipient}: ${delivery.error}`).join("; ").slice(0, 4000));
    row.leaseOwner = "";
    row.leaseExpiresAt = "";
    row.updatedAt = nowIso();
  }

  private toTelegramPost(row: TelegramPostRow): TelegramPost {
    const deliveries = this.decryptPostDeliveries(row);
    return {
      id: row.id,
      accountId: row.accountId,
      title: row.title,
      type: row.type,
      category: row.category,
      tags: [...row.tags],
      status: row.status,
      scheduledAt: row.scheduledAt,
      body: this.decryptPostText(row.bodyCiphertext),
      mediaUrl: this.decryptPostText(row.mediaUrlCiphertext),
      mediaUploadId: row.mediaUploadId,
      mediaName: row.mediaName,
      mediaMimeType: row.mediaMimeType,
      mediaSize: row.mediaSize,
      recipient: this.decryptPostText(row.recipientCiphertext),
      contacts: [...row.contactIds],
      groups: [...row.groupIds],
      targets: deliveries.map(({ id: _id, status: _status, sentAt: _sentAt, telegramMessageId: _telegramMessageId, error: _error, ...target }) => target),
      deliveries,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      sentAt: row.sentAt,
      lastError: this.decryptPostText(row.lastErrorCiphertext)
    };
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
