"use client";
import { toast } from "sonner";
import type { Json } from "@/lib/types";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, useAction, useStudio, useUnsaved } from "./context";
import { StageToolbar } from "./stage-toolbar";
import type { Story, StoryChapter } from "@/lib/stories";
export { NovelWorkspace as StoryWorkspace } from "./novel-workspace";

export function StorySelection() {
  const { run, project, episode, mutate, navigate } = useStudio();
  const sourceVersion = run?.steps.story.versions.find(
    (v) => v.id === run.steps.story.selected,
  );
  const source = sourceVersion?.content.source;
  const [story, setStory] = useState<Story | null>(null);
  const [touched, setTouched] = useState(false);
  const [chapters, setChapters] = useState<string[]>(source?.chapter_ids || []);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { busy, action } = useAction();
  useEffect(() => {
    let active = true;
    void api(`/api/studio/projects/${project!.id}/story`)
      .then((data) => {
        if (active) {
          setStory(data.story);
          setChapters((ids) =>
            ids.filter((id) =>
              data.story?.chapters.some(
                (c: StoryChapter) => c.id === id && c.status === "ready",
              ),
            ),
          );
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project!.id]);
  const locked = !!episode?.locked_at || !!run?.finished_at;
  const changed =
    story?.id !== source?.story_id ||
    !story ||
    source?.revision !== story.revision ||
    JSON.stringify(chapters) !== JSON.stringify(source?.chapter_ids);
  useUnsaved(!locked && touched && changed);
  const valid =
    story &&
    chapters.length > 0 &&
    chapters.every((id) =>
      story.chapters.some((c) => c.id === id && c.status === "ready"),
    );
  const next = () =>
    navigate(
      "episode",
      {
        project: project!.id,
        episode: episode!.id,
        run: run!.id,
        step: "director",
      },
      { saved: true },
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <StageToolbar
        meta={
          <Badge variant="secondary">
            {source ? `已选 ${source.chapter_ids.length} 章` : "尚未选择章节"}
          </Badge>
        }
      >
        <Button
          size="sm"
          disabled={locked || busy || !valid || loading}
          onClick={() =>
            void action(async () => {
              await mutate("select-story", {
                story_id: story!.id,
                story_revision: story!.revision,
                chapter_ids: chapters,
                expected_selected: run!.steps.story.selected,
              });
              toast.success("故事章节已选定");
              next();
            })
          }
        >
          {busy ? "保存中…" : "选定章节并继续"}
        </Button>
      </StageToolbar>
      <p className="text-sm text-muted-foreground">
        从本项目的故事选择已定稿章节，作为本次视频的改编来源。章节按原文顺序组合，视频分集无需对应单一章节。
      </p>
      {source && (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p className="font-medium">
            当前来源：{source.story_title} · 第 {source.revision} 版
          </p>
          <p className="mt-2 text-muted-foreground">
            {sourceVersion!.content.chapters
              ?.map((c: Json) => c.title)
              .join("、")}
          </p>
          {sourceVersion?.approved && (
            <Button size="sm" variant="outline" className="mt-3" onClick={next}>
              使用当前已选内容继续
            </Button>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer">查看已选原文快照</summary>
            <p className="mt-3 whitespace-pre-wrap leading-8">
              {sourceVersion!.content.text}
            </p>
          </details>
        </div>
      )}
      {!locked && (
        <>
          <div>
            <Button
              variant="outline"
              onClick={() =>
                navigate("story-workspace", { project: project!.id })
              }
            >
              前往本项目的故事创作
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {loading && <p className="text-sm">正在读取故事…</p>}
          {story && (
            <>
              {source?.story_id === story.id &&
                source.revision !== story.revision && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    原故事已更新至第 {story.revision} 版。当前视频仍使用第{" "}
                    {source.revision} 版快照；重新选定才会更新制作依据。
                  </p>
                )}
              <p className="text-xs text-muted-foreground">
                {story.title} · 第 {story.revision} 版 · 勾选一章或多章
              </p>
              {story.chapters.map((c, i) => (
                <label
                  key={c.id}
                  className="flex items-start gap-3 rounded-lg border p-4"
                >
                  <input
                    className="mt-1"
                    type="checkbox"
                    disabled={busy || c.status !== "ready"}
                    checked={chapters.includes(c.id)}
                    onChange={(event) => {
                      setTouched(true);
                      setChapters((previous) =>
                        story.chapters
                          .filter((item) =>
                            item.id === c.id
                              ? event.target.checked
                              : previous.includes(item.id),
                          )
                          .map((item) => item.id),
                      );
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {i + 1}. {c.title}{" "}
                      <span className="text-xs text-muted-foreground">
                        {c.status === "ready" ? "已定稿" : "草稿，暂不可选"}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {c.summary}
                    </p>
                    <details
                      className="mt-2 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <summary className="cursor-pointer text-muted-foreground">
                        预览正文
                      </summary>
                      <p className="mt-3 whitespace-pre-wrap leading-8">
                        {c.text || "暂无正文"}
                      </p>
                    </details>
                  </div>
                </label>
              ))}
              {!story.chapters.length && (
                <p className="text-sm text-muted-foreground">
                  这部故事还没有章节，请先去故事创作中写作并定稿。
                </p>
              )}
            </>
          )}
          {!loading && !story && (
            <p className="text-sm text-muted-foreground">
              本项目还没有故事，请先进入故事创作并定稿章节。
            </p>
          )}
        </>
      )}
    </div>
  );
}
