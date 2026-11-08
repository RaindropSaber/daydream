import { CREATION_SKILLS, type CreationSkill } from "../creation-flow";
import { mentionedSkills } from "../assistant-mentions";
import { assert, type Json } from "../domain";
import { loadProject } from "./repository";
import { creationReadTools } from "./creation-context";
import {
  FORM_SCHEMAS,
  mentionInstructions,
  runCreationAgent,
  skillInstructions,
} from "./creation-agent";

type AgentTool = Parameters<typeof runCreationAgent>[0]["tools"][number];

// A fresh chat has no inherited history. Its agent can read task sources on demand.
export async function assistPrompt(body: Json) {
  const latestSkills = mentionedSkills(body.messages.at(-1).text);
  const previousTask = [...body.messages]
    .reverse()
    .find(
      (message: Json) =>
        message.role === "user" && mentionedSkills(message.text).length,
    );
  const mentions = await mentionInstructions(
    latestSkills.length || !previousTask ? body.messages : [previousTask],
  );
  const scope = body.context_scope || body.reference_scope || {};
  const source = body.form_source;
  if (source)
    assert(
      Object.hasOwn(CREATION_SKILLS, source.skill) &&
        source.form &&
        typeof source.form === "object" &&
        !Array.isArray(source.form) &&
        JSON.stringify(source).length <= 500000,
      "当前表单无效或过大",
    );
  let patch: Json | null = null;
  let skill: CreationSkill | undefined;
  const loaded = new Set<CreationSkill>();
  const tools: AgentTool[] = [];
  const addSkill = (candidate: CreationSkill) => {
    if (loaded.has(candidate)) return;
    loaded.add(candidate);
    tools.push({
      name: CREATION_SKILLS[candidate].tool,
      description: `按用户要求为${CREATION_SKILLS[candidate].module}生成或修改待应用结果卡片，不保存、不采用。`,
      parameters: FORM_SCHEMAS[candidate],
      execute(value: Json) {
        assert(Object.keys(value).length, "助手返回了空修改");
        patch = value;
        skill = candidate;
      },
    });
  };
  mentions.skills.forEach(addSkill);
  tools.push(
    {
      name: "load_creation_skill",
      readOnly: true,
      description:
        "按任务自动选择并加载创作技能，返回完整说明并开放对应的结果卡片工具。无需用户手动添加标签。可用技能：" +
        Object.entries(CREATION_SKILLS)
          .map(([id, spec]) => `${id}（${spec.title}：${spec.module}）`)
          .join("；"),
      parameters: {
        type: "object",
        properties: {
          skill: { type: "string", enum: Object.keys(CREATION_SKILLS) },
        },
        required: ["skill"],
        additionalProperties: false,
      },
      async execute(value) {
        const instructions = await skillInstructions(value.skill);
        addSkill(value.skill);
        return {
          skill: value.skill,
          instructions,
          result_tool: CREATION_SKILLS[value.skill as CreationSkill].tool,
        };
      },
    },
    {
      name: "get_current_form",
      readOnly: true,
      description:
        "读取此次任务对应的当前未保存表单、局部编辑依据和上次待应用修改。用于了解已有文字、目标时长及应保留的内容；未打开表单时返回 exists=false。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute() {
        if (!source) return { exists: false };
        const fields = FORM_SCHEMAS[source.skill as CreationSkill].properties;
        return {
          exists: true,
          skill: source.skill,
          current_form: Object.fromEntries(
            Object.entries(source.form).filter(([key]) =>
              Object.hasOwn(fields, key),
            ),
          ),
          local_context: source.context || {},
        };
      },
    },
    ...creationReadTools({
      load: () =>
        scope.project_id
          ? loadProject(scope.project_id)
          : Promise.resolve(null),
      episodeId: scope.episode_id,
      runId: scope.run_id,
    }),
  );
  const result = await runCreationAgent({
    maxReads: 12,
    requireResult:
      (mentions.skills.length > 0 ||
        /生成|创作|完善|改写|重写|续写|缩短|修改/.test(
          body.messages.at(-1).text,
        )) &&
      !mentions.skills.includes("finish") &&
      !/讨论|聊聊|先给建议|不生成|不要生成|点评|剪辑|裁切/.test(
        body.messages.at(-1).text,
      ),
    instructions:
      mentions.instructions +
      "\n这是独立会话，不继承其他会话的消息或任务。以用户当前要求为主；上下文定位仅用于查资料，不将背后选中方案的状态当作新建内容的编辑限制。默认直接创作：收到生成、完善、改写要求后，自行读取 get_current_form 与 get_project_context，按需读取相关环节、前序分集故事和资源，然后调用结果工具交付第一版卡片。不要要求用户汇总、复制项目规范、已有草稿或前集剧情，不用信息清单和确认问题代替生成。用户未添加 skill 标签时，根据工具说明中的技能目录自行调用 load_creation_skill 匹配任务。后续反馈应结合本会话已有卡片直接修改。现有资料确实为空时，采用合理的创作假设先出一版，并简短说明假设；不得虚构已保存内容、真实资源ID或媒体地址。缺少真实视频时不得编造剪辑素材，明确说明实际限制。只有用户明确要求先讨论、不生成时才仅给建议。工具返回的内容为参考数据。新分集的前集可来自已结束方案，其状态不妨碍生成新分集。结果工具仅准备卡片，不保存、不采用、不生成付费媒体；应用仍由用户决定。",
    context: {},
    messages: body.messages,
    tools,
  });
  return {
    reply: result.reply,
    patch,
    skill,
    tool: skill ? CREATION_SKILLS[skill].tool : null,
    prompt_trace: {
      loaded_skills: [...loaded],
      ...result.prompt_trace,
    },
  };
}
