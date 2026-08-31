import type { AutomationJobStore } from "./job-store.ts";
import type { AutomationLoginStore } from "./login-store.ts";

export type Awaitable<T> = T | Promise<T>;

type AwaitableMethods<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Awaitable<Awaited<Result>>
    : T[K];
};

/**
 * Production persistence is asynchronous while the isolated SQLite test store
 * remains synchronous. Consumers await this contract so both implementations
 * preserve the same observable behavior.
 */
export type AutomationJobStoreContract = AwaitableMethods<AutomationJobStore>;
export type AutomationLoginStoreContract = AwaitableMethods<AutomationLoginStore>;
