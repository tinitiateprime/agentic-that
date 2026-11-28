export type ErrorLogDetails = {
  source?: string;
  kind?: string | null;
  method?: string | null;
  path?: string | null;
  route?: string | null;
  message?: string;
  errorName?: string;
  stack?: string | false | null;
  digest?: string | null;
  cookieHeader?: string | null;
  userId?: string | null;
  username?: string | null;
  workspaceId?: string | null;
  context?: Record<string, unknown>;
};

export function scrub(value: unknown, limit?: number): string;
export function logError(error: unknown, details?: ErrorLogDetails): Promise<number | null>;
export function logRequestError(
  error: unknown,
  request?: { path?: string; method?: string; headers?: unknown },
  context?: Record<string, unknown>
): Promise<number | null>;
