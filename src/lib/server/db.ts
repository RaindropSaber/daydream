import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { databasePath } from "./storage-paths";
export { databasePath } from "./storage-paths";

export type QueryResult = { rows: Record<string, any>[]; rowCount: number };
export type DB = {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
};
type Connection = {
  raw: DatabaseSync;
  direct: DB;
  queue: Promise<unknown>;
  context: AsyncLocalStorage<DB>;
  client: DB & { end(): Promise<void> };
};
const state = globalThis as typeof globalThis & {
  frameflowSQLite?: Connection;
};
const jsonColumns = new Set([
  "metadata",
  "content",
  "inputs",
  "data",
  "report",
]);

function bind(value: unknown): SQLInputValue {
  if (value == null) return null;
  if (typeof value === "boolean") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && !(value instanceof Uint8Array))
    return JSON.stringify(value);
  return value as SQLInputValue;
}
function open(): Connection {
  if (state.frameflowSQLite) return state.frameflowSQLite;
  const file = databasePath();
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const raw = new DatabaseSync(file);
  chmodSync(file, 0o600);
  raw.exec(
    "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
  );
  const direct: DB = {
    async query(sql, values = []) {
      const parameters = Object.fromEntries(
        values.map((value, index) => [`$${index + 1}`, bind(value)]),
      );
      const statement = raw.prepare(sql);
      if (!statement.columns().length) {
        const result = statement.run(parameters);
        return { rows: [], rowCount: Number(result.changes) };
      }
      const rows = statement.all(parameters).map((row) => {
        const result: Record<string, any> = { ...row };
        for (const [key, value] of Object.entries(result)) {
          if (jsonColumns.has(key) && typeof value === "string")
            result[key] = JSON.parse(value);
          if (key === "approved") result[key] = Boolean(value);
        }
        return result;
      });
      return { rows, rowCount: rows.length };
    },
    async exec(sql) {
      raw.exec(sql);
    },
  };
  const connection: Connection = {
    raw,
    direct,
    queue: Promise.resolve(),
    context: new AsyncLocalStorage<DB>(),
    client: {
      query: (sql, values) =>
        connection.context.getStore()?.query(sql, values) ??
        serial(connection, () => direct.query(sql, values)),
      exec: (sql) =>
        connection.context.getStore()?.exec(sql) ??
        serial(connection, () => direct.exec(sql)),
      end: () =>
        serial(connection, async () => {
          raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
          raw.close();
          if (state.frameflowSQLite === connection)
            delete state.frameflowSQLite;
        }),
    },
  };
  state.frameflowSQLite = connection;
  return connection;
}
function serial<T>(connection: Connection, fn: () => Promise<T>): Promise<T> {
  const result = connection.queue.then(fn);
  connection.queue = result.catch(() => {});
  return result;
}
export function database() {
  return open().client;
}
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const connection = open();
  if (connection.context.getStore())
    throw new Error("Nested SQLite transactions are not supported");
  return serial(connection, async () => {
    const direct = connection.direct;
    connection.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = await connection.context.run(direct, () => fn(direct));
      connection.raw.exec("COMMIT");
      return result;
    } catch (error) {
      connection.raw.exec("ROLLBACK");
      throw error;
    }
  });
}
export async function migrate(through?: string) {
  await transaction(async (db) => {
    await db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    const folder = path.resolve("db/sqlite-migrations");
    for (const name of (await fs.readdir(folder))
      .filter((n) => n.endsWith(".sql") && (!through || n <= through))
      .sort()) {
      if (
        (
          await db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await db.exec(await fs.readFile(path.join(folder, name), "utf8"));
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    }
  });
}
