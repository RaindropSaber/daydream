import {
  assert,
  type Json,
  locate,
  selected,
  PROFILES,
  requireStep,
  fresh,
  segments,
  status,
} from "../domain";
import {
  CREATION_SKILLS,
  isRunEditingSkill,
  type CreationSkill,
} from "../creation-flow";
import { projectPrompt } from "../creative-spec";
import { loadProject } from "./repository";
import {
  FORM_SCHEMAS,
  runCreationAgent,
  skillInstructions,
  mentionInstructions,
} from "./creation-agent";
import { normalizePlan, normalizeSettings } from "./validation";
import { creationReadTools, workflowSummary } from "./creation-context";
import { assistPrompt } from "./prompt-assistant";

export async function assistForm(body: Json) {
  assert(
    Array.isArray(body.messages) &&
      body.messages.length >= 1 &&
      body.messages.length <= 40 &&
      body.messages.every(
        (m: Json) =>
          m &&
          ["user", "assistant"].includes(m.role) &&
          typeof m.text === "string" &&
          m.text.length <= 20000,
      ),
    "创作对话格式不正确",
  );
  assert(
    body.messages.at(-1).role === "user" && body.messages.at(-1).text.trim(),
    "请填写创作要求",
  );
  if (body.mode === "prompt" || body.mode === "chat") return assistPrompt(body);
  assert(
    typeof body.skill === "string" &&
      Object.hasOwn(CREATION_SKILLS, body.skill),
    "未知创作模块",
  );
  const skill = body.skill as CreationSkill;
  const mentions = await mentionInstructions(body.messages, skill);
  assert(
    body.form &&
      typeof body.form === "object" &&
      !Array.isArray(body.form) &&
      JSON.stringify(body.form).length <= 500000,
    "当前表单无效或过大",
  );
  const p = body.project_id ? await loadProject(body.project_id) : null;
  const r =
    p && body.episode_id && body.run_id
      ? locate(p, body.episode_id, body.run_id).r
      : null;
  // A selected run can be read-only context for creating a new scheme.
  // Only tools editing that run are subject to its completion lock.
  if (isRunEditingSkill(skill)) {
    assert(r, "请先选择分集与制作方案");
    assert(!r.finished_at, "此方案已结束，请新建方案后编辑");
  }
  if (r && p && ["director", "beat", "segment"].includes(skill))
    requireStep(p, r, "story");
  if (r && p && ["world", "settings", "entry"].includes(skill))
    requireStep(p, r, "director");
  // Only actual usable clips can be returned by the editing tool.
  const availableClips = r
    ? Object.entries(r.media_selection).flatMap(([id, selectedId]) => {
        const clip = r.media[id]?.find((v) => v.id === selectedId);
        const segment = segments(r).find((s) => s.id === id);
        return clip && segment && fresh(r, segment)
          ? [{ segment_id: id, duration: clip.content.duration }]
          : [];
      })
    : [];
  const tool = CREATION_SKILLS[skill].tool;
  let patch: Json | null = null;
  const result = await runCreationAgent({
    instructions:
      `已加载 skill：${skill}\n来源：skills/creation/${skill}/SKILL.md\n` +
      (await skillInstructions(skill)) +
      "\n" +
      mentions.instructions +
      "\n本次工具调用仅生成待应用的结果卡片，不会直接修改表单。请说明结果已整理为卡片，用户点击应用后才会填入模块，不要宣称已回填。",
    context: {
      skill,
      current_form: body.form,
      local_context: body.local_context || {},
      project: p ? { title: p.title, creative_prompt: projectPrompt(p) } : null,
      episode: p?.episodes.find((e) => e.id === body.episode_id)?.brief,
      target_duration:
        p?.episodes.find((e) => e.id === body.episode_id)?.target_duration ??
        null,
      existing_episodes:
        skill === "episode"
          ? p?.episodes.map((e) => ({
              title: e.title,
              brief: e.brief,
              target_duration: e.target_duration ?? null,
              number: e.number,
            }))
          : undefined,
      existing_runs:
        skill === "run"
          ? p?.episodes
              .find((e) => e.id === body.episode_id)
              ?.runs.map((run) => ({ name: run.name }))
          : undefined,
      workflow: p && r ? workflowSummary(p, r) : null,
      approved_story:
        p && r && status(p, r, "story") === "approved"
          ? selected(r, "story")?.content
          : null,
      approved_plan:
        p && r && status(p, r, "director") === "approved"
          ? selected(r, "director")?.content
          : null,
      approved_settings:
        p && r && status(p, r, "characters") === "approved"
          ? selected(r, "characters")?.content
          : null,
      assets: p?.assets,
      video_model_capabilities: r && PROFILES[r.model],
      available_clips: availableClips,
    },
    messages: body.messages,
    tools: [
      {
        name: tool,
        description: `为当前${CREATION_SKILLS[skill].module}生成结果卡片，等待用户点击应用后回填，不保存、不采用。参数仅包含需要修改的字段。`,
        parameters: FORM_SCHEMAS[skill],
        execute(value) {
          if (skill === "director")
            value = normalizePlan(p!, r!, { ...body.form, ...value });
          if (skill === "settings")
            value = normalizeSettings(p!, r!, { ...body.form, ...value });
          if (skill === "finish") {
            assert(
              Array.isArray(value.items) && value.items.length > 0,
              "请至少保留一个视频片段",
            );
            const seen = new Set();
            for (const item of value.items) {
              const clip = availableClips.find(
                (c) => c.segment_id === item.segment_id,
              );
              assert(
                clip &&
                  !seen.has(item.segment_id) &&
                  item.in >= 0 &&
                  item.out > item.in &&
                  item.out <= clip.duration,
                "剪辑建议包含无效片段或裁切范围",
              );
              seen.add(item.segment_id);
            }
          }
          patch = value;
        },
      },
      ...creationReadTools({
        load: () =>
          body.project_id
            ? loadProject(body.project_id)
            : Promise.resolve(null),
        episodeId: body.episode_id,
        runId: body.run_id,
      }),
    ],
  });
  return {
    reply: result.reply,
    patch: patch as Json | null,
    skill,
    tool: patch ? tool : null,
    prompt_trace: {
      skill,
      skill_file: `skills/creation/${skill}/SKILL.md`,
      loaded_skills: mentions.skills,
      available_tool: tool,
      ...result.prompt_trace,
    },
  };
}
