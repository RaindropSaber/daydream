import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { database, migrate } from "../src/lib/server/db";
import {
  adminCandidate,
  createAdminAccount,
  grantAdmin,
} from "../src/lib/server/admin-provision";
import { authenticate, sessionUser } from "../src/lib/server/auth";
import { reviewAccount } from "../src/lib/server/admin";
import { withAccount } from "../src/lib/server/account-context";
import { createProject } from "../src/lib/server/studio";
import { loadProject } from "../src/lib/server/repository";
let folder: string;
const password = "test-admin-create-password";
before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "daydream-admin-create-"));
  process.env.DATA_DIR = folder;
  process.env.SQLITE_PATH = path.join(folder, "test.sqlite3");
  await migrate();
});
after(async () => {
  await database().end();
  await fs.rm(folder, { recursive: true, force: true });
});
function values(phone: string) {
  return { phone, username: "服务器管理员", password, confirmation: password };
}
test("server command validates new credentials and creates an approved admin without a browser session", async () => {
  const body = values("15000000000");
  for (const invalid of [
    { phone: "invalid" },
    { username: "a" },
    { password: "short" },
    { confirmation: "different" },
  ])
    await assert.rejects(createAdminAccount({ ...body, ...invalid }));
  assert.equal(await adminCandidate(body.phone), null);
  const account = await createAdminAccount(body);
  assert.equal(account.role, "admin");
  assert.equal(account.access_status, "approved");
  assert.ok(!("password_hash" in account));
  assert.equal(
    (
      await database().query("SELECT 1 FROM user_sessions WHERE user_id=$1", [
        account.id,
      ])
    ).rowCount,
    0,
  );
  const row = (
    await database().query("SELECT password_hash FROM users WHERE id=$1", [
      account.id,
    ])
  ).rows[0];
  assert.ok(!row.password_hash.includes(password));
  const login = await authenticate({ phone: body.phone, password });
  assert.equal(login.status, "authenticated");
  if (login.status === "authenticated") assert.equal(login.user.role, "admin");
});
test("duplicate or concurrent creation cannot replace an existing account", async () => {
  const body = values("15100000000");
  const results = await Promise.allSettled([
    createAdminAccount(body),
    createAdminAccount({ ...body, username: "不能覆盖的名称" }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const before = (
    await database().query("SELECT * FROM users WHERE phone=$1", [body.phone])
  ).rows[0];
  await assert.rejects(
    createAdminAccount({
      ...body,
      password: "different-password",
      confirmation: "different-password",
    }),
    /已有账号/,
  );
  assert.deepEqual(
    (await database().query("SELECT * FROM users WHERE phone=$1", [body.phone]))
      .rows[0],
    before,
  );
  assert.equal(
    (
      await database().query(
        "SELECT 1 FROM admin_role_events WHERE user_id=$1",
        [before.id],
      )
    ).rowCount,
    1,
  );
});
test("granting an existing account preserves credentials and project data while ending old sessions", async () => {
  const phone = "13800138000";
  const owner = await adminCandidate("15000000000");
  assert.ok(owner);
  await authenticate({
    phone,
    username: "原账户名称",
    password,
    confirmation: password,
  });
  const candidate = await adminCandidate(phone);
  assert.ok(candidate);
  await reviewAccount(owner.id, candidate.id, "approve", "pending");
  const login = await authenticate({ phone, password });
  if (login.status !== "authenticated") throw Error("Missing member session");
  const project = await withAccount(candidate.id, () =>
    createProject({ title: "保留原项目" }),
  );
  const before = (
    await database().query("SELECT * FROM users WHERE id=$1", [candidate.id])
  ).rows[0];
  await assert.rejects(grantAdmin(phone, "other-account"), /账号已变化/);
  const result = await grantAdmin(phone, candidate.id);
  assert.equal(result.changed, true);
  const after = (
    await database().query("SELECT * FROM users WHERE id=$1", [candidate.id])
  ).rows[0];
  for (const key of ["id", "phone", "username", "password_hash", "created_at"])
    assert.equal(after[key], before[key]);
  assert.equal(after.role, "admin");
  assert.equal(after.access_status, "approved");
  assert.equal(await sessionUser(login.token), null);
  assert.equal(
    (await withAccount(candidate.id, () => loadProject(project.project.id)))
      .title,
    "保留原项目",
  );
  const next = await authenticate({ phone, password });
  if (next.status !== "authenticated")
    throw Error("Original password must still work");
  assert.equal(next.user.role, "admin");
  assert.equal((await grantAdmin(phone, candidate.id)).changed, false);
  assert.ok(await sessionUser(next.token));
  assert.equal(
    (
      await database().query(
        "SELECT * FROM admin_role_events WHERE user_id=$1",
        [candidate.id],
      )
    ).rows[0].previous_role,
    "member",
  );
});
test("server operator can activate pending or disabled accounts without resetting their password", async () => {
  const phone = "13900139000";
  await authenticate({
    phone,
    username: "待审核账号",
    password,
    confirmation: password,
  });
  const account = await adminCandidate(phone);
  assert.ok(account);
  await grantAdmin(phone, account.id);
  await database().query(
    "UPDATE users SET access_status='disabled' WHERE id=$1",
    [account.id],
  );
  await grantAdmin(phone, account.id);
  const login = await authenticate({ phone, password });
  assert.equal(login.status, "authenticated");
});
test("CLI help is available and non-interactive/password argument input is rejected", () => {
  const script = path.resolve("scripts/admin-create.ts");
  const help = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "--help"],
    { encoding: "utf8" },
  );
  assert.equal(help.status, 0);
  assert.match(help.stdout, /admin:create/);
  const piped = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "15200000000"],
    { encoding: "utf8", input: "do-not-accept-this-password\n" },
  );
  assert.equal(piped.status, 1);
  assert.match(piped.stderr, /交互式终端/);
  assert.ok(!piped.stdout.includes("do-not-accept-this-password"));
  const args = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "15200000000", "--password=secret-not-printed"],
    { encoding: "utf8" },
  );
  assert.equal(args.status, 1);
  assert.ok(!args.stderr.includes("secret-not-printed"));
});

