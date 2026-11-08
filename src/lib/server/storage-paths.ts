import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

function resolveStoragePath(value: string) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

export const dataDir = () =>
  resolveStoragePath(
    process.env.DATA_DIR || path.join(os.homedir(), ".daydream"),
  );

export const databasePath = () =>
  process.env.SQLITE_PATH
    ? resolveStoragePath(process.env.SQLITE_PATH)
    : path.join(dataDir(), "frameflow.sqlite3");
