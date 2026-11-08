"use client";
import { useEffect, useState } from "react";
import {
  Clapperboard,
  ChevronDown,
  LogOut,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import type { AuthUser } from "@/lib/auth-types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
export function AccountHeader({
  user,
  onHome,
  onProjects,
  onModels,
  onLogout,
  onLogin,
  onAdmin,
  onAccount,
}: {
  user?: Pick<AuthUser, "username" | "role" | "avatarUrl">;
  onAccount?: () => void;
  onProjects?: () => void;
  onAdmin?: () => void;
  onHome: () => void;
  onLogin?: () => void;
  onModels?: () => void;
  onLogout?: (action: () => Promise<void>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (user?.role !== "admin") return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/admin/summary", {
          cache: "no-store",
        });
        if (response.ok) {
          const data = await response.json();
          if (active) setPending(data.pending);
        }
      } catch {
        /* Keep the menu usable while offline. */
      }
    };
    const refreshEvent = () => {
      void refresh();
    };
    window.addEventListener("admin-access-changed", refreshEvent);
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    return () => {
      active = false;
      window.removeEventListener("admin-access-changed", refreshEvent);
      clearInterval(timer);
    };
  }, [user?.role]);
  const exit = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw Error("退出失败，请重试");
      window.location.assign("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "退出失败");
      setBusy(false);
    }
  };
  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center justify-between border-b bg-card px-4 lg:px-6">
      <button
        type="button"
        onClick={onHome}
        aria-label="Daydream 首页"
        className="flex items-center gap-2 rounded-sm text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Clapperboard className="size-4 text-primary" />
        Daydream
      </button>
      {!user && onLogin && (
        <Button size="sm" onClick={onLogin}>
          登录
        </Button>
      )}
      {user && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onProjects || (() => window.location.assign("/workspace"))}
            aria-label={`${user.username}，我的项目`}
            title="我的项目"
            className="grid size-8 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary outline-none ring-offset-background transition hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <img
              src={user.avatarUrl}
              alt={`${user.username}的头像`}
              width={32}
              height={32}
              referrerPolicy="no-referrer"
              className="size-8 rounded-full"
            />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="打开账号菜单"
                disabled={busy}
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="w-48">
              <DropdownMenuLabel className="truncate">
                {user.username}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={
                  onAccount || (() => window.location.assign("/account"))
                }
              >
                <UserRound />
                账户设置
              </DropdownMenuItem>
              {user.role === "admin" && (
                <DropdownMenuItem
                  onSelect={onAdmin || (() => window.location.assign("/admin"))}
                >
                  <ShieldCheck />
                  管理后台{pending > 0 && ` · ${pending} 条待审核`}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onModels}>
                <Settings2 />
                模型配置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={busy}
                onSelect={() => (onLogout ? onLogout(exit) : void exit())}
              >
                <LogOut />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </header>
  );
}
