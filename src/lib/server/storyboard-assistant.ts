import fs from "node:fs/promises";
import path from "node:path";
import {
  assert,
  copy,
  uid,
  locate,
  requireStep,
  selected,
  type Json,
} from "../domain";
import { projectPrompt } from "../creative-spec";
import { loadProject } from "./repository";
import { FORM_SCHEMAS, runCreationAgent } from "./creation-agent";
import {
  validate,
  validateWorld,
  normalizeSettings,
  registerSettings,
} from "./validation";
import { resourceKey } from "./segment-planner";
import { resourceTokens } from "../storyboard";

export async function storyboardAssistant(pid: string, body: Json) {
  if (body.messages)
    assert(
      Array.isArray(body.messages) &&
        body.messages.length > 0 &&
        body.messages.length <= 30 &&
        body.messages.every(
          (m: Json) =>
            ["user", "assistant"].includes(m?.role) &&
            typeof m.text === "string" &&
            m.text.length <= 20000,
        ) &&
        body.messages.at(-1).role === "user",
      "创作对话格式不正确",
    );
  const p = await loadProject(pid);
  const { e, r } = locate(p, body.episode_id, body.run_id);
  assert(!e.locked_at && !r.finished_at, "此方案只读，请新建方案后编辑");
  requireStep(p, r, "story");
  assert(["storyboard", "resource"].includes(body.role), "创作模型角色不正确");
  assert(
    body.content && JSON.stringify(body.content).length <= 500000,
    "分镜内容过大或无效",
  );
  if (body.operation === "optimize") {
    assert(body.role === "storyboard", "分镜优化需使用分镜模型");
    const form = validate(r, "director", {
      ...copy(body.content),
      planning_mode: "storyboard",
      segments: [],
    });
    const shot = form.beats.find((beat: Json) => beat.id === body.beat_id);
    assert(shot, "请选择有效分镜");
    const tokens = resourceTokens(shot.description).sort();
    const descriptionLimit = Math.max(160, shot.description.length);
    let patch: Json | null = null;
    const result = await runCreationAgent({
      role: "text",
      requireResult: true,
      instructions: `${await fs.readFile(path.resolve("skills/creation/storyboard/SKILL.md"), "utf8")}\n本次只优化 current_shot 的完整描述。保持原故事意图、事件和时长，结合前后镜头改善画面、动作、运镜、台词与声音的清晰度和连续性，不增加剧情或改变其他镜头。严格原样保留当前镜头全部 @resource: 标签，不新增、不删除、不替换资源标签。优化优先删繁就简，不是扩写；不新增动作、发光部件、光源或固定外观。必要信息已完整时，优化后的描述应更短、更明确。不要重新加入前镜已完成的观察或预备动作。只调用 optimize_shot 返回 description，不返回时间、ID或其他字段。`,
      context: {
        project: {
          title: p.title,
          production: p.production,
          production_prompt: projectPrompt(p),
        },
        episode: {
          title: e.title,
          brief: e.brief,
          target_duration: e.target_duration,
        },
        approved_story: selected(r, "story")?.content,
        current_storyboard: form,
        current_shot: shot,
        current_shot_duration: Number((shot.end - shot.start).toFixed(3)),
        previous_shot: form.beats[form.beats.indexOf(shot) - 1] || null,
        next_shot: form.beats[form.beats.indexOf(shot) + 1] || null,
        current_resources: body.resources || null,
      },
      messages: body.messages || [
        {
          role: "user",
          text: "优化选中镜头的完整拍摄描述，直接返回可替换的描述。",
        },
      ],
      tools: [
        {
          name: "optimize_shot",
          description:
            "只替换选中镜头的描述，保留时间、资源和其他镜头。不保存，不生成媒体。",
          parameters: {
            type: "object",
            properties: {
              description: { type: "string", maxLength: descriptionLimit },
            },
            required: ["description"],
            additionalProperties: false,
          },
          execute(value) {
            assert(value.description.trim(), "请填写完整分镜描述");
            assert(
              JSON.stringify(resourceTokens(value.description).sort()) ===
                JSON.stringify(tokens),
              "优化必须原样保留当前镜头的全部资源标签",
            );
            patch = { description: value.description };
          },
        },
      ],
    });
    return {
      patch: patch as Json | null,
      role: "shot",
      beat_id: shot.id,
      reply: result.reply,
      prompt_trace: result.prompt_trace,
    };
  }
  const storyboard = body.role === "storyboard";
  let patch: Json | null = null;
  let form = body.content;
  if (!storyboard) {
    form = validate(r, "director", {
      ...copy(form),
      planning_mode: "storyboard",
      segments: [],
    });
    // An isolated copy supplies unsaved source identities; no database writes.
    r.storyboard_mode = true;
    r.steps.director = {
      selected: "form",
      versions: [
        { id: "form", number: 0, content: form, inputs: {}, created: 0 },
      ],
    };
    if (body.resources) {
      const resources = validate(r, "characters", copy(body.resources));
      registerSettings(p, e.id, resources);
      r.steps.characters = {
        selected: "form-resources",
        versions: [
          {
            id: "form-resources",
            number: 0,
            content: resources,
            inputs: {},
            created: 0,
          },
        ],
      };
    }
  }
  const schema = storyboard
    ? {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "可选的整集补充拍摄要求。没有则为空字符串；不重复项目风格、剧情或分镜内容。",
          },
          beats: {
            type: "array",
            maxItems: 200,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", maxLength: 100 },
                start: { type: "number", minimum: 0 },
                end: { type: "number", minimum: 0 },
                description: {
                  type: "string",
                  maxLength: 12000,
                  description:
                    "一次连续拍摄的完整描述：起始构图与主体位置、符合时长的关键动作、必要的景别机位运镜、台词声音及承接下镜的结束状态。一个叙事重点，不堆砌固定外观，不拆成额外字段。",
                },
              },
              required: ["id", "start", "end", "description"],
            },
          },
        },
        required: ["prompt", "beats"],
        additionalProperties: false,
      }
    : FORM_SCHEMAS.settings;
  const result = await runCreationAgent({
    role: storyboard ? "text" : "agent",
    requireResult: true,
    instructions:
      (await fs.readFile(
        path.resolve(
          "skills/creation",
          storyboard ? "storyboard" : "resource-matching",
          "SKILL.md",
        ),
        "utf8",
      )) +
      (storyboard
        ? "\n本次只创作分镜。每个beat必须是一次连续拍摄的镜头，切换视角或叙事重点时另起一镜，输出前检查动作和台词能否在时长内完成、相邻镜头状态是否衔接。只输出prompt和beats，不生成视频片段、素材标识或资源绑定。每镜从0连续排列，镜头可短于视频模型最短时长，分镜不是视频请求。以目标时长为准；不得为满足单次生成限制拆分或扩写故事。"
        : "\n本次只分析素材，不改写分镜。characters中segment_ids填写使用它的分镜beat id，不是视频片段id。先核对给出的真实素材库及版本，适用则绑定真实asset_id/version并保留原描述与图片；缺少时asset_id和version留空，给出可用于出图的自身外观描述。每项应有人物/场景/道具类型和明确名称。manual=true的绑定由用户锁定，不替换。world只整理美术约定，不修改故事或分镜。"),
    context: {
      project: {
        title: p.title,
        production: p.production,
        production_prompt: projectPrompt(p),
      },
      episode: {
        title: e.title,
        brief: e.brief,
        target_duration: e.target_duration,
      },
      approved_story: selected(r, "story")?.content,
      current_storyboard: form,
      current_resources: body.resources || null,
      asset_library: storyboard ? undefined : p.assets,
    },
    messages: body.messages || [
      {
        role: "user",
        text: storyboard
          ? "根据本集故事编排镜头，检查动作时长与前后连续性后返回完整分镜草稿。"
          : "分析每镜需要的素材并检索素材库，返回待应用的绑定与新建素材建议。",
      },
    ],
    tools: [
      {
        name: storyboard ? "propose_storyboard" : "propose_resource_bindings",
        description: "生成待应用结果卡片，不保存、不采用、不生成媒体。",
        parameters: schema,
        execute(value) {
          if (storyboard)
            patch = validate(r, "director", {
              ...value,
              planning_mode: "storyboard",
              segments: [],
            });
          else {
            const world = validateWorld(
              value.world || body.resources?.world || {},
            );
            // Matching an existing asset chooses its immutable version; it does
            // not revise its appearance or discard images due to world wording.
            const characters = (value.characters || []).map((entry: Json) => {
              if (!entry.asset_id) return entry;
              const asset = p.assets.find((a) => a.id === entry.asset_id);
              const version = asset?.versions.find(
                (v) => v.id === (entry.version || asset.selected),
              );
              assert(
                asset && version && (!entry.kind || asset.kind === entry.kind),
                "素材引用不存在的资源版本",
              );
              return {
                ...entry,
                kind: asset.kind,
                name: asset.name,
                description: version.description,
                version: version.id,
                appearance_changed: false,
                new_state: false,
              };
            });
            const source = selected(r, "characters");
            if (source) source.content.world = world;
            const normalized = normalizeSettings(p, r, {
              ...body.resources,
              ...value,
              world,
              characters,
            });
            const locked = (body.resources?.characters || []).filter(
              (entry: Json) => entry.manual,
            );
            normalized.characters = [
              ...locked,
              ...normalized.characters
                .map((entry: Json) => ({
                  ...entry,
                  binding_id: locked.some(
                    (old: Json) => resourceKey(old) === resourceKey(entry),
                  )
                    ? uid()
                    : entry.binding_id,
                  manual: false,
                  segment_ids: entry.segment_ids.filter(
                    (bid: string) =>
                      !locked.some(
                        (old: Json) =>
                          old.asset_id === entry.asset_id &&
                          old.segment_ids.includes(bid),
                      ),
                  ),
                }))
                .filter((entry: Json) => entry.segment_ids.length),
            ];
            patch = validate(r, "characters", normalized);
          }
        },
      },
    ],
  });
  return {
    patch: patch as Json | null,
    role: body.role,
    reply: result.reply,
    prompt_trace: result.prompt_trace,
  };
}
