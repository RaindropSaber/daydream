import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { database, migrate } from "../src/lib/server/db";
import {
  ensureInitialAdminSetup,
  initialSetupStatus,
  completeInitialAdminSetup,
  hasAdministrator,
} from "../src/lib/server/initial-setup";
import { createAdminAccount } from "../src/lib/server/admin-provision";
import { authenticate } from "../src/lib/server/auth";
let folder: string;
const body = {
  phone: "15000000000",
  username: "首位管理员",
  password: "initial-admin-password",
  confirmation: "initial-admin-password",
};
beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "daydream-initial-"));
  process.env.DATA_DIR = folder;
  process.env.SQLITE_PATH = path.join(folder, "test.sqlite3");
  await migrate();
});
afterEach(async () => {
  await database().end();
  await fs.rm(folder, { recursive: true, force: true });
});
test("server issues a private setup capability and rotates an expired one", async () => {
  assert.equal(await hasAdministrator(), false);
  assert.equal(await initialSetupStatus(), "required");
  const token = await ensureInitialAdminSetup();
  assert.ok(token);
  assert.equal(await initialSetupStatus(token), "ready");
  assert.equal(await ensureInitialAdminSetup(), token);
  const row = (await database().query("SELECT * FROM initial_admin_setup"))
    .rows[0];
  assert.notEqual(row.token_hash, token);
  assert.equal(
    (await fs.stat(path.join(folder, ".initial-admin-setup-token"))).mode &
      0o777,
    0o600,
  );
  await database().query("UPDATE initial_admin_setup SET expires_at=0");
  assert.equal(await initialSetupStatus(token), "invalid");
  const next = await ensureInitialAdminSetup();
  assert.ok(next);
  assert.notEqual(next, token);
  assert.equal(await initialSetupStatus(token), "invalid");
  assert.equal(await initialSetupStatus(next), "ready");
});
test("first setup validates credentials, signs in the admin and cannot be reused", async () => {
  const token = await ensureInitialAdminSetup();
  assert.ok(token);
  await assert.rejects(
    completeInitialAdminSetup({ ...body, token: "0".repeat(64) }),
    /初始化口令/,
  );
  await assert.rejects(
    completeInitialAdminSetup({ ...body, token, confirmation: "mismatch" }),
    /不一致/,
  );
  assert.equal(await hasAdministrator(), false);
  const result = await completeInitialAdminSetup({ ...body, token });
  assert.equal(result.status, "authenticated");
  if (result.status === "authenticated")
    assert.equal(result.user.role, "admin");
  assert.equal(await initialSetupStatus(token), "complete");
  assert.equal(await ensureInitialAdminSetup(), null);
  await assert.rejects(
    completeInitialAdminSetup({ ...body, token, phone: "15100000000" }),
    /已完成初始化/,
  );
  assert.equal(
    (
      await database().query(
        "SELECT COUNT(*) AS count FROM users WHERE role='admin'",
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (await database().query("SELECT source FROM admin_role_events")).rows[0]
      .source,
    "initial_setup",
  );
  // Disabling the only admin must not reopen a public initialization flow.
  await database().query("UPDATE users SET access_status='disabled'");
  assert.equal(await ensureInitialAdminSetup(), null);
  assert.equal(await initialSetupStatus(token), "complete");
});
test("concurrent first setup requests produce only one administrator", async () => {
  const token = await ensureInitialAdminSetup();
  const results = await Promise.allSettled([
    completeInitialAdminSetup({ ...body, token }),
    completeInitialAdminSetup({ ...body, token, phone: "15100000000" }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    (
      await database().query(
        "SELECT COUNT(*) AS count FROM users WHERE role='admin'",
      )
    ).rows[0].count,
    1,
  );
});
test("first setup preserves an existing user's password and requires it", async () => {
  await authenticate(body);
  const before = (
    await database().query("SELECT * FROM users WHERE phone=$1", [body.phone])
  ).rows[0];
  const token = await ensureInitialAdminSetup();
  await assert.rejects(
    completeInitialAdminSetup({
      ...body,
      token,
      password: "incorrect-password",
      confirmation: "incorrect-password",
    }),
    /原账号密码/,
  );
  assert.equal(await hasAdministrator(), false);
  await completeInitialAdminSetup({ ...body, token });
  const after = (
    await database().query("SELECT * FROM users WHERE phone=$1", [body.phone])
  ).rows[0];
  assert.equal(after.id, before.id);
  assert.equal(after.password_hash, before.password_hash);
  assert.equal(after.role, "admin");
});
test("creating the first admin through the server command closes setup immediately", async () => {
  const token = await ensureInitialAdminSetup();
  await createAdminAccount(body);
  assert.equal(await initialSetupStatus(token || undefined), "complete");
  await assert.rejects(
    completeInitialAdminSetup({ ...body, token, phone: "15100000000" }),
    /已完成初始化/,
  );
});

test("role audit migration preserves server command history and existing users", async () => {
  await database().end();
  process.env.SQLITE_PATH = path.join(folder, "previous-schema.sqlite3");
  await migrate("009_admin_provision_events.sql");
  await database().query(
    "INSERT INTO users(id,phone,username,password_hash,created_at,role,access_status) VALUES('admin-existing','15000000000','原管理员','existing-hash',123,'admin','approved')",
  );
  await database().query(
    "INSERT INTO admin_provision_events(id,user_id,previous_role,previous_status,created_at) VALUES('event-existing','admin-existing','member','pending',456)",
  );
  await migrate();
  const row = (
    await database().query(
      "SELECT * FROM admin_role_events WHERE id='event-existing'",
    )
  ).rows[0];
  assert.equal(row.user_id, "admin-existing");
  assert.equal(row.created_at, 456);
  assert.equal(row.previous_role, "member");
  assert.equal(row.source, "server_cli");
  assert.equal(row.actor_id, null);
  const account = (
    await database().query("SELECT * FROM users WHERE id='admin-existing'")
  ).rows[0];
  assert.equal(account.username, "原管理员");
  assert.equal(account.password_hash, "existing-hash");
  assert.equal(account.role, "admin");
});
