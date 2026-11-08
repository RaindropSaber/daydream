"use client";

import { Flag, LockKeyhole, Plus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudio } from "./context";
import { StageToolbar } from "./stage-toolbar";
import { StatusBadge, date } from "./common";

export function CompleteScheme({ onNewScheme }: { onNewScheme: () => void }) {
  const { run, episode, jobs, mutate, confirm, dirty } = useStudio();
  if (!run) return null;
  const previous = episode?.runs.find(
    (candidate) => candidate.id !== run.id && candidate.finished_at,
  );
  const working = jobs.some(
    (job) => job.run_id === run.id && ["queued", "running"].includes(job.state),
  );
  const ready = run.statuses?.finish === "approved" && !!run.current_export;
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-5">
      <StageToolbar
        meta={
          <StatusBadge
            value={run.finished_at ? "approved" : working ? "running" : "draft"}
          />
        }
      >
        <div className="flex flex-nowrap gap-2">
          {run.current_export && (
            <Button variant="outline" asChild>
              <a href={run.current_export.content.url} download>
                <Download />
                下载成片
              </a>
            </Button>
          )}
          {episode?.locked_at ? null : run.finished_at ? (
            <Button onClick={onNewScheme}>
              <Plus />
              新建可编辑方案
            </Button>
          ) : (
            <Button
              disabled={!ready || working || dirty}
              onClick={() =>
                confirm({
                  title: "结束并锁定方案？",
                  description:
                    (previous
                      ? `本集只能有一个已结束方案。「${previous.name}」的结束节点将退回未结束，已有内容保留。`
                      : "") +
                    "结束后，此方案只能查看和下载。概览和预览将以此方案为准。",
                  label: "结束并锁定",
                  action: () => mutate("complete-run").then(() => {}),
                })
              }
            >
              <LockKeyhole />
              结束并锁定方案
            </Button>
          )}
        </div>
      </StageToolbar>
      <div className="flex items-start gap-3">
        {episode?.locked_at || run.finished_at ? (
          <LockKeyhole className="mt-1 size-6 text-emerald-600" />
        ) : (
          <Flag className="mt-1 size-6 text-primary" />
        )}
        <div>
          <h3 className="text-lg font-semibold">
            {episode?.locked_at
              ? "本集已永久锁定"
              : run.finished_at
                ? "此方案已结束"
                : "结束此制作方案"}
          </h3>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            {episode?.locked_at
              ? "可以查看和下载，无法编辑或新建方案。"
              : run.finished_at
                ? `${date(run.finished_at)} 已锁定。继续修改请新建方案。`
                : "结束后将锁定此方案，并将成片展示在项目概览。继续修改需新建方案。"}
          </p>
        </div>
      </div>
      {run.current_export && (
        <video
          controls
          src={run.current_export.content.url}
          className="max-h-80 w-full rounded-lg bg-slate-950"
        />
      )}
      {!episode?.locked_at &&
        !run.finished_at &&
        (working || !ready || dirty) && (
          <p className="text-sm text-muted-foreground">
            {working
              ? "仍有任务在处理，请等待任务结束。"
              : !ready
                ? "请先在「合成导出」中导出有效成片。"
                : "请先保存当前修改，再结束方案。"}
          </p>
        )}
    </div>
  );
}
