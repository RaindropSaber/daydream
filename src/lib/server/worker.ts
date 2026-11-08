import {
  runCreationAgent,
  skillInstructions,
  mentionInstructions,
} from "./creation-agent";
import { creationReadTools } from "./creation-context";
import { projectPrompt } from "../creative-spec";
import { randomUUID } from "node:crypto";
import { database, transaction } from "./db";
import {
  type Job,
  type Json,
  type Project,
  type Run,
  uid,
  now,
  copy,
  assert,
  AppError,
  digest,
  selected,
  segments,
  entries,
  inputs,
  addVersion,
  locate,
  mediaHash,
  requireStep,
  status,
} from "../domain";
import {
  jobFromRow,
  saveJob,
  loadJob,
  loadProject,
  editProject,
} from "./repository";
import { config, ARK } from "./settings";
import {
  textJSON,
  createVideo,
  queryVideo,
  downloadVideo,
  generateImage,
} from "./providers";
import { imageSource, mediaPath } from "./files";
import {
  normalizePlan,
  normalizeSettings,
  registerSettings,
  validate,
} from "./validation";
import { videoDetails, candidate } from "./studio";
import { renderFinish, probe } from "./render";
import { CREATIVE_SYSTEM, SETTINGS_SYSTEM } from "./prompts";
import { conversationTimeline } from "../conversation";
import { wanBase, imageProvider } from "../models";
import { imageRequest } from "./image-provider";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stopped = false;
function outputShape(step: string, r: Run) {
  return step === "story"
    ? { text: "完整故事正文" }
    : step === "director"
      ? {
          prompt: "统一导演意图",
          beats: [
            {
              id: "B1",
              start: 0,
              end: 10,
              description: "画面与动作",
              camera: "运镜",
              dialogue: "台词",
            },
          ],
          segments: [
            {
              id: "S1",
              title: "片段名称",
              start: 0,
              end: 10,
              prompt: "完整提示词",
              beat_ids: ["B1"],
              asset_ids: [],
              mode: "reference",
              depends_on: [],
            },
          ],
        }
      : {
          world: {
            premise: "",
            technology: "",
            visual_language: "",
            palette: "",
            materials: "",
            avoid: "",
          },
          characters: [
            {
              asset_id: "已有资源ID；新增留空",
              version: "已有资源版本ID；新增留空",
              kind: "character/scene/prop",
              name: "名称",
              description: "完整具体设定",
              reason: "收录依据",
              appearance_changed: true,
              new_state: false,
              state_name: "剧情状态名称（新增状态时填写）",
              tags: [],
              segment_ids: segments(r).map((s) => s.id),
            },
          ],
        };
}
async function textTask(j: Job) {
  const {
    project: p,
    episode: e,
    run: r,
  } = j.snapshot as { project: Project; episode: Json; run: Run };
  const step = j.step || "characters";
  const unified = j.kind === "conversation" && step === "assistant";
  const context = {
    stage: step,
    project: p.title,
    brief: p.brief,
    episode: e.title,
    episode_brief: e.brief,
    target_duration: e.target_duration ?? null,
    style: p.style,
    project_creative_spec: projectPrompt(p),
    ratio: p.ratio,
    assets: p.assets,
    approved_story:
      status(p, r, "story") === "approved"
        ? selected(r, "story")?.content
        : null,
    approved_plan:
      status(p, r, "director") === "approved"
        ? selected(r, "director")?.content
        : null,
    adopted_version: selected(r, step)?.content,
    latest_draft: r.steps[step]?.versions.at(-1)?.content,
    conversation: conversationTimeline(r),
    current_page: j.page_context,
    stages: Object.fromEntries(
      ["story", "director", "characters"].map((stage) => [
        stage,
        {
          status: status(p, r, stage),
          adopted_version: selected(r, stage)?.content,
          latest_draft: r.steps[stage]?.versions.at(-1)?.content,
        },
      ]),
    ),
    production: {
      media: r.media,
      media_selection: r.media_selection,
      exports: r.exports,
    },
    available_draft_targets: [
      "story",
      ...(status(p, r, "story") === "approved" ? ["director"] : []),
      ...(status(p, r, "director") === "approved" ? ["characters"] : []),
    ],
    video_model_capabilities: {
      ...(await import("../domain")).PROFILES[r.model],
      model: r.model,
    },
    output_shape: unified
      ? Object.fromEntries(
          ["story", "director", "characters"].map((stage) => [
            stage,
            outputShape(stage, r),
          ]),
        )
      : outputShape(step, r),
  };
  const conversation = j.kind === "conversation";
  const system =
    (step === "characters" ? SETTINGS_SYSTEM : CREATIVE_SYSTEM) +
    (conversation
      ? ""
      : " 现在直接整理完整内容，不提问；输出 reply 为简短说明，proposal 为完整草稿。") +
    " 输出格式为{reply:文字,proposal:完整内容或null}，proposal 的字段遵循 output_shape。不得编造图片URL或文件名。";
  let value: Json;
  if (unified) {
    let draft: Json | null = null;
    const mentions = await mentionInstructions(
      context.conversation.filter((m) => m.role === "user"),
    );
    const instructions = await Promise.all(
      ["story", "director", "settings"].map((skill) =>
        skillInstructions(skill as "story" | "director" | "settings"),
      ),
    );
    const response = await runCreationAgent({
      instructions:
        "这是贯穿各创作阶段的同一段对话。阅读 conversation 的完整历史以及 stages 的采用稿和最新草稿，current_page 只是参考。用户讨论时直接回答，明确要求生成或修改时选择 target_step 并调用 save_stage_draft 工具。只能处理 available_draft_targets 内的阶段，一次只保存一份待采用草稿。不得执行生图、视频生成或导出。\n" +
        instructions.join("\n") +
        "\n" +
        mentions.instructions,
      context,
      messages: [],
      tools: [
        {
          name: "save_stage_draft",
          description:
            "根据明确的创作要求，保存指定阶段的完整待采用草稿；不改变当前采用版本。",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              target_step: {
                type: "string",
                enum: context.available_draft_targets,
              },
              proposal: {
                type: "object",
                properties: {},
                additionalProperties: true,
              },
            },
            required: ["target_step", "proposal"],
          },
          execute(args) {
            assert(
              args.proposal &&
                context.available_draft_targets.includes(args.target_step),
              "草稿缺少有效的目标阶段或请先更新并确认前置内容",
            );
            draft = args;
          },
        },
        ...creationReadTools({
          load: async () => p,
          episodeId: e.id,
          runId: r.id,
          source: "job_snapshot",
        }),
      ],
    });
    value = {
      reply: response.reply,
      target_step: (draft as Json | null)?.target_step ?? null,
      proposal: (draft as Json | null)?.proposal ?? null,
    };
  } else {
    value = await textJSON(
      system,
      context,
      j.kind === "conversation" ? "agent" : "text",
    );
  }
  assert(
    typeof value.reply === "string" && value.reply.trim(),
    "模型回复缺少文字内容",
  );
  const target = unified ? value.target_step : step;
  if (value.proposal != null) {
    assert(
      ["story", "director", "characters"].includes(target),
      "草稿缺少有效的目标阶段",
    );
    if (target === "director") requireStep(p, r, "story");
    if (target === "characters") requireStep(p, r, "director");
    value.proposal =
      target === "characters"
        ? normalizeSettings(p, r, value.proposal)
        : target === "director"
          ? normalizePlan(p, r, value.proposal)
          : validate(r, "story", value.proposal);
  }
  if (!conversation) assert(value.proposal, "模型没有返回完整草稿");
  return value;
}
export async function videoTask(j: Job) {
  const cfg = await config();
  const key = j.provider === "wan" ? cfg.wan_api_key : cfg.api_key;
  assert(
    digest(key) === j.key_fingerprint,
    "API Key 已变更，请恢复提交时的密钥后继续",
  );
  assert(
    j.provider !== "wan" ||
      wanBase(cfg.wan_region, cfg.wan_workspace) === j.base_url,
    "万相地域已变更，请恢复原地域",
  );
  if (!j.remote_id) {
    assert(
      !j.submit_attempted,
      "上次提交结果不确定，请先在控制台核对；不自动重复计费请求",
    );
    j.submit_attempted = true;
    j.message = "正在提交视频生成";
    await saveJob(j);
    j.remote_id = await createVideo(
      j.provider,
      j.base_url || ARK,
      key,
      j.payload,
    );
    await saveJob(j);
  }
  const deadline = Date.now() + 1800000;
  while (Date.now() < deadline) {
    if (stopped) throw new AppError("服务已停止，可继续查询原任务");
    const result = await queryVideo(
      j.provider,
      j.base_url || ARK,
      key,
      j.remote_id,
    );
    j.message =
      result.status === "queued"
        ? "供应商排队中"
        : result.status === "running"
          ? "供应商生成中"
          : "正在获取结果";
    await saveJob(j);
    if (result.status === "succeeded") {
      const url = result.content?.video_url;
      assert(typeof url === "string", "供应商没有返回视频地址");
      const file = "studio-" + j.id + ".mp4";
      await downloadVideo(url, file);
      const info = await probe(await mediaPath(file));
      return {
        file,
        url: "/media/" + file,
        remote_url: url,
        remote_id: j.remote_id,
        provider: j.provider,
        model: j.payload.model,
        quality: j.quality,
        duration:
          info.duration ||
          result.duration ||
          j.payload.duration ||
          j.payload.parameters?.duration,
        usage: result.usage,
        created: now(),
      };
    }
    assert(
      ["queued", "running"].includes(result.status),
      "视频任务结束：" +
        String(result.error?.code || result.status)
          .replace(/[^a-zA-Z0-9_.-]/g, "")
          .slice(0, 100),
    );
    await sleep(j.provider === "wan" ? 15000 : 5000);
  }
  throw new AppError("等待超过30分钟，可继续查询原任务，无需重复提交");
}
async function imageTask(j: Job) {
  const cfg = await config();
  assert(
    digest(imageRequest(cfg, j.image_model, "").key) === j.key_fingerprint,
    "API Key 已变更，请恢复提交时密钥",
  );
  assert(
    !j.image_base || imageRequest(cfg, j.image_model, "").base === j.image_base,
    "生图服务地域或业务空间已变更，请恢复提交时配置",
  );
  const e = j.snapshot.entry;
  const poses: Record<string, string[][]> = {
    character: [
      ["portrait", "正面半身定妆，面部和发型清晰"],
      ["fullbody", "完整全身造型，与参考图同一人物、面容和服装结构"],
    ],
    scene: [
      ["establishing", "16:9场景空间全景，清晰布局和地标，无前景人物"],
      ["detail", "同一空间关键区域和材质细节，保持建筑、科技设施与光线一致"],
    ],
    prop: [
      [
        "object",
        "关键道具完整三分之四视角，呈现结构、比例、材质与符号，中性背景",
      ],
    ],
  };
  j.images ??= [];
  j.attempted_poses ??= [];
  for (const [pose, direction] of poses[e.kind || "character"]) {
    if (j.images.some((i: Json) => i.pose === pose)) continue;
    assert(
      !j.attempted_poses.includes(pose),
      "此图上次提交结果不确定，请先核对控制台，勿重复生成",
    );
    const refs = e.reference_images || e.images || [];
    const ref = j.images[0] || refs[0];
    const reference = ref ? await imageSource(ref) : e.url || undefined;
    j.message = `正在生成 ${e.name} · ${direction}`;
    j.attempted_poses.push(pose);
    await saveJob(j);
    const prompt = `${j.snapshot.project_prompt || ""}\n项目创作方向：${j.snapshot.project_brief}。渲染风格：${j.snapshot.style}。统一世界观与美术规范：${JSON.stringify(j.snapshot.world)}。导演视觉要求：${j.snapshot.direction}。设定：${e.name}，剧情状态：${e.state_name || "初始状态"}，${e.description}。${direction}。具体体现时代、科技结构、材质与工艺，保持身份和结构，不添加剧情、能力或武器。不要拼图或额外文字。`;
    const image = await generateImage(
      j.image_model,
      prompt,
      `character-${j.id}-${pose}.jpg`,
      reference,
    );
    j.images.push({ ...image, pose });
    await saveJob(j);
  }
  return { images: j.images };
}
async function applyImage(
  p: Project,
  r: Run | undefined,
  j: Job,
  result: Json,
) {
  const entry = j.snapshot.entry;
  const asset = p.assets.find((a) => a.id === entry.asset_id);
  assert(asset, "资源已不存在");
  const original = asset.versions.find((v) => v.id === entry.version);
  assert(original, "原始设定版本不存在");
  const av = {
    ...copy(original),
    id: uid(),
    number: asset.versions.length + 1,
    images: result.images,
    url: "",
    created: now(),
    source: imageProvider(j.image_model) === "wan" ? "qwen-image" : "seedream",
  };
  asset.versions.push(av);
  if (asset.selected === original.id) asset.selected = av.id;
  const current = r ? selected(r, "characters") : undefined;
  if (
    r &&
    current &&
    !current.approved &&
    digest(current.inputs) === digest(j.inputs)
  ) {
    const content = copy(current.content);
    const target = content.characters.find(
      (c: Json) => digest(c) === j.entry_hash,
    );
    if (target) {
      target.version = av.id;
      target.images = result.images;
      target.url = "";
      j.result_version = addVersion(
        r,
        "characters",
        content,
        p,
        imageProvider(j.image_model) === "wan" ? "qwen-image" : "seedream",
        true,
        false,
        current.inputs,
      ).id;
    }
  }
  j.result_url = result.images[0].url;
}
async function saveVideoResult(j: Job, result: Json) {
  let candidateResult: Json = {};
  await editProject(j.project_id, async (p, db) => {
    const { e, r } = locate(p, j.episode_id, j.run_id);
    assert(!e.locked_at, "本集已永久锁定");
    assert(!r.finished_at, "此方案已结束，不能写入视频结果");
    const vs = (r.media[j.segment_id] ??= []);
    candidateResult = {
      id: uid(),
      number: vs.length + 1,
      content: result,
      input_hash: j.input_hash,
      inputs: {},
      created: now(),
      source: j.provider,
      ...(j.batch_id ? { batch_id: j.batch_id } : {}),
    };
    vs.push(candidateResult as any);
    j.result_version = candidateResult.id;
    j.result_url = result.url;
    j.state = "done";
    j.message = "视频候选已保存";
    await saveJob(j, db);
  });
  return candidateResult;
}
async function batchTask(j: Job) {
  const p = j.snapshot.project as Project,
    e = j.snapshot.episode,
    r = j.snapshot.run as Run;
  for (const [index, s] of segments(r).entries()) {
    const cfg = await config();
    assert(
      digest(r.model.startsWith("wan") ? cfg.wan_api_key : cfg.api_key) ===
        j.key_fingerprint,
      "API Key 已变更",
    );
    if (j.results[s.id]) continue;
    let v = candidate(r, s);
    if (!v) {
      let child: Job;
      if (j.children[s.id]) {
        child = await loadJob(j.children[s.id]);
        if (child.state === "done") {
          const live = await (
            await import("./repository")
          ).loadProject(j.project_id);
          const liveRun = locate(live, j.episode_id, j.run_id).r;
          v = liveRun.media[s.id]?.find((v) => v.id === child.result_version);
          assert(v, "子任务结果不存在");
        } else
          assert(
            child.remote_id || !child.submit_attempted,
            "子任务上次提交结果不确定，请先核对控制台",
          );
      } else {
        const details = await videoDetails(p, e, r, { segment_id: s.id });
        child = {
          id: uid(),
          project_id: j.project_id,
          episode_id: j.episode_id,
          run_id: j.run_id,
          kind: "video",
          batch_id: j.id,
          state: "queued",
          message: "等待执行",
          created: now(),
          ...details,
        };
        j.children[s.id] = child.id;
        await saveJob(child);
        await saveJob(j);
      }
      if (!v) {
        child = await loadJob(j.children[s.id]);
        child.state = "running";
        await saveJob(child);
        j.message = `整集生成 ${index + 1}/${segments(r).length}：${s.title}`;
        await saveJob(j);
        try {
          v = (await saveVideoResult(child, await videoTask(child))) as any;
        } catch (error) {
          child.state = "failed";
          child.message =
            error instanceof AppError ? error.message : "视频子任务失败";
          await saveJob(child);
          throw error;
        }
      }
    }
    assert(v, "片段结果缺失");
    if (!(r.media[s.id] || []).some((x) => x.id === v!.id))
      (r.media[s.id] ??= []).push(copy(v));
    r.media_selection[s.id] = v.id;
    j.results[s.id] = v.id;
    j.progress = {
      done: Object.keys(j.results).length,
      total: segments(r).length,
    };
    await saveJob(j);
  }
  return { results: j.results };
}
export async function executeJob(j: Job) {
  const project = await loadProject(j.project_id);
  assert(
    j.kind === "asset-image" ||
      (!locate(project, j.episode_id, j.run_id).e.locked_at &&
        !locate(project, j.episode_id, j.run_id).r.finished_at),
    "此方案已结束，不能执行生成任务",
  );
  let result: Json;
  switch (j.kind) {
    case "video":
      result = await videoTask(j);
      await saveVideoResult(j, result);
      return;
    case "video-batch":
      result = await batchTask(j);
      break;
    case "asset-image":
    case "character-image":
      result = await imageTask(j);
      break;
    case "conversation":
    case "text":
    case "characters":
      result = await textTask(j);
      break;
    case "finish":
    case "assembly":
      result = await renderFinish(j, async (message) => {
        j.message = message;
        await saveJob(j);
      });
      break;
    default:
      throw new AppError("不支持的历史任务类型，请从当前流程重新操作");
  }
  await editProject(j.project_id, async (p, db) => {
    if (j.kind === "asset-image") {
      await applyImage(p, undefined, j, result);
      j.state = "done";
      j.message = "资源图已完成";
      await saveJob(j, db);
      return;
    }
    const { e, r } = locate(p, j.episode_id, j.run_id);
    assert(!e.locked_at, "本集已永久锁定");
    assert(!r.finished_at, "此方案已结束，不能写入任务结果");
    if (["conversation", "text", "characters"].includes(j.kind)) {
      const unified = j.step === "assistant";
      const step = unified ? result.target_step : j.step || "characters";
      const draftInputs =
        unified && result.proposal
          ? inputs(j.snapshot.project, j.snapshot.run, step)
          : j.inputs;
      let v;
      if (result.proposal) {
        if (step === "characters") registerSettings(p, e.id, result.proposal);
        const adopt =
          (j.kind === "characters" &&
            r.steps.characters.selected === j.baseline &&
            digest(inputs(p, r, "characters")) === digest(j.inputs)) ||
          (j.kind === "text" && !selected(r, step));
        v = addVersion(
          r,
          step,
          result.proposal,
          p,
          j.kind === "conversation" ? "conversation" : "llm",
          adopt,
          false,
          draftInputs,
        );
        j.result_step = step;
        j.result_version = v.id;
      }
      (r.conversations[unified ? "assistant" : step] ??= []).push({
        id: uid(),
        role: "assistant",
        text: result.reply,
        version_id: v?.id || null,
        target_step: v ? step : null,
        created: now(),
        job_id: j.id,
      });
      j.raw_output = result;
    } else if (j.kind === "character-image") await applyImage(p, r, j, result);
    else if (j.kind === "finish" || j.kind === "assembly") {
      const out = {
        id: uid(),
        kind: "finish",
        content: result,
        inputs: j.inputs,
        captions: null,
        created: now(),
      };
      r.exports.push(out);
      j.result_version = out.id;
      j.result_url = result.url;
    }
    j.state = "done";
    j.message =
      j.kind === "video-batch"
        ? "整集片段已完成，等待采用"
        : j.kind === "finish"
          ? "成片已导出"
          : j.kind === "character-image"
            ? "设定图已完成"
            : j.kind === "conversation" && !j.result_version
              ? "回复已完成"
              : "草稿已保存";
    await saveJob(j, db);
  });
}
export async function startWorker() {
  stopped = false;
  const owner = randomUUID();
  const locked = await transaction(async (db) => {
    const existing = (
      await db.query("SELECT pid FROM runtime_locks WHERE name='worker'")
    ).rows[0];
    if (existing) {
      try {
        process.kill(existing.pid, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    await db.query(
      "INSERT INTO runtime_locks(name,pid,token) VALUES('worker',$1,$2) ON CONFLICT(name) DO UPDATE SET pid=$1,token=$2",
      [process.pid, owner],
    );
    await db.query(
      "UPDATE jobs SET state='failed',message='服务已重启；有远端ID可继续查询，提交不确定时请先核对控制台',updated_at=$1 WHERE state='running'",
      [now()],
    );
    return true;
  });
  if (!locked) return async () => {};
  let running: Promise<void> | null = null;
  async function tick() {
    if (stopped || running) return;
    running = (async () => {
      const row = (
        await database().query(
          `UPDATE jobs SET state='running',owner=$1,heartbeat_at=CURRENT_TIMESTAMP,attempt=attempt+1 WHERE id=(SELECT id FROM jobs WHERE state='queued' AND json_extract(data,'$.batch_id') IS NULL ORDER BY created_at LIMIT 1) RETURNING *`,
          [owner],
        )
      ).rows[0];
      if (!row) return;
      const j = jobFromRow(row);
      const heartbeat = setInterval(() => {
        database()
          .query(
            "UPDATE jobs SET heartbeat_at=CURRENT_TIMESTAMP WHERE id=$1 AND owner=$2",
            [j.id, owner],
          )
          .catch(() => {});
      }, 10000);
      heartbeat.unref();
      try {
        await executeJob(j);
      } catch (error) {
        j.state = "failed";
        j.message =
          error instanceof AppError
            ? error.message
            : "任务失败，请检查模型配置或素材；已有结果保留";
        await saveJob(j);
      } finally {
        clearInterval(heartbeat);
      }
    })().finally(() => {
      running = null;
    });
    await running;
  }
  const timer = setInterval(
    () =>
      void tick().catch((e) =>
        console.error(
          "Task worker error:",
          e instanceof Error ? e.message : "unknown",
        ),
      ),
    500,
  );
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    // Retain ownership until in-flight work has settled, even during shutdown.
    if (running) await running;
    await database().query(
      "DELETE FROM runtime_locks WHERE name='worker' AND token=$1",
      [owner],
    );
  };
}
