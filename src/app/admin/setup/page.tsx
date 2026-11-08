import type { Metadata } from "next";
import Link from "next/link";
import { initialSetupStatus } from "@/lib/server/initial-setup";
import { AdminSetup } from "@/components/admin-setup";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "首次初始化 · Daydream",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const status = await initialSetupStatus(token);
  if (status === "complete")
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold">系统已完成初始化</h1>
          <p className="text-sm leading-7 text-muted-foreground">
            请正常登录。需要添加管理员时，可在管理后台将已通过的用户设为管理员，或使用服务器上的
            admin:create 命令。
          </p>
          <Link href="/?login=1" className="text-sm text-primary">
            前往登录
          </Link>
        </div>
      </main>
    );
  return (
    <AdminSetup
      token={status === "ready" ? token : undefined}
      invalid={status === "invalid"}
    />
  );
}
