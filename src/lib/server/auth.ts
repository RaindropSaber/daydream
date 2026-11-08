import { avatarUrl } from "../avatars";
import type { AccessStatus, AuthUser } from "../auth-types";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { database, transaction } from "./db";
import { AppError, assert } from "../domain";

const derive = promisify(scrypt);
export const SESSION_COOKIE = "daydream_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, encoded] = stored.split(":");
  const expected = Buffer.from(encoded, "hex");
  const actual = (await derive(password, salt, 64)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function authenticate(body: Record<string, unknown>) {
  assert(
    typeof body.phone === "string" && /^1[3-9]\d{9}$/.test(body.phone.trim()),
    "请输入有效的 11 位手机号",
  );
  assert(
    typeof body.password === "string" &&
      body.password.length >= 8 &&
      Buffer.byteLength(body.password) <= 256,
    "密码需至少 8 位，且不超过 256 字节",
  );
  const phone = body.phone.trim();
  const password = body.password;
  const throttle = (
    await database().query("SELECT * FROM auth_attempts WHERE username=$1", [
      phone,
    ])
  ).rows[0];
  if (throttle && throttle.failures >= 5 && throttle.retry_at > Date.now())
    throw new AppError("尝试次数过多，请 15 分钟后重试", 429);
  let row = (
    await database().query("SELECT * FROM users WHERE phone=$1", [phone])
  ).rows[0];
  let registered = false;
  if (!row) {
    if (typeof body.username !== "string" || !body.username.trim())
      throw new AppError("首次申请，请填写用户名称", 422);
    assert(
      body.username.trim().length >= 2 &&
        body.username.trim().length <= 20 &&
        !/[\x00-\x1f\x7f]/.test(body.username),
      "用户名称需为 2–20 个字符",
    );
    assert(
      typeof body.confirmation === "string" && body.confirmation.length > 0,
      "请确认密码",
    );
    assert(body.confirmation === password, "两次输入的密码不一致");
    const hash = await hashPassword(password);
    const result = await database().query(
      "INSERT INTO users(id,phone,password_hash,created_at,username) VALUES($1,$2,$3,$4,$5) ON CONFLICT(phone) DO NOTHING",
      [randomUUID(), phone, hash, Date.now(), body.username.trim()],
    );
    registered = !!result.rowCount;
    row = (
      await database().query("SELECT * FROM users WHERE phone=$1", [phone])
    ).rows[0];
  }
  if (!registered && !(await verifyPassword(password, row.password_hash))) {
    await database().query(
      "INSERT INTO auth_attempts(username,failures,retry_at) VALUES($1,1,$2) ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN retry_at<$3 THEN 1 ELSE failures+1 END,retry_at=$2",
      [phone, Date.now() + 15 * 60_000, Date.now()],
    );
    throw new AppError("手机号或密码不正确", 401);
  }
  await database().query("DELETE FROM auth_attempts WHERE username=$1", [
    phone,
  ]);
  const status = row.access_status as AccessStatus;
  if (status !== "approved") return { status, registered };
  await database().query("DELETE FROM user_sessions WHERE expires_at<=$1", [
    Date.now(),
  ]);
  const token = randomBytes(32).toString("hex");
  return transaction(async (db) => {
    const current = (
      await db.query("SELECT * FROM users WHERE id=$1", [row.id])
    ).rows[0];
    if (!current || current.password_hash !== row.password_hash)
      throw new AppError("账号凭据已变化，请重新登录", 401);
    const currentStatus = current.access_status as AccessStatus;
    if (currentStatus !== "approved")
      return { status: currentStatus, registered };
    await db.query(
      "INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
      [tokenHash(token), row.id, Date.now() + SESSION_SECONDS * 1000],
    );
    return {
      status: "authenticated" as const,
      token,
      registered,
      user: publicUser(current),
    };
  });
}
function publicUser(row: Record<string, any>): AuthUser {
  return {
    id: row.id as string,
    username: row.username as string,
    avatarUrl: avatarUrl(row.phone),
    role: row.role as AuthUser["role"],
  };
}
export async function sessionUser(token?: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = (
    await database().query(
      "SELECT u.id,u.username,u.phone,u.role FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.access_status='approved'",
      [tokenHash(token), Date.now()],
    )
  ).rows[0];
  return row ? publicUser(row) : null;
}
export async function requireSession(token?: string) {
  const user = await sessionUser(token);
  if (!user) throw new AppError("请先登录", 401);
  return user;
}
export async function logout(token?: string) {
  if (token)
    await database().query("DELETE FROM user_sessions WHERE token_hash=$1", [
      tokenHash(token),
    ]);
}
export function sessionToken(cookie: string | null | undefined) {
  return cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}

export async function requireAdmin(token?: string) {
  const user = await requireSession(token);
  if (user.role !== "admin") throw new AppError("需要管理员权限", 403);
  return user;
}
