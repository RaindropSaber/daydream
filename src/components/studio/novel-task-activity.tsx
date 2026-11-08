"use client";
import { useEffect, useState } from "react";
import { api, useAction } from "./context";
import { activeNovelTask, type NovelTask } from "@/lib/novel";
import { Button } from "@/components/ui/button";

export function NovelTaskActivity({ projectId }: { projectId: string }) {
  const [task, setTask] = useState<NovelTask | null>(null);
  const [error, setError] = useState("");
  const { busy, action } = useAction();
  useEffect(() => {
    let alive = true;
    let revision: number | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api(
          `/api/studio/projects/${projectId}/story${revision ? `?revision=${revision}` : ""}`,
        );
        if (result.story) revision = result.story.revision;
        if (alive) {
          setTask(result.task);
          setError("");
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "读取任务进度失败");
      } finally {
        if (alive) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId]);
  if (!task && !error) return null;
  return (
    <div
      className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2"
      role="status"
    >
      {task && (
        <>
          <p>
            {task.message} · 本次已写 {task.written} 章
          </p>
          <p className="text-xs text-muted-foreground">
            任务自动保存，收起浮窗不影响后台执行。
          </p>
          {activeNovelTask(task) && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const result = await api(
                    `/api/studio/projects/${projectId}/story/novel`,
                    { action: "pause" },
                  );
                  setTask(result.task);
                })
              }
            >
              暂停任务
            </Button>
          )}
          {task.error && <p className="text-destructive">{task.error}</p>}
        </>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}
