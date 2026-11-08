export const CREATION_SKILLS = {
  project: {
    title: "项目简介",
    module: "项目名称与简介",
    tool: "update_project_form",
  },
  production: {
    title: "制作设置",
    module: "视频视觉风格、画幅、美术规范与改编要求",
    tool: "update_production_form",
  },
  episode: {
    title: "分集大纲",
    module: "集名与本集剧情",
    tool: "update_episode_form",
  },
  run: { title: "制作方案命名", module: "方案名称", tool: "update_run_form" },
  director: {
    title: "分镜编排",
    module: "导演意图与按时间排列的分镜",
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
    title: "素材设定",
    module: "素材名称与描述",
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
  !(
    ["project", "production", "episode", "run", "asset"] as CreationSkill[]
  ).includes(skill);
export const CREATION_FLOW = [
  { title: "项目", input: "名称与简介", skills: ["project"] },
  {
    title: "制作设置",
    input: "视觉风格、画幅、美术规范与改编要求",
    skills: ["production"],
  },
  { title: "分集大纲", input: "本集要讲什么", skills: ["episode", "run"] },
  {
    title: "故事选章",
    input: "从独立故事选择已定稿章节，保留原文快照",
    skills: [],
  },
  {
    title: "分镜与资源",
    input: "连续时间分镜、画面动作、运镜、台词与内嵌素材引用",
    skills: ["director", "beat", "settings", "world", "entry", "asset"],
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
