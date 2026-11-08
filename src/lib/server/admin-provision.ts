// Trusted server commands. Web promotion separately validates the acting admin.
import { randomUUID } from "node:crypto";
import { database, transaction, type DB } from "./db";
import { hashPassword } from "./auth";
import { assert, AppError } from "../domain";
import type { AccessAccount } from "../auth-types";
export type AdminIdentity = Pick<
  AccessAccount,
  "id" | "phone" | "username" | "role" | "access_status"
>;
export function phoneValue(phone: string) {
  assert(
    typeof phone === "string" && /^1[3-9]\d{9}$/.test(phone.trim()),
    "请输入有效的 11 位手机号",
  );
  return phone.trim();
}
export async function adminCandidate(
  phone: string,
): Promise<AdminIdentity | null> {
  const row = (
    await database().query(
      "SELECT id,phone,username,role,access_status FROM users WHERE phone=$1",
      [phoneValue(phone)],
    )
  ).rows[0];
  return row ? (row as AdminIdentity) : null;
}
export async function createAdminAccount(body: {
  phone: string;
  username: string;
  password: string;
  confirmation: string;
}): Promise<AdminIdentity> {
  const { phone, username, password } = validateAdminCredentials(body);
  const passwordHash = await hashPassword(password);
  return transaction(async (db) => {
    if (
      (await db.query("SELECT 1 FROM users WHERE phone=$1", [phone])).rowCount
    )
      throw new AppError(
        "该手机号已有账号，请重新运行命令确认是否将其设为管理员",
        409,
      );
    const id = randomUUID(),
      at = Date.now();
    await db.query(
      "INSERT INTO users(id,phone,username,password_hash,created_at,role,access_status,reviewed_at) VALUES($1,$2,$3,$4,$5,'admin','approved',$5)",
      [id, phone, username, passwordHash, at],
    );
    await db.query(
      "INSERT INTO admin_role_events(id,user_id,previous_role,previous_status,created_at) VALUES($1,$2,NULL,NULL,$3)",
      [randomUUID(), id, at],
    );
    return { id, phone, username, role: "admin", access_status: "approved" };
  });
}
export async function grantAdmin(phone: string, expectedUserId: string) {
  const value = phoneValue(phone);
  return transaction(async (db) => {
    const row = (
      await db.query(
        "SELECT id,phone,username,role,access_status FROM users WHERE phone=$1",
        [value],
      )
    ).rows[0];
    if (!row || row.id !== expectedUserId)
      throw new AppError("账号已变化，请重新运行命令", 409);
    return applyAdminGrant(db, row as AdminIdentity, "server_cli");
  });
}

export function validateAdminCredentials(body: {
  phone: string;
  username: string;
  password: string;
  confirmation: string;
}) {
  const phone = phoneValue(body.phone);
  assert(
    typeof body.username === "string" &&
      body.username.trim().length >= 2 &&
      body.username.trim().length <= 20 &&
      !/[\x00-\x1f\x7f]/.test(body.username),
    "账户名需为 2–20 个字符",
  );
  assert(
    typeof body.password === "string" &&
      body.password.length >= 8 &&
      Buffer.byteLength(body.password) <= 256,
    "密码需至少 8 位，且不超过 256 字节",
  );
  assert(body.password === body.confirmation, "两次输入的密码不一致");
  return { phone, username: body.username.trim(), password: body.password };
}
export async function applyAdminGrant(
  db: DB,
  row: AdminIdentity,
  source: "server_cli" | "initial_setup" | "admin_dashboard",
  actorId: string | null = null,
) {
  if (row.role === "admin" && row.access_status === "approved")
    return { account: row, changed: false };
  const at = Date.now();
  await db.query(
    "UPDATE users SET role='admin',access_status='approved',reviewed_at=$1,reviewed_by=$2 WHERE id=$3",
    [at, actorId, row.id],
  );
  await db.query("DELETE FROM user_sessions WHERE user_id=$1", [row.id]);
  await db.query(
    "INSERT INTO admin_role_events(id,user_id,previous_role,previous_status,created_at,source,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [randomUUID(), row.id, row.role, row.access_status, at, source, actorId],
  );
  return {
    account: {
      ...row,
      role: "admin",
      access_status: "approved",
    } as AdminIdentity,
    changed: true,
  };
}
