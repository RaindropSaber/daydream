import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { database, migrate } from "../src/lib/server/db";
import { authenticate, sessionUser } from "../src/lib/server/auth";
import { reviewAccount } from "../src/lib/server/admin";
import { createAdminAccount } from "../src/lib/server/admin-provision";
import {
  accountProfile,
  updateAccountName,
  changeAccountPassword,
} from "../src/lib/server/account";
const password = "test-account-password";
let folder: string, adminId: string;
before(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "daydream-account-"));
  process.env.DATA_DIR = folder;
  process.env.SQLITE_PATH = path.join(folder, "test.sqlite3");
  await migrate();
  const result = await createAdminAccount({
    phone: "15000000000",
    username: "管理员",
    password,
    confirmation: password,
  });
  adminId = result.id;
});
after(async () => {
  await database().end();
  await fs.rm(folder, { recursive: true, force: true });
});
async function approved(phone: string) {
  await authenticate({
    phone,
    password,
    confirmation: password,
    username: "原账户名",
  });
  const row = (
    await database().query("SELECT id FROM users WHERE phone=$1", [phone])
  ).rows[0];
  await reviewAccount(adminId, row.id, "approve", "pending");
  const result = await authenticate({ phone, password });
  if (result.status !== "authenticated") throw Error("No account session");
  return result;
}
test("account settings require a current approved session", async () => {
  await assert.rejects(accountProfile(), /请先登录/);
  await assert.rejects(
    updateAccountName(undefined, { username: "新账户名" }),
    /请先登录/,
  );
  await assert.rejects(changeAccountPassword(undefined, {}), /请先登录/);
  const user = await approved("13800138000");
  await reviewAccount(adminId, user.user.id, "disable", "approved");
  await assert.rejects(accountProfile(user.token), /请先登录/);
  await assert.rejects(
    updateAccountName(user.token, { username: "新账户名" }),
    /请先登录/,
  );
});
test("name changes affect only the current account; phone and permissions cannot be altered", async () => {
  const a = await approved("13900139000"),
    b = await approved("13700137000");
  assert.deepEqual(await accountProfile(a.token), {
    username: "原账户名",
    phone: "13900139000",
  });
  for (const username of ["", "a", " ", "a".repeat(21), "合法\n名称"])
    await assert.rejects(updateAccountName(a.token, { username }), /账户名/);
  for (const extra of [
    { phone: "13600136000" },
    { userId: b.user.id },
    { role: "admin" },
    { access_status: "approved" },
  ])
    await assert.rejects(
      updateAccountName(a.token, { username: "新账户名", ...extra }),
      /手机号不可修改/,
    );
  const result = await updateAccountName(a.token, { username: " 新账户名 " });
  assert.deepEqual(result, { username: "新账户名", phone: "13900139000" });
  const current = await sessionUser(a.token);
  assert.equal(current?.username, "新账户名");
  assert.equal(current?.avatarUrl, a.user.avatarUrl);
  assert.equal(current?.role, "member");
  assert.equal((await accountProfile(b.token)).username, "原账户名");
  assert.ok(!("password_hash" in result));
});
test("password changes validate original and confirmation, revoke all own sessions and preserve other users", async () => {
  const a = await approved("13600136000"),
    b = await approved("13500135000");
  const second = await authenticate({ phone: "13600136000", password });
  if (second.status !== "authenticated") throw Error("No session");
  const values = {
    currentPassword: password,
    newPassword: "new-account-password",
    confirmation: "new-account-password",
  };
  await assert.rejects(
    changeAccountPassword(a.token, {
      ...values,
      currentPassword: "incorrect-password",
    }),
    /原密码不正确/,
  );
  await assert.rejects(
    changeAccountPassword(a.token, {
      ...values,
      newPassword: "short",
      confirmation: "short",
    }),
    /至少 8 位/,
  );
  await assert.rejects(
    changeAccountPassword(a.token, { ...values, confirmation: "mismatch" }),
    /不一致/,
  );
  await assert.rejects(
    changeAccountPassword(a.token, {
      currentPassword: password,
      newPassword: password,
      confirmation: password,
    }),
    /不能与原密码相同/,
  );
  await assert.rejects(
    changeAccountPassword(a.token, { ...values, phone: "13500135000" }),
    /不允许修改/,
  );
  await changeAccountPassword(a.token, values);
  assert.equal(await sessionUser(a.token), null);
  assert.equal(await sessionUser(second.token), null);
  assert.ok(await sessionUser(b.token));
  await assert.rejects(
    authenticate({ phone: "13600136000", password }),
    /手机号或密码不正确/,
  );
  const next = await authenticate({
    phone: "13600136000",
    password: values.newPassword,
  });
  assert.equal(next.status, "authenticated");
  if (next.status === "authenticated")
    assert.equal((await accountProfile(next.token)).phone, "13600136000");
});
test("incorrect original password attempts are throttled", async () => {
  const a = await approved("13400134000");
  const values = {
    currentPassword: "incorrect-password",
    newPassword: "new-account-password",
    confirmation: "new-account-password",
  };
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      changeAccountPassword(a.token, values),
      /原密码不正确/,
    );
  await assert.rejects(
    changeAccountPassword(a.token, { ...values, currentPassword: password }),
    /尝试次数过多/,
  );
  assert.ok(await sessionUser(a.token));
});
test("concurrent password updates accept only one change", async () => {
  const a = await approved("13300133000");
  const results = await Promise.allSettled([
    changeAccountPassword(a.token, {
      currentPassword: password,
      newPassword: "concurrent-password-a",
      confirmation: "concurrent-password-a",
    }),
    changeAccountPassword(a.token, {
      currentPassword: password,
      newPassword: "concurrent-password-b",
      confirmation: "concurrent-password-b",
    }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(await sessionUser(a.token), null);
});
