import type { NovelPlan, NovelMemory } from "./novel";
export interface StoryChapter {
  id: string;
  title: string;
  summary: string;
  text: string;
  status: "draft" | "ready";
  memory?: NovelMemory | null;
  review?: string;
  issues?: string[];
  needs_review?: boolean;
}
export interface Story {
  project_id: string;
  id: string;
  title: string;
  premise: string;
  genre: string;
  theme: string;
  world: string;
  characters: string;
  outline: string;
  chapters: StoryChapter[];
  novel: NovelPlan;
  revision: number;
  created: number;
  updated: number;
}
export const STORY_STAGES = {
  concept: {
    title: "故事构思",
    hint: "先找到想讲的事：主角想要什么、遇到什么阻碍、最终发生什么变化。",
    fields: ["title", "premise", "genre", "theme"],
  },
  settings: {
    title: "世界与人物",
    hint: "明确世界的规则、人物的欲望与关系，让冲突有根可循。",
    fields: ["world", "characters"],
  },
  outline: {
    title: "全书大纲",
    hint: "梳理主线的起承转合、关键转折与结局，再拆成章节。",
    fields: ["outline"],
  },
  chapters: {
    title: "章节写作",
    hint: "先写本章提要，再展开正文；可结合前文续写、改写与检查一致性。",
    fields: ["title", "summary", "text"],
  },
} as const;
export type StoryStage = keyof typeof STORY_STAGES;
export const STORY_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  premise: "故事构思",
  genre: "题材与叙事风格",
  theme: "主题与核心冲突",
  world: "世界与规则",
  characters: "人物与关系",
  outline: "全书大纲",
  summary: "本章提要",
  text: "章节正文",
};
