import {
  assert,
  chosen,
  fresh,
  inputs,
  locate,
  PROFILES,
  segments,
  selected,
  status,
  STEPS,
  TITLES,
  type Json,
  type Project,
  type Run,
} from "../domain";
import { projectPrompt } from "../creative-spec";
import { listJobs } from "./repository";

const empty = { type: "object", properties: {}, additionalProperties: false };

export function workflowSummary(p: Project, r: Run) {
  return {
    run_id: r.id,
    name: r.name,
    model: r.model,
    video_model_capabilities: PROFILES[r.model],
    finished_at: r.finished_at ?? null,
    project_config_revision: r.project_config_revision ?? 0,
    stages: Object.fromEntries(
      STEPS.map((step) => [
        step,
        {
          title: TITLES[step],
          status: status(p, r, step),
          selected_version_id: selected(r, step)?.id ?? null,
          latest_version_id: r.steps[step]?.versions.at(-1)?.id ?? null,
        },
      ]),
    ),
  };
}

// Project scope comes from the request/job, never from model arguments.
export function creationReadTools(scope: {
  load: () => Promise<Project | null>;
  episodeId?: string;
  runId?: string;
  source?: "live" | "job_snapshot";
}) {
  const get = async () => {
    const p = await scope.load();
    assert(p, "项目尚未创建，没有已保存的环节内容，请依据当前表单");
    return p;
  };
  const current = (p: Project, args: Json = {}) => {
    const eid = args.episode_id || scope.episodeId;
    assert(eid, "请指定要读取的分集");
    const episode = p.episodes.find((e) => e.id === eid);
    assert(episode, "分集不属于当前项目");
    return locate(
      p,
      eid,
      args.run_id ||
        (eid === scope.episodeId ? scope.runId : undefined) ||
        episode.active_run,
    );
  };
  const target = {
    episode_id: { type: "string", maxLength: 100 },
    run_id: { type: "string", maxLength: 100 },
  };
  return [
    {
      name: "get_project_context",
      readOnly: true,
      description:
        "读取当前项目已保存的名称与简介、视频制作设置与分集/方案目录。项目未创建时返回 exists=false；未保存内容以 current_form 为准。",
      parameters: empty,
      async execute() {
        const p = await scope.load();
        if (!p) return { exists: false };
        return {
          exists: true,
          source: scope.source || "live",
          updated: p.updated,
          id: p.id,
          title: p.title,
          brief: p.brief,
          production: p.production,
          production_prompt: projectPrompt(p),
          episodes: p.episodes.map((e) => ({
            id: e.id,
            title: e.title,
            number: e.number,
            brief: e.brief,
            target_duration: e.target_duration ?? null,
            locked_at: e.locked_at ?? null,
            active_run: e.active_run,
            runs: e.runs.map((r) => ({
              id: r.id,
              name: r.name,
              finished_at: r.finished_at ?? null,
            })),
          })),
        };
      },
    },
    {
      name: "get_workflow_status",
      readOnly: true,
      description:
        "读取指定分集方案各环节的 empty/draft/approved/stale 状态、选中/最新版本 ID、结束状态和近期任务。仅在上下文已有分集时可省略 episode_id；否则先用 get_project_context 查目录并显式指定分集。项目级制作设置不依赖此工具。",
      parameters: { ...empty, properties: target },
      async execute(args: Json) {
        const p = await get();
        const { e, r } = current(p, args);
        const jobs = await listJobs(p.id);
        return {
          source: scope.source || "live",
          episode_id: e.id,
          locked_at: e.locked_at ?? null,
          ...workflowSummary(p, r),
          tasks: jobs
            .filter((j) => j.run_id === r.id)
            .slice(0, 20)
            .map((j) => ({
              id: j.id,
              kind: j.kind,
              state: j.state,
              message: j.message,
            })),
          tasks_source: "live",
        };
      },
    },
    {
      name: "get_stage_content",
      readOnly: true,
      description:
        "读取一个环节的版本目录、当前选中稿、有效已确认稿与最新草稿的完整内容；可指定 version_id 读取历史稿。仅在上下文已有分集时可省略 episode_id，否则先用 get_project_context 查目录并显式指定分集。其他分集/方案仅限当前项目。项目级制作设置不依赖此工具。generation 返回实际片段时长/有效性，finish 返回导出记录。",
      parameters: {
        ...empty,
        properties: {
          ...target,
          stage: { type: "string", enum: [...STEPS] },
          version_id: { type: "string", maxLength: 100 },
        },
        required: ["stage"],
      },
      async execute(args: Json) {
        const p = await get();
        const { r } = current(p, args);
        const state = status(p, r, args.stage);
        const versions = r.steps[args.stage]?.versions || [];
        const requested = args.version_id
          ? versions.find((v) => v.id === args.version_id)
          : null;
        assert(!args.version_id || requested, "版本不属于指定环节");
        return {
          source: scope.source || "live",
          stage: args.stage,
          status: state,
          expected_inputs: inputs(p, r, args.stage),
          versions: versions.map(({ id, number, approved, created }) => ({
            id,
            number,
            approved: !!approved,
            created,
          })),
          selected_version: selected(r, args.stage) ?? null,
          approved_version:
            state === "approved" ? (selected(r, args.stage) ?? null) : null,
          latest_draft: versions.filter((v) => !v.approved).at(-1) ?? null,
          requested_version: requested,
          ...(args.stage === "generation"
            ? {
                model: r.model,
                capabilities: PROFILES[r.model],
                clips: segments(r).map((s) => ({
                  segment_id: s.id,
                  title: s.title,
                  selected_clip: chosen(r, s.id) ?? null,
                  fresh: fresh(r, s),
                  available: !!chosen(r, s.id) && fresh(r, s),
                })),
              }
            : {}),
          ...(args.stage === "finish" ? { exports: r.exports } : {}),
        };
      },
    },
    {
      name: "get_project_assets",
      readOnly: true,
      description:
        "读取当前项目素材库与真实版本引用，用于保持角色/场景/道具一致性；不编造资源 ID、版本或图片地址。",
      parameters: empty,
      async execute() {
        return { assets: (await get()).assets };
      },
    },
  ];
}
