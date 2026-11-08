import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { stdin, stdout } from "node:process";
import { database, databasePath, migrate } from "../src/lib/server/db";
import {
  adminCandidate,
  createAdminAccount,
  grantAdmin,
} from "../src/lib/server/admin-provision";
import { ACCESS_LABELS } from "../src/lib/auth-types";
const usage = "用法：npm run admin:create -- [管理员手机号]";
// Readline owns terminal input; mute its output while accepting passwords.
class PromptOutput extends Writable {
  muted = false;
  get columns() {
    return stdout.columns;
  }
  _write(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    if (this.muted) callback();
    else stdout.write(chunk, encoding, callback);
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(
      `${usage}\n新手机号：终端内输入账户名、密码和确认密码，直接创建管理员。\n已有账号：确认后授予管理员权限，保留账户名、原密码和数据。\n密码不接受命令行参数，也不会回显。`,
    );
    return;
  }
  if (args.length > 1 || args.some((arg) => arg.startsWith("-")))
    throw Error(usage);
  if (!stdin.isTTY || !stdout.isTTY)
    throw Error(
      "请在交互式终端运行此命令；密码需在终端中输入，不接受命令参数或管道输入。",
    );
  const output = new PromptOutput();
  const terminal = createInterface({ input: stdin, output, terminal: true });
  const abort = new AbortController();
  terminal.on("SIGINT", () => abort.abort());
  terminal.on("close", () => abort.abort());
  async function ask(label: string, secret = false) {
    if (!secret) return terminal.question(label, { signal: abort.signal });
    stdout.write(label);
    output.muted = true;
    try {
      return await terminal.question("", { signal: abort.signal });
    } finally {
      output.muted = false;
      stdout.write("\n");
    }
  }
  let databaseOpened = false;
  try {
    const phone = (args[0] ?? (await ask("管理员手机号："))).trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) throw Error("请输入有效的 11 位手机号");
    databaseOpened = true;
    await migrate();
    console.log(`工作区数据库：${databasePath()}`);
    const existing = await adminCandidate(phone);
    if (existing) {
      console.log(
        `已有账号：${existing.username} · ${existing.phone} · ${ACCESS_LABELS[existing.access_status]}`,
      );
      if (existing.role === "admin" && existing.access_status === "approved") {
        console.log("该账号已经是管理员，无需修改。");
        return;
      }
      const answer = await ask(
        "确认将此账号设为管理员？保留原密码和数据，现有会话将退出。输入 yes 确认：",
      );
      if (answer.trim().toLowerCase() !== "yes") {
        console.log("已取消，账号未修改。");
        return;
      }
      abort.signal.throwIfAborted();
      const result = await grantAdmin(phone, existing.id);
      console.log(
        result.changed
          ? "已设为管理员。请使用原手机号和密码重新登录。"
          : "该账号已经是管理员，无需修改。",
      );
    } else {
      const username = await ask("管理员账户名（2–20 个字符）：");
      const password = await ask("管理员密码（至少 8 位，不回显）：", true);
      const confirmation = await ask("再次输入密码（不回显）：", true);
      abort.signal.throwIfAborted();
      const account = await createAdminAccount({
        phone,
        username,
        password,
        confirmation,
      });
      console.log(`管理员已创建：${account.username} · ${account.phone}`);
      console.log("请使用该手机号和密码登录，从头像菜单进入管理后台。");
    }
  } finally {
    terminal.close();
    output.end();
    if (databaseOpened) await database().end();
  }
}
try {
  await main();
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    console.error("\n已取消。");
    process.exitCode = 130;
  } else {
    console.error(error instanceof Error ? error.message : "创建管理员失败");
    process.exitCode = 1;
  }
}
