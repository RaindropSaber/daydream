import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { database, migrate, transaction } from "../src/lib/server/db";
import { startWorker } from "../src/lib/server/worker";
let temporary: string;
before(async () => {
  temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "frameflow-sqlite-storage-"),
  );
  process.env.DATA_DIR = temporary;
  process.env.SQLITE_PATH = path.join(temporary, "storage.sqlite3");
  delete process.env.DATABASE_URL;
  await migrate();
});
after(async () => {
  await database().end();
  await fs.rm(temporary, { recursive: true, force: true });
});

test("async transactions roll back default-handle writes and isolate concurrent readers", async () => {
  await assert.rejects(
    transaction(async (db) => {
      await db.query("INSERT INTO settings(id,encrypted) VALUES($1,$2)", [
        "rollback",
        "private",
      ]);
      await database().query(
        "INSERT INTO settings(id,encrypted) VALUES($1,$2)",
        ["default-handle", "private"],
      );
      throw new Error("abort");
    }),
    /abort/,
  );
  assert.equal((await database().query("SELECT * FROM settings")).rowCount, 0);
  let entered!: () => void;
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const release = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const write = transaction(async (db) => {
    await db.query(
      "INSERT INTO settings(id,encrypted) VALUES('committed','value')",
    );
    entered();
    await release;
  });
  await ready;
  let observed = false;
  const read = database()
    .query("SELECT * FROM settings")
    .then((result) => {
      observed = true;
      return result;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed, false);
  finish();
  await write;
  assert.equal((await read).rows[0].id, "committed");
});

test("deferred foreign-key failures roll back; migration and persisted data survive reopening", async () => {
  await assert.rejects(
    transaction(async (db) => {
      await db.query(
        "INSERT INTO selected_versions(run_id,step,version_id) VALUES('missing','story','missing')",
      );
    }),
    /FOREIGN KEY/,
  );
  assert.equal(
    (await database().query("SELECT * FROM selected_versions")).rowCount,
    0,
  );
  await database().end();
  await migrate();
  await migrate();
  assert.equal(
    (
      await database().query(
        "SELECT encrypted FROM settings WHERE id='committed'",
      )
    ).rows[0].encrypted,
    "value",
  );
  assert.equal(
    (await database().query("PRAGMA integrity_check")).rows[0].integrity_check,
    "ok",
  );
  assert.equal(
    (await database().query("PRAGMA foreign_key_check")).rowCount,
    0,
  );
});

test("worker ownership excludes another process and can recover after a crash", async () => {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { startWorker } from './src/lib/server/worker.ts';
    await startWorker();
    console.log('ready');
    setInterval(() => {}, 1000);
  `,
    ],
    { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = once(child, "exit");
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  try {
    await Promise.race([
      new Promise<void>((resolve) =>
        child.stdout.on("data", (chunk) => {
          if (String(chunk).includes("ready")) resolve();
        }),
      ),
      exited.then(() => {
        throw new Error(errors || "worker exited before ready");
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("worker startup timed out")),
          10000,
        );
        timer.unref();
      }),
    ]);
    const stopOther = await startWorker();
    assert.equal(
      (
        await database().query(
          "SELECT pid FROM runtime_locks WHERE name='worker'",
        )
      ).rows[0].pid,
      child.pid,
    );
    await stopOther();
    child.kill("SIGKILL");
    await exited;
    const stop = await startWorker();
    try {
      assert.equal(
        (
          await database().query(
            "SELECT pid FROM runtime_locks WHERE name='worker'",
          )
        ).rows[0].pid,
        process.pid,
      );
    } finally {
      await stop();
    }
    assert.equal(
      (await database().query("SELECT * FROM runtime_locks")).rowCount,
      0,
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited;
  }
});
