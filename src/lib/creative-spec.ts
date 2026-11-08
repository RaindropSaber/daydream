import type { Project } from "./types";

export const PROJECT_CREATION_RULES =
  "项目基础信息是所有创作的共同依据。每次创作都应读取并遵循项目创作方向、视觉风格、画幅和统一创作规范，将这些约定落实到故事、镜头、人物、场景、道具和提示词。局部内容与项目规范冲突时说明冲突，不擅自覆盖全局约定；用户明确要求修改基础信息时可生成待应用的修改卡片。编辑基础信息以 current_form 的未保存内容为准，新项目依据当前想法构思，不沿用其他项目。";

export const CREATIVE_FIELDS = {
  visual_style: "视觉风格",
  world: "题材与世界观",
  art: "人物、场景与材质",
  palette: "配色与光线",
  direction: "镜头与叙事",
  avoid: "避免元素",
} as const;
export type CreativeSpec = Partial<
  Record<keyof typeof CREATIVE_FIELDS, string>
>;
export const STYLE_PRESETS = [
  "电影写实",
  "日系动画",
  "国风水墨",
  "3D 动画",
  "国风三维动画",
  "美式漫画",
  "二维手绘",
  "水彩插画",
  "黏土定格",
  "剪纸动画",
  "像素艺术",
  "复古胶片",
];
export function projectPrompt(
  p: Pick<
    Project,
    "brief" | "style" | "ratio" | "creative_spec" | "creative_prompt"
  >,
) {
  return [
    `项目创作方向：${p.brief || "未指定"}`,
    `视觉风格：${p.style}`,
    `画幅：${p.ratio}`,
    ...(p.creative_prompt ? [`统一创作规范：${p.creative_prompt}`] : []),
    ...Object.entries(CREATIVE_FIELDS).flatMap(([key, label]) => {
      const value = p.creative_spec?.[key as keyof CreativeSpec];
      return value ? [`${label}：${value}`] : [];
    }),
  ].join("\n");
}

export function projectCreativeText(
  p: Pick<Project, "creative_prompt" | "creative_spec">,
) {
  return [
    p.creative_prompt || "",
    ...Object.entries(CREATIVE_FIELDS).flatMap(([key, label]) => {
      const value = p.creative_spec?.[key as keyof CreativeSpec];
      return value ? [`${label}：${value}`] : [];
    }),
  ]
    .filter(Boolean)
    .join("\n");
}
