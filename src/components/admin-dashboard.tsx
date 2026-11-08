"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  Users,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { AccessAccount, AccessStatus, AuthUser } from "@/lib/auth-types";
import { ACCESS_LABELS } from "@/lib/auth-types";
import { AccountHeader } from "./studio/account-header";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
const actions = {
  promote: {
    label: "设为管理员",
    description:
      "该用户将获得申请审核、账号管理和设置其他管理员的权限。保留原密码和数据，现有登录会话将退出，需重新登录。",
  },
  approve: {
    label: "通过申请",
    description: "通过后，该用户可以使用申请时的手机号和密码登录工作台。",
  },
  reject: { label: "拒绝申请", description: "拒绝后，该账号无法登录。" },
  disable: {
    label: "停用账号",
    description: "停用后会立即注销该用户的登录会话，保留其项目和配置。",
  },
  enable: {
    label: "恢复使用",
    description: "恢复后，该用户可以重新登录，继续使用原有项目和配置。",
  },
};
type ReviewAction = keyof typeof actions;
const date = (value: number | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
export function AdminDashboard({ user }: { user: AuthUser }) {
  const [accounts, setAccounts] = useState<AccessAccount[]>([]);
  const [filter, setFilter] = useState<"all" | AccessStatus>("pending");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    account: AccessAccount;
    action: ReviewAction;
  } | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/accounts", {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign("/?login=1");
        return;
      }
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "读取失败");
      setAccounts(data.accounts);
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);
  async function submitReview() {
    if (!review || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: review.account.id,
          action: review.action,
          expectedStatus: review.account.access_status,
          expectedRole: review.account.role,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setReview(null);
          await load();
        }
        throw Error(data.error || "审核失败");
      }
      toast.success(`${actions[review.action].label}成功`);
      setReview(null);
      window.dispatchEvent(new Event("admin-access-changed"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  const members = accounts.filter((account) => account.role !== "admin");
  const pending = members.filter(
    (account) => account.access_status === "pending",
  ).length;
  const approved = accounts.filter(
    (account) => account.access_status === "approved",
  ).length;
  const visible = accounts.filter(
    (account) =>
      (filter === "all" || account.access_status === filter) &&
      `${account.username} ${account.phone}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <AccountHeader
        user={user}
        onHome={() => window.location.assign("/")}
        onModels={() => window.location.assign("/models")}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-5 py-8 sm:px-8">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-primary">
              <ShieldCheck className="size-4" />
              邀请制内测
            </div>
            <h1 className="text-2xl font-semibold">管理后台</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              查看用户的加入申请，确认后开放工作台访问权限。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            disabled={loading}
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            刷新
          </Button>
        </div>
        <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              label: "待审核申请",
              value: pending,
              Icon: Clock3,
              target: "pending" as const,
            },
            {
              label: "已开通账号",
              value: approved,
              Icon: UserCheck,
              target: "approved" as const,
            },
            {
              label: "全部账号",
              value: accounts.length,
              Icon: Users,
              target: "all" as const,
            },
          ].map(({ label, value, Icon, target }) => (
            <button
              key={label}
              onClick={() => setFilter(target)}
              className="flex items-center gap-4 rounded-xl border bg-card p-5 text-left transition hover:border-primary/30"
            >
              <span className="grid size-10 place-items-center rounded-xl bg-primary/7 text-primary">
                <Icon className="size-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </div>
            </button>
          ))}
        </div>
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b p-4">
            <Tabs
              value={filter}
              onValueChange={(value) => setFilter(value as typeof filter)}
            >
              <TabsList aria-label="账号状态筛选" className="max-w-full">
                {(
                  [
                    "pending",
                    "approved",
                    "rejected",
                    "disabled",
                    "all",
                  ] as const
                ).map((status) => (
                  <TabsTrigger key={status} value={status}>
                    {status === "all" ? "全部" : ACCESS_LABELS[status]}
                    {status === "pending" && pending > 0 ? ` ${pending}` : ""}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-60">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="搜索用户名称或手机号"
                placeholder="搜索用户名称或手机号"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          {error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 border-b bg-destructive/5 px-5 py-3 text-sm text-destructive"
            >
              <span>{error}</span>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                重试
              </Button>
            </div>
          )}
          {loading && !accounts.length ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在读取申请…
            </div>
          ) : !visible.length ? (
            <div className="grid place-items-center gap-3 py-20 text-center">
              <Clock3 className="size-7 text-muted-foreground/40" />
              <p className="text-sm font-medium">
                {query
                  ? "没有匹配的用户"
                  : filter === "pending"
                    ? "暂无待审核申请"
                    : "暂无用户"}
              </p>
              <p className="px-4 text-xs text-muted-foreground">
                {filter === "pending" && !query
                  ? "用户在首页提交加入申请后，会出现在这里。"
                  : "可切换状态或调整搜索内容。"}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">用户</TableHead>
                  <TableHead>手机号</TableHead>
                  <TableHead>申请时间</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>处理时间</TableHead>
                  <TableHead className="pr-5 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="pl-5 font-medium">
                      {account.username}
                      {account.role === "admin" && (
                        <span className="ml-2 text-xs text-primary">
                          管理员
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {account.phone}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {date(account.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          account.access_status === "approved"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {ACCESS_LABELS[account.access_status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {date(account.reviewed_at)}
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex justify-end gap-2">
                        {account.role === "admin" ? (
                          <span className="text-xs text-muted-foreground">
                            管理员账号
                          </span>
                        ) : account.access_status === "pending" ? (
                          <>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                setReview({ account, action: "approve" })
                              }
                            >
                              <Check className="size-3.5" />
                              通过
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                setReview({ account, action: "reject" })
                              }
                            >
                              <X className="size-3.5" />
                              拒绝
                            </Button>
                          </>
                        ) : account.access_status === "approved" ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                setReview({ account, action: "promote" })
                              }
                            >
                              <ShieldCheck className="size-3.5" />
                              设为管理员
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                setReview({ account, action: "disable" })
                              }
                            >
                              <UserX className="size-3.5" />
                              停用
                            </Button>
                          </>
                        ) : account.access_status === "disabled" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              setReview({ account, action: "enable" })
                            }
                          >
                            恢复使用
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            已处理
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="border-t px-5 py-3 text-xs leading-6 text-muted-foreground">
            列表每 15
            秒自动更新。未经审核的账号无法登录；停用账号会立即失效其登录会话。
          </div>
        </section>
      </main>
      <Dialog
        open={!!review}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{review && actions[review.action].label}</DialogTitle>
            <DialogDescription>
              {review && actions[review.action].description}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <p className="font-medium">{review.account.username}</p>
              <p className="mt-2 text-muted-foreground">
                {review.account.phone}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReview(null)}
              disabled={busy}
            >
              取消
            </Button>
            <Button
              variant={
                review?.action === "disable" || review?.action === "reject"
                  ? "destructive"
                  : "default"
              }
              onClick={() => void submitReview()}
              disabled={busy}
            >
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              {review && actions[review.action].label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
