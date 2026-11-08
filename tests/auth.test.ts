import { createAdminAccount } from "../src/lib/server/admin-provision";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { database, migrate } from "../src/lib/server/db";
import {
  authenticate,
  sessionUser,
  requireSession,
  requireAdmin,
  logout,
  sessionToken,
  SESSION_COOKIE,
} from "../src/lib/server/auth";
import { reviewAccount, adminAccounts } from "../src/lib/server/admin";
import {
  withAccount,
  inProjectAccount,
} from "../src/lib/server/account-context";
import { createProject } from "../src/lib/server/studio";
import { listProjects, loadProject } from "../src/lib/server/repository";
import { storeConfig, config } from "../src/lib/server/settings";
import { mediaPath } from "../src/lib/server/files";
import { mediaResponse } from "../src/lib/server/media";
let temporary: string, adminId: string, adminToken: string;
const credentials = {
  username: "测试创作者",
  phone: "13800138000",
  password: "test-password-123",
  confirmation: "test-password-123",
};
async function login(body: Record<string, unknown>) {
  const result = await authenticate(body);
  assert.equal(result.status, "authenticated");
  if (result.status !== "authenticated")
    throw Error("Expected approved account");
  return result;
}
async function approvedAccount(phone: string) {
  const body = {
    username: "测试用户",
    phone,
    password: "another-password",
    confirmation: "another-password",
  };
  await authenticate(body);
  const row = (
    await database().query("SELECT id FROM users WHERE phone=$1", [phone])
  ).rows[0];
  await reviewAccount(adminId, row.id, "approve", "pending");
  return login(body);
}
before(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "daydream-auth-"));
  process.env.DATA_DIR = temporary;
  process.env.SQLITE_PATH = path.join(temporary, "auth.sqlite3");
  await migrate();
  await createAdminAccount({
    phone: "15000000000",
    username: "管理员",
    password: "test-admin-password",
    confirmation: "test-admin-password",
  });
  const admin = await authenticate({
    phone: "15000000000",
    password: "test-admin-password",
  });
  assert.equal(admin.status, "authenticated");
  if (admin.status !== "authenticated") throw Error("Missing admin");
  adminId = admin.user.id;
  adminToken = admin.token;
});
after(async () => {
  await database().end();
  await fs.rm(temporary, { recursive: true, force: true });
});
test("new phone submits one pending application and receives no session before approval", async () => {
  for (const phone of ["", "123", "12800138000", null])
    await assert.rejects(authenticate({ ...credentials, phone }), /手机号/);
  await assert.rejects(
    authenticate({ ...credentials, password: "short" }),
    /密码/,
  );
  await assert.rejects(
    authenticate({ phone: credentials.phone, password: credentials.password }),
    /填写用户名称/,
  );
  await assert.rejects(
    authenticate({ ...credentials, username: "a" }),
    /用户名称/,
  );
  await assert.rejects(
    authenticate({ ...credentials, confirmation: undefined }),
    /请确认密码/,
  );
  await assert.rejects(
    authenticate({ ...credentials, confirmation: "not-matching" }),
    /两次输入的密码不一致/,
  );
  assert.equal(
    (
      await database().query("SELECT 1 FROM users WHERE phone=$1", [
        credentials.phone,
      ])
    ).rowCount,
    0,
  );
  const results = await Promise.all([
    authenticate({ ...credentials, role: "admin", access_status: "approved" }),
    authenticate(credentials),
  ]);
  assert.equal(results.filter((result) => result.registered).length, 1);
  assert.ok(
    results.every(
      (result) => result.status === "pending" && !("token" in result),
    ),
  );
  const row = (
    await database().query("SELECT * FROM users WHERE phone=$1", [
      credentials.phone,
    ])
  ).rows[0];
  assert.equal(row.username, credentials.username);
  assert.equal(row.role, "member");
  assert.equal(row.access_status, "pending");
  assert.ok(!row.password_hash.includes(credentials.password));
  assert.equal(
    (
      await database().query("SELECT 1 FROM user_sessions WHERE user_id=$1", [
        row.id,
      ])
    ).rowCount,
    0,
  );
  await assert.rejects(
    authenticate({ ...credentials, password: "wrong-password" }),
    /手机号或密码/,
  );
  assert.equal((await authenticate(credentials)).status, "pending");
  await reviewAccount(adminId, row.id, "approve", "pending");
  const { token, user, registered } = await login(credentials);
  assert.equal(registered, false);
  assert.equal(user.role, "member");
  assert.equal(user.username, "测试创作者");
  assert.equal(
    new URL(user.avatarUrl).searchParams.get("name")?.split(":")[0],
    credentials.phone,
  );
  assert.equal(new URL(user.avatarUrl).searchParams.get("variant"), "beam");
  const colors = new URL(user.avatarUrl).searchParams.getAll("colors");
  assert.equal(colors.length, 5);
  assert.ok(colors.every((color) => /^#[0-9A-F]{6}$/i.test(color)));
  assert.equal(
    (
      await login({
        phone: credentials.phone,
        password: credentials.password,
        username: "不可覆盖",
      })
    ).user.username,
    "测试创作者",
  );
  assert.deepEqual(await requireSession(token), user);
  await assert.rejects(requireAdmin(token), /需要管理员权限/);
  assert.equal((await requireAdmin(adminToken)).id, adminId);
  assert.equal(await sessionUser("forged-token"), null);
  assert.ok(
    (await database().query("SELECT token_hash FROM user_sessions")).rows.every(
      (row) => row.token_hash !== token,
    ),
  );
  assert.equal(
    sessionToken(`other=1; ${SESSION_COOKIE}=${token}; next=2`),
    token,
  );
  await logout(token);
  assert.equal(await sessionUser(token), null);
  await assert.rejects(requireSession(token), /请先登录/);
  const next = await login(credentials);
  await database().query(
    "UPDATE user_sessions SET expires_at=0 WHERE user_id=$1",
    [user.id],
  );
  assert.equal(await sessionUser(next.token), null);
});
test("admin decisions enforce expected state, prevent member escalation, and revoke disabled sessions", async () => {
  const a = await approvedAccount("13900139000");
  await assert.rejects(
    reviewAccount(a.user.id, a.user.id, "disable", "approved"),
    /需要管理员权限/,
  );
  await assert.rejects(
    reviewAccount(adminId, adminId, "disable", "approved"),
    /管理员账号/,
  );
  await assert.rejects(
    reviewAccount(adminId, a.user.id, "approve", "pending"),
    /状态已变化/,
  );
  await assert.rejects(
    reviewAccount(adminId, a.user.id, "invalid", "approved"),
    /操作无效/,
  );
  const result = await Promise.allSettled([
    reviewAccount(adminId, a.user.id, "disable", "approved"),
    reviewAccount(adminId, a.user.id, "disable", "approved"),
  ]);
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await sessionUser(a.token), null);
  assert.equal(
    (await authenticate({ phone: "13900139000", password: "another-password" }))
      .status,
    "disabled",
  );
  await reviewAccount(adminId, a.user.id, "enable", "disabled");
  assert.equal(await sessionUser(a.token), null);
  const restored = await login({
    phone: "13900139000",
    password: "another-password",
  });
  assert.equal(restored.status, "authenticated");
  const audit = (
    await database().query(
      "SELECT * FROM user_access_reviews WHERE user_id=$1",
      [a.user.id],
    )
  ).rows;
  assert.equal(audit.length, 3);
  assert.ok(audit.every((row) => row.reviewer_id === adminId));
  // Session lookup also rejects a status change even if a stale token remains in storage.
  const stale = await login({
    phone: "13900139000",
    password: "another-password",
  });
  await database().query(
    "UPDATE users SET access_status='pending' WHERE id=$1",
    [a.user.id],
  );
  assert.equal(await sessionUser(stale.token), null);
  const rejected = {
    phone: "13700137000",
    password: "test-password",
    username: "待拒绝用户",
    confirmation: "test-password",
  };
  await authenticate(rejected);
  const id = (
    await database().query("SELECT id FROM users WHERE phone=$1", [
      rejected.phone,
    ])
  ).rows[0].id;
  await reviewAccount(adminId, id, "reject", "pending");
  const r = await authenticate(rejected);
  assert.equal(r.status, "rejected");
  assert.ok(!("token" in r));
  const accounts = await adminAccounts();
  assert.ok(accounts.every((row) => !("password_hash" in row)));
});
test("failed login is throttled per phone and unlocks after timeout", async () => {
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      authenticate({ ...credentials, password: "wrong-password" }),
      /手机号或密码/,
    );
  await assert.rejects(authenticate(credentials), /尝试次数过多/);
  assert.equal(
    (
      await authenticate({
        username: "另一位创作者",
        phone: "13600136000",
        password: "another-password",
        confirmation: "another-password",
      })
    ).status,
    "pending",
  );
  await database().query("UPDATE auth_attempts SET retry_at=0");
  assert.ok((await login(credentials)).token);
});
test("accounts isolate projects, model configuration, media and background task scope", async () => {
  const a = (await login(credentials)).user.id;
  const b = (await approvedAccount("13300133000")).user.id;
  const project = await withAccount(a, async () => {
    await storeConfig({ text_model: "account-a-model" });
    const result = await createProject({ title: "Account A" });
    await fs.writeFile(await mediaPath("account-a.png", false), "test image");
    assert.equal(
      (await mediaResponse("HEAD", "account-a.png", null)).status,
      200,
    );
    return result.project;
  });
  await withAccount(b, async () => {
    assert.equal((await listProjects()).length, 0);
    await assert.rejects(loadProject(project.id), /项目不存在/);
    await assert.rejects(mediaPath("account-a.png"), /媒体不存在/);
    assert.equal(
      (await mediaResponse("HEAD", "account-a.png", null)).status,
      404,
    );
    await storeConfig({ text_model: "account-b-model" });
    assert.equal((await config()).text_model, "account-b-model");
    const own = await createProject({ title: "Account B" });
    assert.equal((await listProjects())[0].id, own.project.id);
  });
  await withAccount(a, async () => {
    assert.equal((await listProjects()).length, 1);
    assert.equal((await loadProject(project.id)).title, "Account A");
    assert.equal((await config()).text_model, "account-a-model");
  });
  await inProjectAccount(project.id, async () =>
    assert.equal((await config()).text_model, "account-a-model"),
  );
});
