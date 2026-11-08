"use client";
import { useState, type FormEvent } from "react";
import { ShieldCheck, LoaderCircle } from "lucide-react";
import { AccountHeader } from "./studio/account-header";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
export function AdminSetup({
  token: initialToken,
  invalid,
}: {
  token?: string;
  invalid: boolean;
}) {
  const [token, setToken] = useState(initialToken || "");
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    invalid ? "初始化口令无效或已过期，请使用服务器启动日志中的有效链接。" : "",
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      setError("请输入有效的 11 位手机号");
      return;
    }
    if (password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/admin-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          phone: phone.trim(),
          username,
          password,
          confirmation,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "初始化失败");
      window.history.replaceState(null, "", "/admin/setup");
      window.location.replace("/admin");
    } catch (error) {
      setError(error instanceof Error ? error.message : "初始化失败");
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AccountHeader onHome={() => window.location.assign("/")} />
      <main className="grid flex-1 place-items-center px-5 py-10">
        <section className="w-full max-w-md rounded-2xl border bg-card p-7">
          <div className="mb-5 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <h1 className="text-xl font-semibold">首次初始化管理员</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            设置第一个管理员账号，完成后即可进入管理后台。已有账号的手机号请填写原密码。
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {!initialToken && (
              <div className="space-y-2">
                <label htmlFor="setup-token" className="text-sm font-medium">
                  初始化口令
                </label>
                <Input
                  id="setup-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  required
                  disabled={busy}
                />
                <p className="text-xs leading-6 text-muted-foreground">
                  请打开服务器首次启动时输出的初始化链接，或粘贴对应口令。口令
                  24 小时有效。
                </p>
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="setup-phone" className="text-sm font-medium">
                管理员手机号
              </label>
              <Input
                id="setup-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                required
                maxLength={11}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="setup-name" className="text-sm font-medium">
                账户名
              </label>
              <Input
                id="setup-name"
                autoComplete="nickname"
                required
                minLength={2}
                maxLength={20}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="setup-password" className="text-sm font-medium">
                密码
              </label>
              <Input
                id="setup-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={256}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                placeholder="至少 8 位"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="setup-confirm" className="text-sm font-medium">
                确认密码
              </label>
              <Input
                id="setup-confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={256}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={busy}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              完成初始化并进入后台
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
