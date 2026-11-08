import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { database, transaction, type DB } from "./db";
import { dataDir } from "./storage-paths";
import { hashPassword, verifyPassword, authenticate } from "./auth";
import {
  applyAdminGrant,
  validateAdminCredentials,
  type AdminIdentity,
} from "./admin-provision";
import { AppError, assert } from "../domain";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function hasAdministrator(db: DB = database()) {
  return !!(await db.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1"))
    .rowCount;
}
// The initial capability is only issued to the server operator, never by a public request.
export async function ensureInitialAdminSetup() {
  if (await hasAdministrator()) return null;
  const folder = dataDir(),
    file = path.join(folder, ".initial-admin-setup-token");
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  return transaction(async (db) => {
    if (await hasAdministrator(db)) return null;
    const row = (await db.query("SELECT * FROM initial_admin_setup WHERE id=1"))
      .rows[0];
    let token = "";
    try {
      token = (await fs.readFile(file, "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      !/^[a-f0-9]{64}$/.test(token) ||
      !row ||
      row.token_hash !== digest(token) ||
      row.expires_at <= Date.now() ||
      row.consumed_at
    ) {
      token = randomBytes(32).toString("hex");
      await fs.writeFile(file, token, { mode: 0o600 });
      await db.query(
        "INSERT INTO initial_admin_setup(id,token_hash,expires_at) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET token_hash=$1,expires_at=$2,consumed_at=NULL",
        [digest(token), Date.now() + 24 * 60 * 60_000],
      );
    }
    await fs.chmod(file, 0o600);
    return token;
  });
}
export async function initialSetupStatus(token?: string) {
  if (await hasAdministrator()) return "complete" as const;
  if (!token) return "required" as const;
  if (!/^[a-f0-9]{64}$/.test(token)) return "invalid" as const;
  const row = (
    await database().query(
      "SELECT 1 FROM initial_admin_setup WHERE id=1 AND token_hash=$1 AND expires_at>$2 AND consumed_at IS NULL",
      [digest(token), Date.now()],
    )
  ).rows[0];
  return row ? ("ready" as const) : ("invalid" as const);
}
export async function completeInitialAdminSetup(body: Record<string, unknown>) {
  assert(
    typeof body.token === "string" &&
      (await initialSetupStatus(body.token)) === "ready",
    "初始化口令无效、已过期或系统已完成初始化",
  );
  const token = body.token;
  const values = validateAdminCredentials(
    body as {
      phone: string;
      username: string;
      password: string;
      confirmation: string;
    },
  );
  const existing = (
    await database().query("SELECT * FROM users WHERE phone=$1", [values.phone])
  ).rows[0];
  if (
    existing &&
    !(await verifyPassword(values.password, existing.password_hash))
  )
    throw new AppError("该手机号已有账号，请使用原账号密码");
  const passwordHash = existing
    ? existing.password_hash
    : await hashPassword(values.password);
  await transaction(async (db) => {
    if (await hasAdministrator(db))
      throw new AppError("系统已完成初始化，请正常登录", 409);
    if (
      !(
        await db.query(
          "SELECT 1 FROM initial_admin_setup WHERE id=1 AND token_hash=$1 AND expires_at>$2 AND consumed_at IS NULL",
          [digest(token), Date.now()],
        )
      ).rowCount
    )
      throw new AppError("初始化口令已失效", 409);
    const current = (
      await db.query("SELECT * FROM users WHERE phone=$1", [values.phone])
    ).rows[0];
    if (
      current &&
      (!existing || current.password_hash !== existing.password_hash)
    )
      throw new AppError("账号状态已变化，请重试", 409);
    if (existing && !current) throw new AppError("账号状态已变化，请重试", 409);
    if (current) {
      await applyAdminGrant(db, current as AdminIdentity, "initial_setup");
      await db.query("UPDATE users SET username=$1 WHERE id=$2", [
        values.username,
        current.id,
      ]);
    } else {
      const id = randomUUID(),
        at = Date.now();
      await db.query(
        "INSERT INTO users(id,phone,username,password_hash,created_at,role,access_status,reviewed_at) VALUES($1,$2,$3,$4,$5,'admin','approved',$5)",
        [id, values.phone, values.username, passwordHash, at],
      );
      await db.query(
        "INSERT INTO admin_role_events(id,user_id,created_at,source) VALUES($1,$2,$3,'initial_setup')",
        [randomUUID(), id, at],
      );
    }
    await db.query("UPDATE initial_admin_setup SET consumed_at=$1 WHERE id=1", [
      Date.now(),
    ]);
  });
  return authenticate({ phone: values.phone, password: values.password });
}
