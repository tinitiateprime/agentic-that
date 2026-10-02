import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  isDatabaseDocumentStoreConfigured,
  mutateDatabaseDocument,
  readDatabaseDocument,
} from "./database-document-store.js";

const queues = new Map<string, Promise<unknown>>();

// PostgreSQL row locks serialize changes across AWS instances. JSON is only
// a development/Companion fallback; serverless deployments must have a database.
export class DurableDocumentStore<T> {
  constructor(
    private readonly key: string,
    private readonly file: string,
    private readonly empty: () => T,
    private readonly coerce: (value: unknown) => T,
  ) {}

  private database() {
    const configured = isDatabaseDocumentStoreConfigured();
    if (!configured && (process.env.SERVERLESS === "true" || process.env.HOSTING_PROVIDER === "aws-amplify")) {
      throw new Error("DATABASE_URL is required for persistent serverless storage.");
    }
    return configured;
  }

  async read(): Promise<T> {
    if (this.database()) return this.coerce(await readDatabaseDocument(this.key));
    try { return this.coerce(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.empty();
      throw error;
    }
  }

  async mutate<R>(operation: (document: T) => R | Promise<R>): Promise<R> {
    if (this.database()) {
      return mutateDatabaseDocument(this.key, this.empty(), async (value) => {
        const document = this.coerce(value);
        const result = await operation(document);
        return { document, result };
      });
    }
    const pending = (queues.get(this.file) || Promise.resolve()).then(async () => {
      const document = await this.read();
      const result = await operation(document);
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(document), { mode: 0o600 });
      await rename(temporary, this.file);
      return result;
    });
    queues.set(this.file, pending.catch(() => undefined));
    return pending;
  }
}
