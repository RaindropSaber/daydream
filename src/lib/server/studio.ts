import { adoptedAssetVersion } from "../asset-library";
import { saveAssetDefinition, mutateAssetLibrary } from "./asset-library";
import { storySource } from "./stories";
import { dialogueText } from "../storyboard";
import { stateId, stateFields } from "../asset-state";
import { projectPrompt } from "../creative-spec";
import {
  type Project,
  type Run,
  type Episode,
  type Job,
  type Json,
  uid,
  now,
  copy,
  assert,
  AppError,
  newRun,
  addVersion,
  inputs,
  selected,
  segments,
  chosen,
  fresh,
  mediaHash,
  digest,
  PROFILES,
  requireStep,
  status,
  generationPlanFresh,
  view,
} from "../domain";
import { DEFAULT_EPISODE_DURATION } from "../types";
import { transaction } from "./db";
import {
  loadProject,
  saveProject,
  editProject,
  saveJob,
  loadJob,
  listJobs,
  busy,
  listProjects,
} from "./repository";
import { config, publicConfig, updateConfig } from "./settings";
import {
  validate,
  validateWorld,
  normalizePlan,
  aggregate,
  normalizeSettings,
  registerSettings,
} from "./validation";
import { imageSource } from "./files";
import { videoPayload } from "./providers";
import { wanBase } from "../models";
import { imageRequest } from "./image-provider";
import { compileStoryboard, resourceKey } from "./segment-planner";
export async function index() {
  return {
    projects: await listProjects(),
    profiles: PROFILES,
    config: await publicConfig(),
  };
}
export async function project(id: string) {
  return { project: view(await loadProject(id)), jobs: await listJobs(id) };
}
export async function enqueue(
  p: Project,
  e: Episode,
  r: Run,
  kind: string,
  details: Json,
  db: any,
) {
  assert(!(await busy(r.id, [kind], db)), "同类任务正在执行，请等待完成");
  const j: Job = {
    id: uid(),
    project_id: p.id,
    episode_id: e.id,
    run_id: r.id,
    kind,
    state: "queued",
    message: "等待执行",
    created: now(),
    ...copy(details),
  };
  await saveJob(j, db);
  return { job_id: j.id };
}
export async function queueImages(
  p: Project,
  e: Episode,
  r: Run,
  c: Json,
  db: any,
  previous: Json[] = [],
) {
  const cfg = await config();
  const connection = imageRequest(cfg, cfg.image_model, "");
  return enqueueImage();
  async function enqueueImage() {
    const exists = (await listJobs(p.id, db, true)).some(
      (j) =>
        j.run_id === r.id &&
        j.kind === "character-image" &&
        j.segment_id === c.asset_id &&
        (j.state_id || "default") === stateId(c) &&
        ["queued", "running"].includes(j.state),
    );
    assert(!exists, "本项图片正在生成");
    const job: Job = {
      id: uid(),
      project_id: p.id,
      episode_id: e.id,
      run_id: r.id,
      kind: "character-image",
      state: "queued",
      message: "等待生成设定图",
      created: now(),
      segment_id: c.asset_id,
      state_id: stateId(c),
      entry_hash: digest(c),
      inputs: inputs(p, r, "characters"),
      images: copy(previous),
      snapshot: {
        entry: copy(c),
        world: copy(selected(r, "characters")!.content.world || {}),
        style: p.production.style,
        project_prompt: projectPrompt(p),
        direction: selected(r, "director")?.content.prompt || "",
      },
      image_model: cfg.image_model,
      key_fingerprint: digest(connection.key),
      image_base: connection.base,
    };
    await saveJob(job, db);
    return { job_id: job.id };
  }
}
export async function videoDetails(p: Project, e: Episode, r: Run, b: Json) {
  assert(generationPlanFresh(r), "分镜或资源已变化，请先重新组合生成片段");
  requireStep(p, r, "director");
  requireStep(p, r, "characters");
  const s = segments(r).find((s) => s.id === b.segment_id);
  assert(s, "片段不存在");
  assert(
    ["draft", "standard", "final"].includes(b.quality || "standard"),
    "生成质量无效",
  );
  const ready = await videoPayload(
    p,
    r,
    s,
    b.quality || "standard",
    b.draft_id,
  );
  return {
    provider: ready.provider,
    base_url: ready.base,
    payload: ready.payload,
    segment_id: s.id,
    quality: b.quality || "standard",
    input_hash: mediaHash(r, s),
    key_fingerprint: digest(ready.key),
  };
}
export function batchBasis(p: Project, r: Run, cfg: Json) {
  return {
    model: r.model,
    ratio: p.production.ratio,
    plan: selected(r, "director")?.id,
    settings: selected(r, "characters")?.id,
    ...(r.generation_plan
      ? { compiled: digest(r.generation_plan.segments) }
      : {}),
    ...(r.model.startsWith("wan")
      ? {
          video_options: r.video_options || {},
          base_url: wanBase(cfg.wan_region, cfg.wan_workspace),
        }
      : {}),
  };
}
export function candidate(r: Run, s: Json) {
  return [chosen(r, s.id), ...[...(r.media[s.id] || [])].reverse()].find(
    (v) =>
      v &&
      v.input_hash === mediaHash(r, s) &&
      v.content.quality !== "draft" &&
      (!segments(r).some((x) => x.depends_on?.includes(s.id)) ||
        v.content.remote_url),
  );
}
export async function previewBatch(p: Project, e: Episode, r: Run) {
  const temp = copy(r),
    items: Json[] = [];
  for (const s of segments(temp)) {
    let v = candidate(temp, s);
    items.push({
      segment_id: s.id,
      title: s.title,
      duration: s.duration,
      reuse: !!v,
    });
    if (!v) {
      await videoDetails(p, e, temp, { segment_id: s.id });
      v = {
        id: "pending-" + s.id,
        number: 0,
        content: {
          quality: "standard",
          remote_url: "https://batch.invalid/preview.mp4",
          duration: s.duration,
        },
        inputs: {},
        input_hash: mediaHash(temp, s),
        created: now(),
      };
      (temp.media[s.id] ??= []).push(v);
    }
    temp.media_selection[s.id] = v.id;
  }
  const cfg = await config();
  return {
    token: digest({
      basis: batchBasis(p, r, cfg),
      selection: r.media_selection,
      candidates: Object.fromEntries(
        Object.entries(r.media).map(([sid, vs]) => [sid, vs.map((v) => v.id)]),
      ),
    }),
    items,
    new_count: items.filter((i) => !i.reuse).length,
    new_seconds: items
      .filter((i) => !i.reuse)
      .reduce((n, i) => n + i.duration, 0),
    reuse_count: items.filter((i) => i.reuse).length,
  };
}
export async function createProject(b: Json) {
  assert(
    typeof b.title === "string" && b.title.trim() && b.title.length <= 100,
    "请填写项目名称（最多100字）",
  );
  assert(
    typeof (b.brief ?? "") === "string" && (b.brief || "").length <= 10000,
    "项目简介最多10000字",
  );
  assert(
    Object.keys(b).every((key) => ["title", "brief"].includes(key)),
    "新建项目仅需名称与简介，视频要求请在制作设置中填写",
  );
  const p: Project = {
    id: uid(),
    title: b.title.trim(),
    brief: String(b.brief || "").slice(0, 10000),
    production: {
      style: "电影写实",
      ratio: "16:9",
      prompt: "",
      adaptation: "",
      revision: 0,
    },
    assets: [],
    episodes: [],
    created: now(),
    updated: now(),
  };
  await transaction((db) => saveProject(p, db));
  return { project: view(p) };
}
export async function mutate(
  pid: string,
  action: string,
  b: Json,
): Promise<Json> {
  return editProject(pid, async (p, db) => {
    if (action === "project-settings") {
      assert(
        typeof b.title === "string" && b.title.trim() && b.title.length <= 100,
        "请填写项目名称（最多100字）",
      );
      assert(
        typeof b.brief === "string" && b.brief.length <= 10000,
        "项目简介最多10000字",
      );
      assert(
        b.base_updated === p.updated,
        "项目已在其他页面更新，请重新载入后再保存",
      );
      assert(
        Object.keys(b).every((key) =>
          ["title", "brief", "base_updated", "episode_id", "run_id"].includes(
            key,
          ),
        ),
        "项目仅包含名称与简介，请到制作设置修改视频要求",
      );
      p.title = b.title.trim();
      p.brief = b.brief;
      return { ok: true };
    }
    if (action === "production-settings") {
      assert(
        b.base_revision === p.production.revision,
        "制作设置已在其他页面更新，请重新打开后再保存",
      );
      assert(
        typeof b.style === "string" && b.style.trim() && b.style.length <= 100,
        "请填写视觉风格（最多100字）",
      );
      assert(["16:9", "9:16", "1:1"].includes(b.ratio), "画幅不正确");
      assert(
        typeof b.prompt === "string" && b.prompt.length <= 12000,
        "美术规范最多12000字",
      );
      assert(
        typeof b.adaptation === "string" && b.adaptation.length <= 12000,
        "改编要求最多12000字",
      );
      assert(
        Object.keys(b).every((key) =>
          [
            "style",
            "ratio",
            "prompt",
            "adaptation",
            "base_revision",
            "episode_id",
            "run_id",
          ].includes(key),
        ),
        "制作设置包含未知字段",
      );
      const next = {
        style: b.style.trim(),
        ratio: b.ratio,
        prompt: b.prompt,
        adaptation: b.adaptation,
      };
      if (
        Object.entries(next).some(
          ([key, value]) => p.production[key as keyof typeof next] !== value,
        )
      ) {
        p.production = { ...next, revision: p.production.revision + 1 };
        for (const episode of p.episodes)
          for (const run of episode.runs)
            if (!episode.locked_at && !run.finished_at)
              run.project_config_revision = p.production.revision;
      }
      return { ok: true };
    }
    if (action === "episodes") {
      assert(typeof b.title === "string" && b.title.trim(), "请填写集名");
      const targetDuration =
        b.target_duration === undefined
          ? DEFAULT_EPISODE_DURATION
          : b.target_duration;
      assert(
        Number.isSafeInteger(targetDuration) && targetDuration > 0,
        "预设时长需为大于 0 的整数秒数",
      );
      const r = newRun();
      r.project_config_revision = p.production.revision;
      r.model = (await config()).model;
      const e: Episode = {
        id: uid(),
        title: b.title.trim().slice(0, 100),
        brief: String(b.brief || "").slice(0, 10000),
        target_duration: targetDuration,
        number: Math.max(0, ...p.episodes.map((episode) => episode.number)) + 1,
        active_run: r.id,
        runs: [r],
        created: now(),
      };
      p.episodes.push(e);
      return { episode_id: e.id, run_id: r.id };
    }
    if (action === "episode-settings") {
      const e = p.episodes.find((episode) => episode.id === b.episode_id);
      assert(e, "分集不存在");
      assert(!e.locked_at, "本集已永久锁定，只能查看，不能编辑");
      assert(
        typeof b.title === "string" && b.title.trim() && b.title.length <= 100,
        "请填写集名（最多100字）",
      );
      assert(
        typeof b.brief === "string" && b.brief.length <= 10000,
        "本集剧情最多10000字",
      );
      assert(
        Number.isSafeInteger(b.target_duration) && b.target_duration > 0,
        "预设时长需为大于 0 的整数秒数",
      );
      assert(
        b.base_episode &&
          digest(b.base_episode) ===
            digest({
              title: e.title,
              brief: e.brief,
              target_duration: e.target_duration ?? DEFAULT_EPISODE_DURATION,
            }),
        "本集信息已在其他页面更新，请重新打开编辑后再保存",
      );
      Object.assign(e, {
        title: b.title.trim(),
        brief: b.brief,
        target_duration: b.target_duration,
      });
      return { episode_id: e.id };
    }
    if (action === "asset") return saveAssetDefinition(p, b);
    if (
      ["asset-state", "asset-adopt", "asset-update-references"].includes(action)
    )
      return mutateAssetLibrary(p, action, b, db);
    if (action === "asset-image") {
      const a = p.assets.find((a) => a.id === b.asset_id);
      assert(
        a && ["character", "scene", "prop"].includes(a.kind),
        "请选择人物、场景或道具资源",
      );
      const v = a.versions.find((v) => v.id === (b.version_id || a.selected));
      assert(v && v.description?.trim(), "请先填写资源设定描述");
      const active = await db.query(
        "SELECT 1 FROM jobs WHERE project_id=$1 AND kind='asset-image' AND data->>'segment_id'=$2 AND COALESCE(data->>'state_id','default')=$3 AND state IN ('queued','running') LIMIT 1",
        [p.id, a.id, stateId(v)],
      );
      assert(!active.rowCount, "本项资源正在出图，请等待完成");
      const cfg = await config();
      const connection = imageRequest(cfg, cfg.image_model, "");
      assert(
        !b.note || (typeof b.note === "string" && b.note.length <= 2000),
        "调整要求最多2000字",
      );
      const job: Job = {
        id: uid(),
        project_id: p.id,
        episode_id: "",
        run_id: "",
        kind: "asset-image",
        state: "queued",
        message: "等待生成资源图",
        created: now(),
        segment_id: a.id,
        state_id: stateId(v),
        snapshot: {
          entry: {
            ...copy(v),
            reference_images: copy(
              v.images?.length
                ? v.images
                : adoptedAssetVersion(a, stateId(v))?.images ||
                    v.reference_images ||
                    [],
            ),
            asset_id: a.id,
            version: v.id,
            name: a.name,
            kind: a.kind,
          },
          world: {},
          style: p.production.style,
          project_prompt: projectPrompt(p),
          direction: "",
          generation_note: b.note || "",
        },
        image_model: cfg.image_model,
        key_fingerprint: digest(connection.key),
        image_base: connection.base,
      };
      await saveJob(job, db);
      return { job_id: job.id };
    }
    if (["lock-episode", "delete-episode"].includes(action)) {
      const e = p.episodes.find((episode) => episode.id === b.episode_id);
      assert(e, "分集不存在");
      const tasks = await listJobs(p.id, db, true);
      assert(
        !tasks.some(
          (job) =>
            job.episode_id === e.id &&
            ["queued", "running"].includes(job.state),
        ),
        "本集还有任务正在处理，请等待任务结束",
      );
      if (action === "lock-episode") {
        assert(!e.locked_at, "本集已永久锁定");
        // Preserve the viewing state even if shared project settings change later.
        const snapshot = view(p).episodes.find(
          (episode) => episode.id === e.id,
        )!;
        for (const run of e.runs) {
          const frozen = snapshot.runs.find(
            (candidate) => candidate.id === run.id,
          )!;
          run.locked_view = {
            statuses: frozen.statuses,
            media_fresh: frozen.media_fresh,
            current_export: frozen.current_export,
          };
        }
        e.locked_at = now();
      } else {
        await db.query("DELETE FROM jobs WHERE episode_id=$1", [e.id]);
        for (const table of [
          "selected_versions",
          "media_selections",
          "conversation_messages",
          "content_versions",
          "media_versions",
          "exports",
        ])
          await db.query(
            `DELETE FROM ${table} WHERE run_id IN (SELECT id FROM production_runs WHERE episode_id=$1)`,
            [e.id],
          );
        await db.query("DELETE FROM production_runs WHERE episode_id=$1", [
          e.id,
        ]);
        await db.query("DELETE FROM episodes WHERE id=$1", [e.id]);
        p.episodes = p.episodes.filter((episode) => episode.id !== e.id);
      }
      return { ok: true };
    }
    const { e, r } = locateRun();
    function locateRun() {
      const e = p.episodes.find((e) => e.id === b.episode_id);
      assert(e, "分集不存在");
      const r = e.runs.find((r) => r.id === (b.run_id || e.active_run));
      assert(r, "制作方案不存在");
      return { e, r };
    }
    assert(!e.locked_at, "本集已永久锁定，只能查看，不能编辑或新建版本");
    if (action === "save-storyboard") {
      assert(!r.finished_at, "此方案已结束，请新建方案后编辑");
      requireStep(p, r, "story");
      assert(
        !(await busy(
          r.id,
          ["character-image", "characters", "video", "video-batch"],
          db,
        )),
        "当前方案还有生成任务，请等待结束后保存分镜",
      );
      assert(
        b.base_director === r.steps.director.selected &&
          b.base_resources === r.steps.characters.selected,
        "分镜或资源已更新，请重新载入后再保存",
      );
      const content = validate(r, "director", {
        ...copy(b.content),
        planning_mode: "storyboard",
        segments: [],
      });
      r.storyboard_mode = true;
      const dv = addVersion(
        r,
        "director",
        content,
        p,
        "storyboard",
        true,
        true,
      );
      const resources = validate(
        r,
        "characters",
        copy(b.resources || { world: {}, characters: [] }),
      );
      for (const beat of content.beats) {
        for (const match of String(beat.description).matchAll(
          /@resource:([\w-]+)/g,
        ))
          assert(
            resources.characters.some(
              (entry: Json) =>
                resourceKey(entry) === match[1] &&
                entry.segment_ids.includes(beat.id),
            ),
            "分镜标签未绑定到本镜资源，请检查引用",
          );
      }
      if (b.confirm) {
        assert(
          resources.characters.every(
            (entry: Json) => entry.images?.length || entry.url,
          ),
          "请先完成资源参考图，再确认分镜与资源",
        );
      }
      registerSettings(p, e.id, resources);
      const rv = addVersion(
        r,
        "characters",
        resources,
        p,
        "storyboard",
        true,
        b.confirm === true,
      );
      return { director_version: dv.id, resource_version: rv.id };
    }
    if (action === "compile-video-plan") {
      assert(!r.finished_at, "此方案已结束，请新建方案后编辑");
      requireStep(p, r, "director");
      requireStep(p, r, "characters");
      assert(
        !(await busy(r.id, ["video", "video-batch"], db)),
        "视频任务进行中，不能重新组合片段",
      );
      const direction = selected(r, "director")!;
      assert(
        direction.content.planning_mode === "storyboard",
        "此方案使用历史片段，请先在分镜与资源中保存新版本",
      );
      const resources = selected(r, "characters")!;
      const grouped = compileStoryboard(
        direction.content,
        resources.content.characters,
        r.model,
      );
      r.generation_plan = {
        segments: grouped,
        model: r.model,
        director_version: direction.id,
        resource_version: resources.id,
        created: now(),
      };
      return copy(r.generation_plan);
    }
    if (action === "runs") {
      const n = newRun(String(b.name || "新制作方案").slice(0, 100));
      n.project_config_revision = p.production.revision;
      n.model = (await config()).model;
      if (b.inherit === "all") {
        for (const k of [
          "model",
          "steps",
          "media",
          "media_selection",
          "exports",
          "conversations",
          "video_options",
          "storyboard_mode",
          "generation_plan",
        ])
          if (r[k] !== undefined) n[k] = copy(r[k]);
      } else if (b.inherit === "story" && selected(r, "story")) {
        const v = selected(r, "story")!;
        addVersion(n, "story", v.content, p, "fork", true, !!v.approved);
      } else
        assert(
          ["story", "empty", undefined].includes(b.inherit),
          "继承方式不正确",
        );
      e.runs.push(n);
      e.active_run = n.id;
      return { run_id: n.id };
    }
    if (action === "switch-run") {
      e.active_run = r.id;
      return { ok: true };
    }
    assert(!r.finished_at, "此方案已结束，只能查看；请新建方案后编辑");
    if (action === "complete-run") {
      assert(
        status(p, r, "finish") === "approved",
        "请先导出有效成片，再结束方案",
      );
      const tasks = await listJobs(p.id, db, true);
      assert(
        !tasks.some(
          (j) => j.run_id === r.id && ["queued", "running"].includes(j.state),
        ),
        "还有任务正在处理，请等待任务结束",
      );
      // The project lock held by editProject makes replacing the finished
      // scheme atomic, including concurrent completion requests.
      for (const previous of e.runs) {
        if (previous.finished_at) {
          delete previous.finished_at;
          delete previous.production_snapshot;
          previous.project_config_revision = p.production.revision;
        }
      }
      r.finished_at = now();
      r.production_snapshot = copy(p.production);
      return { ok: true };
    }
    if (action === "model") {
      assert(PROFILES[b.model], "请选择支持的视频模型");
      assert(
        !(await busy(r.id, ["video", "video-batch"], db)),
        "视频生成期间不能切换模型",
      );
      r.model = b.model;
      return { ok: true };
    }
    if (action === "select-story") {
      assert(
        b.expected_selected === r.steps.story.selected,
        "选章来源已在其他页面变更，请刷新后重试",
      );
      const content = await storySource(p.id, b, db);
      const current = selected(r, "story");
      if (
        current?.approved &&
        digest(current.content) === digest(content) &&
        digest(current.inputs) === digest(inputs(p, r, "story"))
      )
        return { version_id: current.id };
      const version = addVersion(
        r,
        "story",
        content,
        p,
        "story-selection",
        true,
        true,
      );
      return { version_id: version.id };
    }
    assert(
      action !== "confirm-story",
      "请从本项目的故事中选择已定稿章节，视频内不再编写故事",
    );
    let step = b.step === "segments" ? "director" : b.step;
    if (["save-step", "adopt-step", "approve-step"].includes(action))
      assert(
        step !== "story",
        "请从本项目的故事中选择已定稿章节，视频内不再编写故事",
      );
    if (action === "save-step") {
      if (b.step === "segments")
        b.content = { ...selected(r, "director")?.content, ...b.content };
      const c = validate(r, step, copy(b.content));
      if (step === "characters") registerSettings(p, e.id, c);
      const v = addVersion(r, step, c, p, "manual", b.adopt === true);
      return { version_id: v.id };
    }
    if (action === "adopt-step") {
      const v = r.steps[step]?.versions.find((v) => v.id === b.version_id);
      assert(v, "版本不存在");
      if (step === "characters") {
        requireStep(p, r, "director");
        assert(
          digest(v.inputs) === digest(inputs(p, r, "characters")),
          "设定草稿依据已变更",
        );
        assert(
          !(await busy(r.id, ["characters", "character-image"], db)),
          "设定任务仍在执行",
        );
        registerSettings(p, e.id, v.content);
      }
      r.steps[step].selected = v.id;
      return { ok: true };
    }
    if (action === "approve-step") {
      const v = selected(r, step);
      assert(v && status(p, r, step) !== "stale", "当前版本待更新，不能确认");
      validate(r, step, v.content);
      if (step === "director") requireStep(p, r, "story");
      if (step === "characters") {
        requireStep(p, r, "director");
        assert(
          !(await busy(r.id, ["characters", "character-image"], db)),
          "设定图生成中",
        );
        for (const c of v.content.characters) {
          assert(c.images?.length || c.url, "请先生成或绑定设定图");
          for (const i of c.images || []) await imageSource(i);
        }
      }
      v.approved = true;
      return { ok: true };
    }
    if (action === "chat" || action === "generate-text" || action === "plan") {
      if (action === "plan") step = "director";
      const unified = action === "chat" && step === "assistant";
      assert(
        unified || ["director", "characters"].includes(step),
        "不支持此创作阶段",
      );
      if (step === "director") requireStep(p, r, "story");
      if (step === "characters") requireStep(p, r, "director");
      assert(
        (await publicConfig())[
          action === "chat" ? "agent_configured" : "text_configured"
        ],
        action === "chat"
          ? "请先配置功能（流程）的模型与服务连接"
          : "请先配置文字模型与服务连接",
      );
      if (action === "chat") {
        assert(
          typeof b.message === "string" &&
            b.message.trim() &&
            b.message.length <= 12000,
          "请输入1–12000字的消息",
        );
        (r.conversations[step] ??= []).push({
          id: uid(),
          role: "user",
          text: b.message.trim(),
          created: now(),
        });
      }
      await saveProject(p, db);
      return enqueue(
        p,
        e,
        r,
        action === "chat" ? "conversation" : "text",
        {
          step,
          page_context:
            typeof b.page_context === "string"
              ? b.page_context.slice(0, 100)
              : null,
          inputs: inputs(p, r, step),
          snapshot: { project: copy(p), episode: copy(e), run: copy(r) },
        },
        db,
      );
    }
    if (action === "aggregate-plan") {
      const v = r.steps.director.versions.find(
        (v) => v.id === (b.version_id || r.steps.director.selected),
      );
      assert(v, "请先选择方案版本");
      return {
        version_id: addVersion(
          r,
          "director",
          aggregate(r, v.content),
          p,
          "aggregation",
        ).id,
      };
    }
    if (action === "prepare-characters") {
      requireStep(p, r, "director");
      assert(
        (await publicConfig()).text_configured,
        "请先配置文本模型 API Key",
      );
      await saveProject(p, db);
      return enqueue(
        p,
        e,
        r,
        "characters",
        {
          inputs: inputs(p, r, "characters"),
          baseline: r.steps.characters.selected,
          snapshot: { project: copy(p), episode: copy(e), run: copy(r) },
        },
        db,
      );
    }
    if (
      [
        "edit-world",
        "edit-character",
        "new-resource-state",
        "remove-character",
        "bind-character",
      ].includes(action)
    ) {
      requireStep(p, r, "director");
      const v = selected(r, "characters");
      assert(
        v && digest(v.inputs) === digest(inputs(p, r, "characters")),
        "请先整理当前方案的设定集",
      );
      const c = copy(v.content);
      if (action === "edit-world") {
        const world = validateWorld(b.world);
        if (digest(world) !== digest(c.world)) {
          for (const e of c.characters) {
            e.reference_images = copy(
              e.images?.length ? e.images : e.url ? [{ url: e.url }] : [],
            );
            e.images = [];
            e.url = "";
            e.version = uid();
          }
        }
        c.world = world;
      }
      if (action === "remove-character")
        c.characters = c.characters.filter(
          (c: Json) =>
            !(
              c.asset_id === b.asset_id &&
              (!b.entry_version || c.version === b.entry_version)
            ),
        );
      if (action === "edit-character") {
        const entry = c.characters.find(
          (c: Json) =>
            c.asset_id === b.asset_id &&
            (!b.entry_version || c.version === b.entry_version),
        );
        assert(entry, "设定不存在");
        assert(
          typeof b.description === "string" &&
            b.description.trim() &&
            b.description.length <= 15000,
          "请填写完整设定（最多15000字）",
        );
        if (entry.description !== b.description) {
          entry.reference_images = copy(
            entry.images?.length ? entry.images : entry.reference_images || [],
          );
          entry.images = [];
          entry.url = "";
          entry.version = uid();
        }
        entry.description = b.description;
        entry.segment_ids = b.segment_ids;
      }
      if (action === "new-resource-state") {
        const source = c.characters.find(
          (entry: Json) =>
            entry.asset_id === b.asset_id && entry.version === b.entry_version,
        );
        assert(source, "原始设定不存在，请刷新后重试");
        assert(
          typeof b.state_name === "string" &&
            b.state_name.trim() &&
            b.state_name.length <= 80,
          "请填写状态名称（最多80字）",
        );
        assert(
          typeof b.description === "string" &&
            b.description.trim() &&
            b.description.length <= 15000,
          "请填写状态设定（最多15000字）",
        );
        assert(
          Array.isArray(b.tags) &&
            b.tags.length <= 12 &&
            b.tags.every((t: any) => typeof t === "string" && t.length <= 30),
          "标签格式不正确",
        );
        const entry = {
          ...copy(source),
          ...stateFields(source),
          state_id: uid(),
          state_name: b.state_name.trim(),
          tags: b.tags,
          version: uid(),
          base_version: source.version,
          description: b.description.trim(),
          reference_images: copy(
            source.images?.length
              ? source.images
              : source.url
                ? [{ url: source.url }]
                : source.reference_images || [],
          ),
          images: [],
          url: "",
          segment_ids: b.segment_ids,
          origin: "new-state",
        };
        assert(
          Array.isArray(b.segment_ids) && b.segment_ids.length,
          "请选择使用新状态的片段",
        );
        c.characters = c.characters
          .map((other: Json) =>
            other.asset_id === source.asset_id
              ? {
                  ...other,
                  segment_ids: other.segment_ids.filter(
                    (id: string) => !b.segment_ids.includes(id),
                  ),
                }
              : other,
          )
          .filter((other: Json) => other.segment_ids.length);
        c.characters.push(entry);
      }
      if (action === "bind-character") {
        const a = p.assets.find((a) => a.id === b.asset_id);
        assert(
          a && ["character", "scene", "prop"].includes(a.kind),
          "资源不存在",
        );
        const av = a.versions.find(
          (v) => v.id === (b.version_id || a.selected),
        );
        assert(av, "资源版本不存在");
        assert(
          Array.isArray(b.segment_ids) && b.segment_ids.length,
          "请选择使用片段",
        );
        const existing = c.characters.find(
          (entry: Json) =>
            entry.asset_id === a.id && stateId(entry) === stateId(av),
        );
        const segmentIds = [
          ...new Set([...(existing?.segment_ids || []), ...b.segment_ids]),
        ];
        c.characters = c.characters
          .map((entry: Json) =>
            entry.asset_id === a.id
              ? {
                  ...entry,
                  segment_ids: entry.segment_ids.filter(
                    (id: string) => !b.segment_ids.includes(id),
                  ),
                }
              : entry,
          )
          .filter(
            (entry: Json) =>
              entry.segment_ids.length &&
              !(entry.asset_id === a.id && stateId(entry) === stateId(av)),
          );
        c.characters.push({
          ...stateFields(av),
          asset_id: a.id,
          version: av.id,
          kind: a.kind,
          name: a.name,
          description: av.description,
          images: av.images || [],
          url: av.url || "",
          segment_ids: segmentIds,
          origin: "reused",
        });
      }
      validate(r, "characters", c);
      registerSettings(p, e.id, c);
      return {
        version_id: addVersion(r, "characters", c, p, "manual", true).id,
      };
    }
    if (action === "character-image" || action === "generate-all-settings") {
      requireStep(p, r, "director");
      assert(
        !(await busy(r.id, ["characters", "character-image"], db)),
        "设定图任务仍在执行",
      );
      let v = b.version_id
        ? r.steps.characters.versions.find((v) => v.id === b.version_id)
        : selected(r, "characters");
      assert(
        v && digest(v.inputs) === digest(inputs(p, r, "characters")),
        "请先准备当前方案的设定集",
      );
      registerSettings(p, e.id, v.content);
      await saveProject(p, db);
      const list =
        action === "character-image"
          ? v.content.characters.filter(
              (c: Json) =>
                c.asset_id === b.asset_id &&
                (!b.entry_version || c.version === b.entry_version),
            )
          : v.content.characters.filter(
              (c: Json) => !c.images?.length && !c.url,
            );
      assert(list.length, "没有需要生成的设定图");
      let previous: Json[] = [];
      if (b.resume_job_id) {
        const old = await loadJob(b.resume_job_id, db);
        assert(
          old.project_id === p.id &&
            old.run_id === r.id &&
            old.state === "failed" &&
            old.entry_hash === digest(list[0]),
          "只能继续当前设定对应的任务",
        );
        assert(
          !old.attempted_poses?.some(
            (pose: string) => !old.images.some((i: Json) => i.pose === pose),
          ),
          "上次提交结果不确定，请先核对控制台",
        );
        previous = old.images || [];
      }
      for (const entry of list) await queueImages(p, e, r, entry, db, previous);
      return { queued: list.length };
    }
    if (action === "video-options") {
      assert(r.model.startsWith("wan"), "此选项仅用于万相");
      assert(
        !(await busy(r.id, ["video", "video-batch"], db)),
        "视频生成中不能修改设置",
      );
      assert(
        segments(r).some((s) => s.id === b.segment_id) &&
          typeof b.first_frame === "string" &&
          b.first_frame.length <= 4096 &&
          typeof b.audio === "boolean",
        "首帧或声音格式错误",
      );
      (r.video_options ??= {})[b.segment_id] = {
        first_frame: b.first_frame,
        audio: b.audio,
      };
      return { ok: true };
    }
    if (action === "generate-video") {
      assert(!(await busy(r.id, ["video-batch"], db)), "整集任务正在执行");
      const details = await videoDetails(p, e, r, b);
      const active = (await listJobs(p.id, db, true)).some(
        (j) =>
          j.run_id === r.id &&
          j.kind === "video" &&
          j.segment_id === b.segment_id &&
          ["running", "queued"].includes(j.state),
      );
      assert(!active, "该片段正在生成");
      const j: Job = {
        id: uid(),
        project_id: p.id,
        episode_id: e.id,
        run_id: r.id,
        kind: "video",
        state: "queued",
        message: "等待生成",
        created: now(),
        ...details,
      };
      await saveJob(j, db);
      return { job_id: j.id };
    }
    if (action === "preview-video-batch" || action === "generate-all-videos") {
      assert(
        !(await busy(r.id, ["video", "video-batch"], db)),
        "已有视频任务执行中",
      );
      const preview = await previewBatch(p, e, r);
      if (action === "preview-video-batch") return preview;
      assert(
        b.preview_token === preview.token,
        "输入已变化，请重新查看生成数量",
      );
      const cfg = await config();
      return enqueue(
        p,
        e,
        r,
        "video-batch",
        {
          basis: batchBasis(p, r, cfg),
          baseline_selection: copy(r.media_selection),
          results: {},
          children: {},
          key_fingerprint: digest(
            r.model.startsWith("wan") ? cfg.wan_api_key : cfg.api_key,
          ),
          progress: { done: 0, total: segments(r).length },
          snapshot: { project: copy(p), episode: copy(e), run: copy(r) },
        },
        db,
      );
    }
    if (action === "adopt-video-batch") {
      const j = await loadJob(b.job_id, db);
      assert(
        j.kind === "video-batch" &&
          j.project_id === p.id &&
          j.run_id === r.id &&
          j.state === "done",
        "请选择本方案完成的整集任务",
      );
      assert(
        digest(j.basis) === digest(batchBasis(p, r, await config())) &&
          digest(j.baseline_selection) === digest(r.media_selection),
        "方案或采用结果已变化，请逐段审阅",
      );
      const temp = copy(r);
      Object.assign(temp.media_selection, j.results);
      assert(
        segments(temp).every(
          (s) =>
            fresh(temp, s) && chosen(temp, s.id)?.content.quality !== "draft",
        ),
        "整集结果不完整或已过期",
      );
      r.media_selection = temp.media_selection;
      return { ok: true };
    }
    if (action === "resume" || action === "resume-video-batch") {
      const j = await loadJob(b.job_id, db);
      assert(
        j.project_id === p.id && j.run_id === r.id && j.state === "failed",
        "只能继续当前方案失败任务",
      );
      assert(
        !(await busy(r.id, ["video", "video-batch"], db)),
        "已有视频任务执行中",
      );
      if (action === "resume-video-batch")
        assert(
          j.kind === "video-batch" &&
            digest(j.basis) === digest(batchBasis(p, r, await config())),
          "方案已变化，不能继续旧批次",
        );
      else
        assert(
          j.kind === "video" && j.remote_id,
          "缺少远端任务ID，请先核对控制台，勿重复提交",
        );
      j.state = "queued";
      j.message = "等待继续原任务";
      await saveJob(j, db);
      return { job_id: j.id };
    }
    if (action === "adopt-media") {
      const v = r.media[b.segment_id]?.find((v) => v.id === b.version_id);
      assert(v, "视频版本不存在");
      r.media_selection[b.segment_id] = v.id;
      return { ok: true };
    }
    if (action === "finish" || action === "assemble") {
      requireStep(p, r, "generation");
      const mode = b.caption_mode || "none",
        resolution = b.resolution || "720p";
      assert(
        ["none", "asr", "align"].includes(mode) &&
          ["720p", "1080p"].includes(resolution),
        "导出选项无效",
      );
      if (mode !== "none")
        assert((await config()).api_key, "自动字幕需要配置方舟 API Key");
      const requested =
        b.items ||
        segments(r).map((s) => ({
          segment_id: s.id,
          in: 0,
          out: chosen(r, s.id)!.content.duration,
        }));
      assert(
        Array.isArray(requested) && requested.length === segments(r).length,
        "需包含全部片段",
      );
      const seen = new Set<string>();
      const items = requested.map((i: Json) => {
        const v = chosen(r, i.segment_id);
        assert(
          segments(r).some((s) => s.id === i.segment_id) &&
            v &&
            !seen.has(i.segment_id),
          "片段重复或未采用视频",
        );
        assert(
          typeof i.in === "number" &&
            typeof i.out === "number" &&
            Number.isFinite(i.in) &&
            Number.isFinite(i.out) &&
            0 <= i.in &&
            i.in < i.out &&
            i.out <= v.content.duration,
          "裁切时间超出视频范围",
        );
        seen.add(i.segment_id);
        return {
          segment_id: i.segment_id,
          version_id: v.id,
          media: copy(v.content),
          start: i.in,
          end: i.out,
        };
      });
      if (mode === "align")
        assert(
          selected(r, "director")!.content.beats.some((b: Json) =>
            dialogueText(b),
          ),
          "方案没有台词，请使用语音识别",
        );
      return enqueue(
        p,
        e,
        r,
        "finish",
        {
          inputs: inputs(p, r, "finish"),
          snapshot: {
            items,
            ratio: p.production.ratio,
            resolution,
            caption_mode: mode,
            audio_model:
              process.env.ARK_AUDIO_MODEL || "doubao-seed-2-1-lite-260915",
            director: copy(selected(r, "director")!.content),
            segments: copy(segments(r)),
          },
        },
        db,
      );
    }
    throw new AppError("操作不存在", 404);
  });
}
