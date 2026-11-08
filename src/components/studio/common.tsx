"use client";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
export const labels: Record<string, string> = {
  empty: "未开始",
  draft: "待确认",
  approved: "已确认",
  stale: "待更新",
  queued: "排队中",
  running: "处理中",
  done: "已完成",
  failed: "失败",
  candidate: "待采用",
};
export function StatusBadge({ value }: { value: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-normal",
        ["approved", "done"].includes(value) &&
          "bg-emerald-50 text-emerald-700",
        ["running", "queued"].includes(value) && "bg-blue-50 text-blue-700",
        ["stale", "failed"].includes(value) && "bg-amber-50 text-amber-800",
      )}
    >
      {value === "running" && <LoaderCircle className="size-3 animate-spin" />}
      {labels[value] || value}
    </Badge>
  );
}
export function Heading({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 mb-4 flex shrink-0 flex-wrap items-start justify-between gap-4 bg-background py-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="py-16 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}
export const date = (n: number) =>
  new Date(n * 1000).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
export const kindNames: Record<string, string> = {
  character: "人物",
  scene: "场景",
  prop: "道具",
  style: "风格",
  voice: "声音",
  video: "参考视频",
};
