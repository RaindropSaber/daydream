import type { Project } from "./types";

export const PROJECT_CREATION_RULES =
  "项目名称和简介用于组织作品，不是故事或视频的创作指令。故事的主题、世界观与人物由项目内的故事创作管理。视频创作遵循制作设置中的视觉风格、画幅、美术规范与改编要求，并以已选故事章节快照为剧情依据。项目简介修改不使制作方案失效。用户明确要求修改项目名称与简介时，只生成项目卡片；要求修改制作设置时，只生成制作设置卡片，不混写故事或项目资料。当前表单的未保存编辑优先保留。";

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
export function projectPrompt(p: Pick<Project, "production">) {
  const { style, ratio, prompt, adaptation } = p.production;
  return [
    `视觉风格：${style}`,
    `画幅：${ratio}`,
    ...(prompt ? [`美术规范：${prompt}`] : []),
    ...(adaptation ? [`改编要求：${adaptation}`] : []),
  ].join("\n");
}
