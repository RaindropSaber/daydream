/** Long-form writing data shared by the editor and the durable task runner. */
export interface NovelMemory {
  recap: string;
  characters: string;
  threads: string;
  timeline: string;
}
export interface NovelVolume {
  title: string;
  start: number;
  end: number;
  goal: string;
  climax: string;
  resolution: string;
}
export interface NovelPlan {
  idea: string;
  target_words: number;
  chapter_words: number;
  ending: string;
  volumes: NovelVolume[];
  audit: { report: string; issues: string[]; revision: number } | null;
  completed: boolean;
}
export interface NovelTask {
  id: string;
  project_id: string;
  kind: "plan" | "write" | "review";
  state: "queued" | "running" | "paused" | "failed" | "done";
  token: string;
  remaining: number;
  written: number;
  revision: number;
  message: string;
  error: string;
  updated: number;
  reviews?: { volume: number; report: string; issues: string[] }[];
}
export const defaultNovel = (): NovelPlan => ({
  idea: "",
  target_words: 300000,
  chapter_words: 3000,
  ending: "",
  volumes: [],
  audit: null,
  completed: false,
});
export const wordCount = (value: string) =>
  Array.from(value.replace(/\s/g, "")).length;
export const chapterCount = (plan: NovelPlan) =>
  Math.ceil(plan.target_words / plan.chapter_words);
export const activeNovelTask = (task?: NovelTask | null) =>
  !!task && ["queued", "running"].includes(task.state);
export function manuscriptText(story: {
  title: string;
  chapters: { title: string; text: string }[];
}) {
  return [
    story.title,
    ...story.chapters
      .filter((c) => c.text.trim())
      .map((c, i) => `第${i + 1}章 ${c.title}\n\n${c.text}`),
  ].join("\n\n");
}
