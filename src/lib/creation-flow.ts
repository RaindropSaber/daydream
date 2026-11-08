export const CREATION_SKILLS = {
  project: {
    title: "项目构思",
    module: "项目基础信息、创作方向、视觉风格与统一创作规范",
    tool: "update_project_form",
  },
  episode: {
    title: "分集大纲",
    module: "集名与本集剧情",
    tool: "update_episode_form",
  },
  run: { title: "制作方案命名", module: "方案名称", tool: "update_run_form" },
  story: { title: "故事创作", module: "故事正文", tool: "update_story_form" },
  director: {
    title: "分镜编排",
    module: "导演意图、时间节拍与生成片段",
    tool: "update_director_form",
  },
  beat: {
    title: "镜头节拍完善",
    module: "当前节拍画面、运镜与对白",
    tool: "update_beat_form",
  },
  segment: {
    title: "视频提示词完善",
    module: "当前片段提示词",
    tool: "update_segment_form",
  },
  settings: {
    title: "设定集整理",
    module: "世界观与全部重要设定",
    tool: "update_settings_form",
  },
  world: {
    title: "世界观与美术",
    module: "统一世界观与美术规范",
    tool: "update_world_form",
  },
  entry: {
    title: "设定描述完善",
    module: "当前人物、场景或道具描述",
    tool: "update_entry_form",
  },
  asset: {
    title: "共享资源设定",
    module: "资源名称与描述",
    tool: "update_asset_form",
  },
  finish: {
    title: "剪辑建议",
    module: "已有视频的顺序与裁切",
    tool: "update_finish_form",
  },
} as const;
export type CreationSkill = keyof typeof CREATION_SKILLS;
export const isRunEditingSkill = (skill: CreationSkill) =>
  !(["project", "episode", "run", "asset"] as CreationSkill[]).includes(skill);
export const CREATION_FLOW = [
  { title: "项目构思", input: "一句创意、风格与画幅", skills: ["project"] },
  { title: "分集大纲", input: "本集要讲什么", skills: ["episode", "run"] },
  { title: "故事", input: "正文与修改意见", skills: ["story"] },
  {
    title: "分镜与片段",
    input: "导演意图、画面动作、运镜、台词与片段提示词",
    skills: ["director", "beat", "segment"],
  },
  {
    title: "设定集",
    input: "世界观与人物、场景、道具描述",
    skills: ["settings", "world", "entry", "asset"],
  },
  { title: "生成与审阅", input: "参考素材、生成参数与结果选择", skills: [] },
  {
    title: "合成导出",
    input: "片段顺序、裁切、字幕与输出规格",
    skills: ["finish"],
  },
] as const;
export const skillPrompt = (skill: CreationSkill) =>
  `使用 @skill:${skill}，帮我完善${CREATION_SKILLS[skill].module}，生成可供预览和应用的结果卡片。`;
