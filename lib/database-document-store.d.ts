export function isDatabaseDocumentStoreConfigured(): boolean;

export function initializeDatabaseDocument<T>(
  key: string,
  initialValue: T | (() => T | Promise<T>)
): Promise<void>;

export function readDatabaseDocument<T = unknown>(key: string): Promise<T | null>;

export function mutateDatabaseDocument<T, R>(
  key: string,
  initialValue: T,
  operation: (value: unknown) =>
    | { document: T; result: R }
    | Promise<{ document: T; result: R }>
): Promise<R>;
