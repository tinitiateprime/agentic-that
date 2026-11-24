export function runAsAuditUser<T>(username: string | null | undefined, fn: () => T): T;
export function runWithAuditScope<T>(fn: () => T): T;
export function setAuditUsername(username: string | null | undefined): void;
export function currentAuditUsername(rawSql?: unknown): Promise<string | null>;
export function withAudit<T>(sql: T): T;
