import { createHash } from "node:crypto";
import { database, transaction, type DB } from "./db";
import { hashPassword, verifyPassword } from "./auth";
import { AppError, assert } from "../domain";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
async function activeAccount(token?: string, db: DB = database()) {
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new AppError("请先登录", 401);
  const row = (
    await db.query(
      "SELECT u.* FROM users u JOIN user_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.access_status='approved'",
      [digest(token), Date.now()],
    )
  ).rows[0];
  if (!row) throw new AppError("请先登录", 401);
  return row;
}
const profile = (row: Record<string, any>) => ({
  username: row.username as string,
  phone: row.phone as string,
});
export async function accountProfile(token?: string) {
  return profile(await activeAccount(token));
}
export async function updateAccountName(
  token: string | undefined,
  body: Record<string, unknown>,
) {
  assert(
    Object.keys(body).every((key) => key === "username"),
    "只能修改账户名，手机号不可修改",
  );
  assert(
    typeof body.username === "string" &&
      body.username.trim().length >= 2 &&
      body.username.trim().length <= 20 &&
      !/[\x00-\x1f\x7f]/.test(body.username),
    "账户名需为 2–20 个字符",
  );
  const username = body.username.trim();
  return transaction(async (db) => {
    const row = await activeAccount(token, db);
    await db.query("UPDATE users SET username=$1 WHERE id=$2", [
      username,
      row.id,
    ]);
    return { ...profile(row), username };
  });
}
export async function changeAccountPassword(
  token: string | undefined,
  body: Record<string, unknown>,
) {
  assert(
    Object.keys(body).every((key) =>
      ["currentPassword", "newPassword", "confirmation"].includes(key),
    ),
    "请求包含不允许修改的字段",
  );
  const row = await activeAccount(token);
  assert(
    typeof body.currentPassword === "string" &&
      body.currentPassword.length > 0 &&
      Buffer.byteLength(body.currentPassword) <= 256,
    "请输入原密码",
  );
  assert(
    typeof body.newPassword === "string" &&
      body.newPassword.length >= 8 &&
      Buffer.byteLength(body.newPassword) <= 256,
    "新密码需至少 8 位，且不超过 256 字节",
  );
  assert(body.newPassword === body.confirmation, "两次输入的新密码不一致");
  const attemptKey = `password:${row.id}`;
  const attempt = (
    await database().query("SELECT * FROM auth_attempts WHERE username=$1", [
      attemptKey,
    ])
  ).rows[0];
  if (attempt && attempt.failures >= 5 && attempt.retry_at > Date.now())
    throw new AppError("原密码尝试次数过多，请 15 分钟后重试", 429);
  if (!(await verifyPassword(body.currentPassword, row.password_hash))) {
    await database().query(
      "INSERT INTO auth_attempts(username,failures,retry_at) VALUES($1,1,$2) ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN retry_at<$3 THEN 1 ELSE failures+1 END,retry_at=$2",
      [attemptKey, Date.now() + 15 * 60_000, Date.now()],
    );
    throw new AppError("原密码不正确");
  }
  assert(body.newPassword !== body.currentPassword, "新密码不能与原密码相同");
  const passwordHash = await hashPassword(body.newPassword);
  await transaction(async (db) => {
    const current = await activeAccount(token, db);
    if (current.password_hash !== row.password_hash)
      throw new AppError("密码已变化，请重新登录", 409);
    await db.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      passwordHash,
      row.id,
    ]);
    await db.query("DELETE FROM user_sessions WHERE user_id=$1", [row.id]);
    await db.query("DELETE FROM auth_attempts WHERE username=$1", [attemptKey]);
  });
  return { ok: true };
}
