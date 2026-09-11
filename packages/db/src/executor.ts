export type SqlMethod = 'run' | 'all' | 'values' | 'get';

/**
 * Transport to a SQLite connection. Rows are arrays of column values:
 * 'get' resolves to one row or undefined, 'all' and 'values' to an array of rows, 'run' to [].
 */
export interface SqlExecutor {
  query(sql: string, params: unknown[], method: SqlMethod): Promise<unknown>;
  execScript(sql: string): Promise<void>;
  exportBytes(): Promise<Uint8Array>;
  importBytes(bytes: Uint8Array): Promise<void>;
}
