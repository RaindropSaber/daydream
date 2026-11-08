"use client";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  Clapperboard,
  Clock3,
  ShieldX,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { AccessStatus } from "@/lib/auth-types";
export function LoginDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [accessStatus, setAccessStatus] = useState<Exclude<
    AccessStatus,
    "approved"
  > | null>(null);
  const [phone, setPhone] = useState("");
  const [username, setUsername] = useState("");
  const [registering, setRegistering] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function changeOpen(value: boolean) {
    if (busy) return;
    if (!value) {
      setPassword("");
      setConfirmation("");
      setAccessStatus(null);
      setError("");
      setVisible(false);
      setRegistering(false);
      setUsername("");
    }
    onOpenChange(value);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) {
      setError("请输入有效的 11 位手机号");
      return;
    }
    if (registering && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          password,
          username: registering ? username.trim() : undefined,
          confirmation: registering ? confirmation : undefined,
        }),
      });
      const result = await response.json();
      if (result.registrationRequired && !registering) {
        setRegistering(true);
        setConfirmation("");
        setVisible(false);
        setBusy(false);
        return;
      }
      if (!response.ok) throw Error(result.error || "登录失败");
      if (["pending", "rejected", "disabled"].includes(result.status)) {
        setAccessStatus(result.status);
        setPassword("");
        setConfirmation("");
        setVisible(false);
        setBusy(false);
        return;
      }
      window.location.assign("/workspace");
    } catch (error) {
      setError(error instanceof Error ? error.message : "登录失败，请重试");
      setBusy(false);
    }
  }
  if (accessStatus)
    return (
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-w-[420px] rounded-2xl p-7">
          <div className="mb-2 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
            {accessStatus === "pending" ? (
              <Clock3 className="size-6" />
            ) : (
              <ShieldX className="size-6" />
            )}
          </div>
          <DialogHeader>
            <DialogTitle className="text-xl">
              {accessStatus === "pending"
                ? "申请审核中"
                : accessStatus === "rejected"
                  ? "申请未通过"
                  : "账号已停用"}
            </DialogTitle>
            <DialogDescription className="pt-3 leading-7">
              {accessStatus === "pending"
                ? "你的加入申请已提交给管理员。审核通过后，即可使用当前手机号和密码登录工作台。"
                : accessStatus === "rejected"
                  ? "管理员暂未通过你的加入申请，如需了解原因，请联系管理员。"
                  : "该账号暂时无法使用工作台，请联系管理员。"}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            申请手机号：{phone.slice(0, 3)}****{phone.slice(-4)}
          </p>
          <Button className="mt-2 w-full" onClick={() => changeOpen(false)}>
            我知道了
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setAccessStatus(null);
              setRegistering(false);
              setUsername("");
              setError("");
            }}
          >
            重新登录
          </Button>
        </DialogContent>
      </Dialog>
    );
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[420px] overflow-y-auto rounded-2xl p-6 sm:p-7">
        <div className="mb-2 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
          <Clapperboard className="size-5" />
        </div>
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {registering ? "申请加入 Daydream" : "登录 Daydream"}
          </DialogTitle>
          <DialogDescription className="pt-2 leading-6">
            {registering
              ? "当前为邀请制内测，填写用户名称并确认密码后提交申请，管理员通过后即可登录。"
              : "使用手机号和密码登录。新用户可提交加入申请，审核通过后开放使用。"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-3 space-y-5">
          {registering && (
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                用户名称
              </label>
              <Input
                id="username"
                name="username"
                autoComplete="nickname"
                autoFocus
                required
                minLength={2}
                maxLength={20}
                placeholder="怎么称呼你？2–20 个字符"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setError("");
                }}
                disabled={busy}
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">
                这个名称会显示在你的头像菜单中。
              </p>
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="phone" className="text-sm font-medium">
              手机号
            </label>
            <div className="flex h-11 items-center rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
              <span className="border-r px-3 text-sm text-muted-foreground">
                +86
              </span>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                required
                maxLength={11}
                placeholder="请输入手机号"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setRegistering(false);
                  setUsername("");
                  setConfirmation("");
                  setError("");
                }}
                disabled={busy}
                className="h-full border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              密码
            </label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete={registering ? "new-password" : "current-password"}
                required
                minLength={8}
                maxLength={256}
                placeholder="请输入密码，至少 8 位"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                disabled={busy}
                className="h-11 pr-11"
              />
              <button
                type="button"
                aria-label={visible ? "隐藏密码" : "显示密码"}
                onClick={() => setVisible(!visible)}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {visible ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            {registering && (
              <p className="text-xs leading-5 text-muted-foreground">
                请记住此密码，审核通过后用于登录。
              </p>
            )}
          </div>
          {registering && (
            <div className="space-y-2">
              <label
                htmlFor="password-confirmation"
                className="text-sm font-medium"
              >
                确认密码
              </label>
              <Input
                id="password-confirmation"
                name="confirmation"
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={256}
                placeholder="请再次输入密码"
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setError("");
                }}
                disabled={busy}
                className="h-11"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="h-11 w-full" disabled={busy}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {registering ? "提交加入申请" : "登录"}
            {!busy && <ArrowRight className="size-4" />}
          </Button>
        </form>
        <p className="mt-1 text-center text-xs leading-5 text-muted-foreground">
          手机号用于账号登录，用户名称用于个人展示。
        </p>
      </DialogContent>
    </Dialog>
  );
}
