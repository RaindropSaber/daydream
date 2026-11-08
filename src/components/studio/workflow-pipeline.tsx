"use client";

import type { ReactNode } from "react";

import {
  Check,
  CircleAlert,
  Clock3,
  FileText,
  Clapperboard,
  Image,
  Film,
  Download,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TITLES, type Job, type Run } from "@/lib/types";
import { workflowStages, type WorkflowState } from "@/lib/workflow";

const icons = {
  story: FileText,
  director: Clapperboard,
  characters: Image,
  generation: Film,
  finish: Download,
  complete: Flag,
};
const states: Record<WorkflowState, { label: string; color: string }> = {
  empty: { label: "未开始", color: "bg-muted text-muted-foreground" },
  blocked: { label: "待前序确认", color: "bg-muted text-muted-foreground" },
  draft: {
    label: "待确认",
    color: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  approved: {
    label: "已完成",
    color:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  stale: {
    label: "需更新",
    color: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  running: {
    label: "生成中",
    color: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  queued: {
    label: "排队中",
    color: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  failed: {
    label: "任务失败",
    color: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
};

export function WorkflowPipeline({
  run,
  jobs,
  current,
  onSelect,
  controls,
}: {
  controls?: ReactNode;
  run: Run;
  jobs: Job[];
  current: string;
  onSelect: (step: string) => void;
}) {
  const stages = workflowStages(run, jobs, true);
  const complete = stages.filter((stage) => stage.status === "approved").length;
  return (
    <section
      aria-label="制作流水线"
      className="flex min-h-0 w-14 shrink-0 flex-col overflow-hidden rounded-xl border bg-card md:w-48 xl:w-52"
    >
      <div className="shrink-0 border-b p-3">
        {controls && <div className="mb-3">{controls}</div>}
        <p className="text-center text-[11px] text-muted-foreground md:text-left">
          {complete} / {stages.length}
          <span className="hidden md:inline"> 步已完成</span>
        </p>
        <div
          role="progressbar"
          aria-label="制作阶段完成进度"
          aria-valuemin={0}
          aria-valuemax={stages.length}
          aria-valuenow={complete}
          aria-valuetext={`${complete} / ${stages.length} 步已完成`}
          className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-emerald-500 transition-[width] motion-reduce:transition-none"
            style={{ width: `${(complete / stages.length) * 100}%` }}
          />
        </div>
      </div>
      <nav
        aria-label="制作阶段"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 md:p-2"
      >
        <ol className="flex flex-col gap-2">
          {stages.map((stage, index) => {
            const viewing = current === stage.id;
            const appearance = states[stage.state];
            const stateLabel =
              stage.id === "generation" && stage.state === "draft"
                ? "待生成 / 采用"
                : stage.newDraft && stage.state === "empty"
                  ? "待审阅"
                  : appearance.label;
            const Icon =
              stage.state === "approved"
                ? Check
                : stage.state === "running"
                  ? LoaderCircle
                  : stage.state === "queued"
                    ? Clock3
                    : stage.state === "failed"
                      ? CircleAlert
                      : stage.state === "stale"
                        ? RefreshCw
                        : stage.state === "blocked"
                          ? LockKeyhole
                          : icons[stage.id];
            return (
              <li key={stage.id} className="relative min-w-0">
                <button
                  type="button"
                  aria-current={viewing ? "step" : undefined}
                  aria-label={`${index + 1} ${TITLES[stage.id]} · ${stateLabel} · ${stage.detail}`}
                  title={`${TITLES[stage.id]} · ${stateLabel}：${stage.detail}`}
                  onClick={() => onSelect(stage.id)}
                  className={cn(
                    "relative w-full px-1 py-3 text-left transition-colors outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:p-3",
                    viewing ? "text-primary" : "text-foreground",
                  )}
                >
                  {viewing && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary"
                    />
                  )}
                  <div className="flex items-center justify-center gap-2 md:justify-start">
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full",
                        appearance.color,
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-3.5",
                          stage.state === "running" &&
                            "animate-spin motion-reduce:animate-none",
                        )}
                      />
                    </span>
                    <span className="hidden text-sm font-medium md:inline">
                      {TITLES[stage.id]}
                    </span>
                    <span className="ml-auto hidden text-[10px] tabular-nums text-muted-foreground md:inline">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="mt-2 hidden items-center gap-2 pl-8 md:flex">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        appearance.color,
                      )}
                    >
                      {stateLabel}
                    </span>
                    {viewing && (
                      <span className="text-[10px] text-primary">正在查看</span>
                    )}
                  </div>
                  <span className="mt-1.5 hidden pl-8 text-[11px] leading-5 text-muted-foreground line-clamp-2 md:block">
                    {stage.detail}
                  </span>
                </button>
                {index < stages.length - 1 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-10 -bottom-5 left-1/2 w-px bg-border md:left-6"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </section>
  );
}
