/** Copy a consistent PostgreSQL snapshot to an empty SQLite database. Source stays read-only. */
import { Client } from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { database, migrate, transaction } from "../src/lib/server/db";
import { dataDir } from "../src/lib/server/settings";
import { digest } from "../src/lib/domain";

const tables = [
  "projects",
  "episodes",
  "production_runs",
  "content_versions",
  "selected_versions",
  "assets",
  "asset_versions",
  "conversation_messages",
  "media_versions",
  "media_selections",
  "exports",
  "jobs",
  "settings",
  "legacy_imports",
] as const;
if (!process.env.DATABASE_URL)
  throw new Error("迁移需要原 PostgreSQL 的 DATABASE_URL");
const source = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
try {
  await source.connect();
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot: Record<string, Record<string, unknown>[]> = {};
  for (const table of tables)
    snapshot[table] = (await source.query(`SELECT * FROM ${table}`)).rows;
  await source.query("COMMIT");
  const folder = path.join(dataDir(), "backups");
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const backup = path.join(folder, `postgres-snapshot-${Date.now()}.json`);
  await fs.writeFile(backup, JSON.stringify(snapshot), {
    mode: 0o600,
    flag: "wx",
  });
  await migrate("001_initial.sql");
  await transaction(async (db) => {
    for (const table of tables) {
      if ((await db.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount)
        throw new Error(
          "目标 SQLite 已有数据，未覆盖。请使用 SQLITE_PATH 指定一个新文件。",
        );
    }
    // Resolve circular adopted-version/active-run references at commit.
    await db.exec("PRAGMA defer_foreign_keys=ON");
    for (const table of tables) {
      for (const row of snapshot[table]) {
        const columns = Object.keys(row);
        if (columns.some((column) => !/^[a-z_]+$/.test(column)))
          throw new Error("数据库列名无效");
        await db.query(
          `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map((_, index) => `$${index + 1}`).join(",")})`,
          Object.values(row),
        );
      }
      const copied = (await db.query(`SELECT * FROM ${table}`)).rows;
      const fingerprints = (rows: unknown[]) =>
        rows.map((row) => digest(JSON.parse(JSON.stringify(row)))).sort();
      if (
        digest(fingerprints(copied)) !== digest(fingerprints(snapshot[table]))
      )
        throw new Error(`${table} 数据内容不一致，已回滚`);
    }
    if ((await db.query("PRAGMA foreign_key_check")).rowCount)
      throw new Error("外键校验失败，已回滚");
  });
  await migrate();
  console.log(
    JSON.stringify(
      {
        imported: true,
        counts: Object.fromEntries(
          tables.map((table) => [table, snapshot[table].length]),
        ),
        backup,
      },
      null,
      2,
    ),
  );
} finally {
  await source.end();
  await database().end();
}
