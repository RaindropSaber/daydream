import { STEPS, TITLES, type Job, type Run } from "./types";

export type WorkflowState =
  | "empty"
  | "draft"
  | "approved"
  | "stale"
  | "blocked"
  | "queued"
  | "running"
  | "failed";
export type WorkflowStep = (typeof STEPS)[number];

function jobStep(job: Job): string | undefined {
  if (["video", "video-batch"].includes(job.kind)) return "generation";
  if (["characters", "character-image"].includes(job.kind)) return "characters";
  if (job.kind === "finish") return "finish";
  if (["text", "conversation"].includes(job.kind))
    return job.target_step || job.step;
  return undefined;
}

export function workflowStages(run: Run, jobs: Job[]) {
  const selected = (step: string) =>
    run.steps[step]?.versions.find((v) => v.id === run.steps[step].selected);
  const segments = selected("director")?.content.segments || [];
  const settings = selected("characters")?.content.characters || [];
  const validClips = segments.filter((segment: { id: string }) => {
    const clip = run.media[segment.id]?.find(
      (v) => v.id === run.media_selection[segment.id],
    );
    return (
      clip && clip.content.quality !== "draft" && run.media_fresh?.[segment.id]
    );
  }).length;
  return STEPS.map((id, index) => {
    const status = run.statuses?.[id] || "empty";
    const tasks = jobs
      .filter((job) => job.run_id === run.id && jobStep(job) === id)
      .sort((a, b) => b.created - a.created);
    const active = tasks.find((job) =>
      ["running", "queued"].includes(job.state),
    );
    const previous = index > 0 ? STEPS[index - 1] : undefined;
    const blocked = previous && run.statuses?.[previous] !== "approved";
    const latest = tasks[0];
    const failed =
      latest?.state === "failed" &&
      status !== "approved" &&
      latest.created >= (selected(id)?.created || 0);
    const state: WorkflowState = active
      ? (active.state as "running" | "queued")
      : failed
        ? "failed"
        : status === "stale"
          ? "stale"
          : status === "approved"
            ? "approved"
            : blocked
              ? "blocked"
              : status;
    const version = selected(id);
    const newDraft = run.steps[id]?.versions.some(
      (v) =>
        v.id !== version?.id &&
        !v.approved &&
        v.number > (version?.number || 0),
    );
    let detail = {
      story: version
        ? `${status === "approved" ? "已确认" : status === "stale" ? "待复核" : "当前稿"} v${version.number} · ${String(version.content.text || "").replace(/\s/g, "").length} 字`
        : "故事正文与创作方向",
      director: segments.length
        ? `${segments.length} 个视频片段`
        : "镜头节拍与视频片段",
      characters: settings.length
        ? `${settings.filter((entry: { images?: unknown[]; url?: string }) => entry.images?.length || entry.url).length} / ${settings.length} 项已有设定图`
        : "人物、场景与道具",
      generation: segments.length
        ? `${validClips} / ${segments.length} 段已采用有效视频`
        : "逐段生成与采用视频",
      complete: run.finished_at ? "已结束 · 方案只读" : "确认完成并锁定此方案",
      finish: run.current_export
        ? "成片可预览、下载"
        : run.exports.length
          ? "历史成片保留，需重新导出"
          : "剪辑、字幕与成片导出",
    }[id];
    if (active) detail = active.message || "任务正在处理";
    else if (failed) detail = latest.message || "任务未完成，请查看详情";
    else if (newDraft)
      detail = version ? `${detail} · 有新草稿` : "已有草稿，待审阅采用";
    const action =
      state === "running" || state === "queued"
        ? `查看${TITLES[id]}进度`
        : state === "failed"
          ? `处理${TITLES[id]}任务`
          : status === "stale"
            ? `更新${TITLES[id]}`
            : newDraft
              ? `审阅${TITLES[id]}草稿`
              : status === "draft"
                ? id === "generation"
                  ? "生成并采用视频"
                  : `确认${TITLES[id]}`
                : id === "complete"
                  ? "结束并锁定方案"
                  : id === "finish"
                    ? "导出成片"
                    : `开始${TITLES[id]}`;
    return {
      id,
      status,
      state,
      detail,
      action,
      previous,
      blocked: !!blocked,
      newDraft: !!newDraft,
    };
  });
}
