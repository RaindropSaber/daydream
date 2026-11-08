"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import type { AuthUser } from "@/lib/auth-types";
import { AccountHeader } from "./studio/account-header";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export function AccountSettings({
  user: initialUser,
  profile,
}: {
  user: AuthUser;
  profile: { username: string; phone: string };
}) {
  const router = useRouter();
  const [user, setUser] = useState(initialUser);
  const [username, setUsername] = useState(profile.username);
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const dirty =
    username.trim() !== user.username ||
    !!(currentPassword || newPassword || confirmation);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty && !savingPassword) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, savingPassword]);
  async function post(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status === 401) {
      window.location.assign("/?login=1");
      throw Error("登录已过期，请重新登录");
    }
    if (!response.ok) throw Error(data.error || "保存失败，请重试");
    return data;
  }
  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (savingName || savingPassword) return;
    setSavingName(true);
    setNameError("");
    setNameSaved(false);
    try {
      const data = await post("/api/account", { username: username.trim() });
      setUser({ ...user, username: data.username });
      setUsername(data.username);
      setNameSaved(true);
      toast.success("账户名已保存");
      router.refresh();
    } catch (error) {
      setNameError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSavingName(false);
    }
  }
  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (savingPassword || savingName) return;
    setPasswordError("");
    if (newPassword !== confirmation) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("新密码不能与原密码相同");
      return;
    }
    setSavingPassword(true);
    try {
      await post("/api/account/password", {
        currentPassword,
        newPassword,
        confirmation,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      window.location.assign("/?login=1");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "修改失败");
      setSavingPassword(false);
    }
  }
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <AccountHeader
        user={user}
        onHome={() => window.location.assign("/")}
        onModels={() => window.location.assign("/models")}
      />
      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-5 py-8 sm:px-8">
        <div className="mb-7">
          <h1 className="text-2xl font-semibold">账户设置</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            管理你的账户名与登录密码。
          </p>
        </div>
        <section className="mb-5 rounded-xl border bg-card p-6 sm:p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary/7 text-primary">
              <UserRound className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">基本信息</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                账户名用于个人展示，手机号用于登录。
              </p>
            </div>
          </div>
          <div className="mb-6 flex items-center gap-4">
            <img
              src={user.avatarUrl}
              alt={`${user.username}的头像`}
              width={48}
              height={48}
              referrerPolicy="no-referrer"
              className="size-12 rounded-full"
            />
            <div>
              <p className="text-sm font-medium">{user.username}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                头像根据手机号自动生成
              </p>
            </div>
          </div>
          <form onSubmit={saveName} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="account-name" className="text-sm font-medium">
                账户名
              </label>
              <Input
                id="account-name"
                name="username"
                autoComplete="nickname"
                required
                minLength={2}
                maxLength={20}
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setNameError("");
                  setNameSaved(false);
                }}
                disabled={savingName || savingPassword}
              />
              <p className="text-xs text-muted-foreground">
                2–20 个字符，保存后同步显示在头像菜单中。
              </p>
            </div>
            <div className="space-y-2">
              <label htmlFor="account-phone" className="text-sm font-medium">
                手机号
              </label>
              <div className="relative">
                <Input
                  id="account-phone"
                  type="tel"
                  readOnly
                  aria-readonly="true"
                  value={profile.phone}
                  className="bg-muted/40 pr-10 text-muted-foreground"
                />
                <LockKeyhole className="pointer-events-none absolute right-3 top-2.5 size-4 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">
                已绑定的登录手机号，不支持修改。
              </p>
            </div>
            {nameError && (
              <p role="alert" className="text-sm text-destructive">
                {nameError}
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={
                  savingName ||
                  savingPassword ||
                  username.trim() === user.username
                }
              >
                {savingName && <LoaderCircle className="size-4 animate-spin" />}
                保存账户名
              </Button>
              {nameSaved && (
                <span
                  role="status"
                  className="flex items-center gap-1 text-sm text-muted-foreground"
                >
                  <Check className="size-4" />
                  已保存
                </span>
              )}
            </div>
          </form>
        </section>
        <section className="rounded-xl border bg-card p-6 sm:p-7">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary/7 text-primary">
              <LockKeyhole className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold">修改密码</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                验证原密码后，设置新的登录密码。
              </p>
            </div>
          </div>
          <form onSubmit={savePassword} className="space-y-5">
            {[
              {
                id: "current-password",
                label: "原密码",
                value: currentPassword,
                set: setCurrentPassword,
                complete: "current-password",
              },
              {
                id: "new-password",
                label: "新密码",
                value: newPassword,
                set: setNewPassword,
                complete: "new-password",
              },
              {
                id: "confirm-password",
                label: "确认新密码",
                value: confirmation,
                set: setConfirmation,
                complete: "new-password",
              },
            ].map((field) => (
              <div className="space-y-2" key={field.id}>
                <label htmlFor={field.id} className="text-sm font-medium">
                  {field.label}
                </label>
                <Input
                  id={field.id}
                  type={visible ? "text" : "password"}
                  autoComplete={field.complete}
                  required
                  minLength={field.id === "current-password" ? undefined : 8}
                  maxLength={256}
                  placeholder={
                    field.id === "new-password" ? "至少 8 位" : undefined
                  }
                  value={field.value}
                  onChange={(event) => {
                    field.set(event.target.value);
                    setPasswordError("");
                  }}
                  disabled={savingName || savingPassword}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              aria-pressed={visible}
              className="flex items-center gap-2 rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {visible ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              {visible ? "隐藏密码" : "显示密码"}
            </button>
            {passwordError && (
              <p role="alert" className="text-sm text-destructive">
                {passwordError}
              </p>
            )}
            <p className="text-xs leading-6 text-muted-foreground">
              修改成功后会退出所有设备，请使用新密码重新登录。
            </p>
            <Button type="submit" disabled={savingName || savingPassword}>
              {savingPassword && (
                <LoaderCircle className="size-4 animate-spin" />
              )}
              修改密码
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