test("dashboard promotion requires an active admin and an approved member, and logs the actor", async () => {
  const actor = await adminCandidate("15000000000");
  assert.ok(actor);
  const phone = "13700137000";
  await authenticate({
    phone,
    username: "后台授权目标",
    password,
    confirmation: password,
  });
  const candidate = await adminCandidate(phone);
  assert.ok(candidate);
  await assert.rejects(
    reviewAccount(actor.id, candidate.id, "promote", "pending", "member"),
    /仅可将已通过/,
  );
  await reviewAccount(actor.id, candidate.id, "approve", "pending");
  const oldLogin = await authenticate({ phone, password });
  if (oldLogin.status !== "authenticated")
    throw Error("Expected a member session");
  const before = (
    await database().query("SELECT * FROM users WHERE id=$1", [candidate.id])
  ).rows[0];
  await assert.rejects(
    reviewAccount(candidate.id, actor.id, "promote", "approved", "member"),
    /需要管理员权限/,
  );
  await assert.rejects(
    reviewAccount(actor.id, candidate.id, "promote", "approved", "admin"),
    /仅可将已通过/,
  );
  await reviewAccount(actor.id, candidate.id, "promote", "approved", "member");
  assert.equal(await sessionUser(oldLogin.token), null);
  const after = (
    await database().query("SELECT * FROM users WHERE id=$1", [candidate.id])
  ).rows[0];
  for (const key of ["username", "phone", "password_hash", "created_at"])
    assert.equal(after[key], before[key]);
  assert.equal(after.role, "admin");
  const event = (
    await database().query("SELECT * FROM admin_role_events WHERE user_id=$1", [
      candidate.id,
    ])
  ).rows[0];
  assert.equal(event.source, "admin_dashboard");
  assert.equal(event.actor_id, actor.id);
  const next = await authenticate({ phone, password });
  if (next.status !== "authenticated")
    throw Error("Original password must remain valid");
  assert.equal(next.user.role, "admin");
  await assert.rejects(
    reviewAccount(actor.id, candidate.id, "promote", "approved", "member"),
    /仅可将已通过/,
  );
  await assert.rejects(
    reviewAccount(actor.id, actor.id, "promote", "approved", "member"),
    /仅可将已通过/,
  );
});
