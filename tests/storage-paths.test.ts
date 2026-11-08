import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { dataDir, databasePath } from "../src/lib/server/storage-paths";

test("workspace defaults to the user's hidden directory and respects explicit paths", () => {
  const originalDirectory = process.env.DATA_DIR;
  const originalDatabase = process.env.SQLITE_PATH;
  const originalCwd = process.cwd();
  try {
    delete process.env.DATA_DIR;
    delete process.env.SQLITE_PATH;
    const expected = path.join(os.homedir(), ".daydream");
    assert.equal(dataDir(), expected);
    assert.equal(databasePath(), path.join(expected, "frameflow.sqlite3"));
    process.chdir(os.tmpdir());
    assert.equal(dataDir(), expected);
    assert.equal(databasePath(), path.join(expected, "frameflow.sqlite3"));
    process.env.DATA_DIR = "~/custom-daydream";
    assert.equal(dataDir(), path.join(os.homedir(), "custom-daydream"));
    assert.equal(databasePath(), path.join(dataDir(), "frameflow.sqlite3"));
    process.env.SQLITE_PATH = "~/custom-db/studio.sqlite3";
    assert.equal(
      databasePath(),
      path.join(os.homedir(), "custom-db/studio.sqlite3"),
    );
    process.env.DATA_DIR = "relative-data";
    assert.equal(dataDir(), path.resolve("relative-data"));
    process.env.SQLITE_PATH = "relative-db.sqlite3";
    assert.equal(databasePath(), path.resolve("relative-db.sqlite3"));
  } finally {
    process.chdir(originalCwd);
    if (originalDirectory === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDirectory;
    if (originalDatabase === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = originalDatabase;
  }
});
