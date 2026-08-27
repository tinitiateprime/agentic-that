import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOAD_ID = /^telegram_media_[a-f0-9]{32}$/;
export const TELEGRAM_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;

type StoredTelegramMedia = {
  id: string;
  ownerId: string;
  accountId: string;
  fileName: string;
  mimeType: string;
  size: number;
  offset: number;
  createdAt: string;
  completedAt: string | null;
};

export type TelegramMediaUpload = Omit<StoredTelegramMedia, "ownerId" | "accountId">;
export type TelegramMediaFile = TelegramMediaUpload & { path: string };

function safeFileName(input: string) {
  const base = path.basename(input.trim() || "telegram-media.bin");
  return base.replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/^[-. ]+|[-. ]+$/g, "").slice(0, 160) || "telegram-media.bin";
}

function publicUpload(value: StoredTelegramMedia): TelegramMediaUpload {
  const { ownerId: _ownerId, accountId: _accountId, ...visible } = value;
  return visible;
}

export class TelegramMediaStore {
  private readonly root: string;
  private readonly operations = new Map<string, Promise<unknown>>();

  constructor(dataDir: string, private readonly maxBytes: number) {
    this.root = path.join(path.resolve(dataDir), "media-uploads");
  }

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  private paths(id: string) {
    if (!UPLOAD_ID.test(id)) throw new Error("Telegram media upload was not found.");
    return {
      metadata: path.join(this.root, `${id}.json`),
      partial: path.join(this.root, `${id}.part`),
      complete: path.join(this.root, `${id}.media`),
    };
  }

  private async locked<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(id) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.operations.set(id, current);
    try {
      return await current;
    } finally {
      if (this.operations.get(id) === current) this.operations.delete(id);
    }
  }

  private async readOwned(ownerId: string, accountId: string, id: string) {
    const paths = this.paths(id);
    let value: StoredTelegramMedia;
    try {
      value = JSON.parse(await readFile(paths.metadata, "utf8")) as StoredTelegramMedia;
    } catch {
      throw new Error("Telegram media upload was not found.");
    }
    if (value.id !== id || value.ownerId !== ownerId || value.accountId !== accountId) {
      throw new Error("Telegram media upload was not found.");
    }
    return { value, paths };
  }

  private async save(value: StoredTelegramMedia) {
    const { metadata } = this.paths(value.id);
    const temporary = `${metadata}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, metadata);
  }

  async create(ownerId: string, accountId: string, input: { fileName: string; mimeType: string; size: number }) {
    if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > this.maxBytes) {
      throw new Error(`Telegram media must be between 1 byte and ${this.maxBytes} bytes.`);
    }
    const id = `telegram_media_${randomUUID().replaceAll("-", "")}`;
    const paths = this.paths(id);
    const value: StoredTelegramMedia = {
      id,
      ownerId,
      accountId,
      fileName: safeFileName(input.fileName),
      mimeType: input.mimeType.trim().slice(0, 120) || "application/octet-stream",
      size: input.size,
      offset: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    await this.save(value);
    const handle = await open(paths.partial, "wx", 0o600);
    await handle.close();
    return publicUpload(value);
  }

  async append(ownerId: string, accountId: string, id: string, offset: number, chunk: Buffer) {
    return this.locked(id, async () => {
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Telegram media upload offset is invalid.");
      if (!chunk.length || chunk.length > TELEGRAM_MEDIA_CHUNK_BYTES) throw new Error("Telegram media upload chunks must be 4 MB or smaller.");
      const { value, paths } = await this.readOwned(ownerId, accountId, id);
      if (value.completedAt) throw new Error("Telegram media upload is already complete.");
      if (value.offset !== offset) throw new Error("Telegram media upload offset does not match the server.");
      if (offset + chunk.length > value.size) throw new Error("Telegram media upload exceeds its declared size.");
      const details = await stat(paths.partial).catch(() => null);
      if (!details?.isFile() || details.size !== offset) throw new Error("Telegram media upload data is incomplete.");
      const handle = await open(paths.partial, "r+");
      try {
        let written = 0;
        while (written < chunk.length) {
          const result = await handle.write(chunk, written, chunk.length - written, offset + written);
          if (!result.bytesWritten) throw new Error("Telegram media upload could not be written to server storage.");
          written += result.bytesWritten;
        }
      } finally {
        await handle.close();
      }
      value.offset += chunk.length;
      await this.save(value);
      return publicUpload(value);
    });
  }

  async complete(ownerId: string, accountId: string, id: string) {
    return this.locked(id, async () => {
      const { value, paths } = await this.readOwned(ownerId, accountId, id);
      if (value.completedAt) return publicUpload(value);
      const details = await stat(paths.partial).catch(() => null);
      if (!details?.isFile() || details.size !== value.size || value.offset !== value.size) {
        throw new Error("Telegram media upload has not finished.");
      }
      await rename(paths.partial, paths.complete);
      value.completedAt = new Date().toISOString();
      await this.save(value);
      return publicUpload(value);
    });
  }

  async resolve(ownerId: string, accountId: string, id: string): Promise<TelegramMediaFile> {
    const { value, paths } = await this.readOwned(ownerId, accountId, id);
    if (!value.completedAt) throw new Error("Telegram media upload has not finished.");
    const details = await stat(paths.complete).catch(() => null);
    if (!details?.isFile() || details.size !== value.size) throw new Error("Telegram media upload data is unavailable.");
    return { ...publicUpload(value), path: paths.complete };
  }

  async remove(ownerId: string, accountId: string, id: string) {
    return this.locked(id, async () => {
      const { paths } = await this.readOwned(ownerId, accountId, id);
      await Promise.all([
        rm(paths.metadata, { force: true }),
        rm(paths.partial, { force: true }),
        rm(paths.complete, { force: true }),
      ]);
    });
  }

  async removeAccountUploads(ownerId: string, accountId: string) {
    const entries = await readdir(this.root).catch(() => []);
    for (const entry of entries) {
      const match = /^(telegram_media_[a-f0-9]{32})\.json$/.exec(entry);
      if (!match) continue;
      const owned = await this.readOwned(ownerId, accountId, match[1]).catch(() => null);
      if (owned) await this.remove(ownerId, accountId, match[1]);
    }
  }
}
