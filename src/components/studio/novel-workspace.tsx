"use client";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Sparkles,
  Play,
  Pause,
  Save,
  Download,
  Check,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, useAction, useUnsaved } from "./context";
import { Field } from "./forms";
import { NovelTaskActivity } from "./novel-task-activity";
import { useAssistantTarget } from "./form-assistant";
import { StoryWritingAssistant } from "./story-writing-assistant";
import {
  STORY_STAGES,
  STORY_FIELD_LABELS,
  type Story,
  type StoryChapter,
  type StoryStage,
} from "@/lib/stories";
import {
  defaultNovel,
  wordCount,
  chapterCount,
  activeNovelTask,
  manuscriptText,
  type NovelTask,
} from "@/lib/novel";
import type { Json } from "@/lib/types";

const seeds = [
  "失去记忆的邮差，发现每封信都来自未来的自己",
  "小镇修表师卷入一场横跨三代人的失踪案",
  "一个无法修炼的普通人，试图改变以天赋决定命运的世界",
];
export function NovelWorkspace({
  projectId,
  initialIdea,
}: {
  projectId: string;
  initialIdea: string;
}) {
  const [story, setStory] = useState<Story | null>(null);
  const [saved, setSaved] = useState("");
  const [task, setTask] = useState<NovelTask | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [idea, setIdea] = useState(initialIdea);
  const [target, setTarget] = useState(300000);
  const [perChapter, setPerChapter] = useState(3000);
  const [tab, setTab] = useState<"plan" | "read" | "memory">("plan");
  const [chapterId, setChapterId] = useState("");
  const [editing, setEditing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [stage, setStage] = useState<StoryStage>("concept");
  const [batch, setBatch] = useState("1");
  const { busy, action } = useAction();
  const dirty = !!story && JSON.stringify(story) !== saved;
  const live = useRef({ dirty, story });
  live.current = { dirty, story };
  useUnsaved(dirty);
  function accept(s: Story | null) {
    setStory(s);
    setSaved(JSON.stringify(s));
    setChapterId((id) =>
      s?.chapters.some((c) => c.id === id)
        ? id
        : s?.chapters.find((c) => c.text.trim())?.id ||
          s?.chapters[0]?.id ||
          "",
    );
    live.current = { dirty: false, story: s };
  }
  useEffect(() => {
    let alive = true;
    let fetching = false;
    let timer: ReturnType<typeof setTimeout>;
    setLoaded(false);
    setStory(null);
    setSaved("");
    live.current = { dirty: false, story: null };
    setTask(null);
    setError("");
    async function poll() {
      if (fetching) return;
      fetching = true;
      try {
        const revision = live.current.story?.revision;
        const result = await api(
          `/api/studio/projects/${projectId}/story${revision ? `?revision=${revision}` : ""}`,
        );
        if (!alive) return;
        setTask(result.task);
        if (!live.current.story && result.story?.novel) {
          setIdea(result.story.novel.idea);
          setTarget(result.story.novel.target_words);
          setPerChapter(result.story.novel.chapter_words);
        }
        if (
          !result.unchanged &&
          !live.current.dirty &&
          (!live.current.story ||
            !result.story ||
            result.story.revision >= live.current.story.revision)
        )
          accept(result.story);
        setLoaded(true);
        setError("");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "读取失败");
      } finally {
        fetching = false;
        if (alive) timer = setTimeout(poll, 3000);
      }
    }
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId]);
  const n = story?.novel || defaultNovel();
  const chapter = story?.chapters.find((c) => c.id === chapterId);
  const active = activeNovelTask(task);
  const planned = n.volumes.length > 0;
  const written = story?.chapters.filter((c) => c.text.trim()).length || 0;
  const words =
    story?.chapters.reduce((sum, c) => sum + wordCount(c.text), 0) || 0;
  const total = chapterCount(n);
  const allWritten =
    !!story &&
    story.chapters.length === total &&
    story.chapters.every(
      (c) => c.text.trim() && c.memory && !c.needs_review && !c.issues?.length,
    ) &&
    words >= n.target_words * 0.85;
  const change = (patch: Json) => setStory((s) => (s ? { ...s, ...patch } : s));
  const changeChapter = (patch: Json) =>
    change({
      chapters: story!.chapters.map((c) =>
        c.id === chapterId ? { ...c, ...patch, status: "draft" } : c,
      ),
    });
  async function persist(confirmChapter = false) {
    if (!story) throw new Error("请先创建作品");
    if (!dirty && !confirmChapter) return story;
    const result = await api(`/api/studio/projects/${projectId}/story`, {
      content: story,
      expected_revision: story.revision,
      ...(confirmChapter ? { confirm_chapter_id: chapterId } : {}),
    });
    accept(result.story);
    return result.story as Story;
  }
  async function executeCommand(op: string, extra: Json = {}) {
    const current = op === "pause" ? story! : await persist();
    const result = await api(`/api/studio/projects/${projectId}/story/novel`, {
      action: op,
      expected_revision: current.revision,
      ...extra,
    });
    accept(result.story);
    setTask(result.task);
    if (op === "write") {
      setTab("read");
      setEditing(false);
    }
  }
  const taskIntent = useRef<Json>({ action: "write", count: 1 });
  const launchTask = useAssistantTarget(`novel-task:${projectId}`, {
    title: "长篇写作任务",
    skill: "story",
    scope: { project_id: projectId },
    snapshot: () => ({
      form: { ...taskIntent.current },
      context: { revision: story?.revision },
      disabled: !story || busy || active,
    }),
    request: (snapshot, messages) =>
      api(`/api/studio/projects/${projectId}/story/task-assist`, {
        form: snapshot.form,
        messages: messages
          .slice(-29)
          .map((m) => ({
            role: m.role,
            text: (m.patch
              ? `${m.text}\n操作卡片：${JSON.stringify(m.patch)}`
              : m.text
            ).slice(0, 20000),
          })),
      }),
    apply: async ({ action: op, ...extra }) => {
      await executeCommand(op, extra);
    },
    appliedMessage: "任务已开始，进度会显示在创作浮窗中",
    activity: <NovelTaskActivity projectId={projectId} />,
  });
  function command(op: string, extra: Json = {}) {
    if (["pause", "complete"].includes(op)) {
      void action(() => executeCommand(op, extra));
      return;
    }
    taskIntent.current = { action: op, ...extra };
    launchTask(
      op === "review"
        ? "帮我检查全书的因果、人物、伏笔与结局收束，准备检查任务。"
        : op === "resume"
          ? "帮我从已保存进度恢复上次写作任务。"
          : `根据已保存的全书方案，${extra.count === "all" ? "一直写到全书结局" : `继续写 ${extra.count} 章`}，准备写作任务。`,
    );
  }
  const launch = useAssistantTarget(`novel-plan:${projectId}`, {
    title: "全书方案",
    skill: "story",
    scope: { project_id: projectId },
    prompt:
      "根据当前想法和篇幅，帮我生成完整的全书方案，包含人物、世界、主线、分卷和结局，先提供候选稿供我审阅。",
    snapshot: () => ({
      form: { idea, target_words: target, chapter_words: perChapter },
      context: { revision: story?.revision ?? null },
      disabled:
        !loaded ||
        busy ||
        active ||
        !!story?.chapters.some((c) => c.text.trim()),
    }),
    request: (snapshot, messages) =>
      api(`/api/studio/projects/${projectId}/story/plan-assist`, {
        form: snapshot.form,
        messages: messages.slice(-29).map((m) => ({
          role: m.role,
          text: (m.patch
            ? `${m.text}\n\n候选稿：\n${JSON.stringify(m.patch)}`
            : m.text
          ).slice(0, 20000),
        })),
      }),
    apply: async (patch) => {
      const result = await api(
        `/api/studio/projects/${projectId}/story`,
        story
          ? {
              content: { ...story, ...patch },
              expected_revision: story.revision,
            }
          : { action: "create", ...patch },
      );
      accept(result.story);
      setTab("plan");
    },
    appliedMessage: "全书方案已应用并保存，可以审阅后开始写作",
  });
  if (!loaded)
    return (
      <p className="py-10 text-sm" role={error ? "alert" : undefined}>
        {error || "正在打开小说工作台…"}
      </p>
    );
  return (
    <div className="space-y-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs tracking-widest text-muted-foreground">
            故事创作 / 长篇小说
          </p>
          <h1 className="text-2xl font-semibold">
            {planned ? story!.title : "把一个想法，写成一部长篇"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {planned
              ? `${Math.round(n.target_words / 10000)} 万字计划 · 约 ${total} 章 · ${n.volumes.length} 卷`
              : "不需要会写大纲。给一个想法，系统帮你搭建全书，再一章一章写到结局。"}
          </p>
        </div>
        {story && (
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant="secondary">
              {dirty ? "未保存" : n.completed ? "已完结" : "进度已保存"}
            </Badge>
            <Button
              variant="outline"
              disabled={busy || active || !dirty}
              onClick={() =>
                void action(async () => {
                  await persist();
                  toast.success("小说已保存");
                })
              }
            >
              <Save />
              保存
            </Button>
            {written > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  const blob = new Blob([manuscriptText(story)], {
                    type: "text/plain;charset=utf-8",
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${story.title}.txt`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download />
                导出正文
              </Button>
            )}
          </div>
        )}
      </header>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {task && (
        <div
          className="rounded-xl border bg-muted/30 p-4 flex flex-wrap items-center gap-3"
          role="status"
          aria-live="polite"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {active
                ? "创作进行中"
                : task.state === "failed"
                  ? "写作暂时中断"
                  : task.state === "paused"
                    ? "已暂停"
                    : "本次任务完成"}{" "}
              · {task.message}
            </p>
            {task.error && (
              <p className="mt-2 text-sm text-destructive">{task.error}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              本次已写 {task.written}{" "}
              章。每个步骤自动保存，关闭页面不影响后台任务。
            </p>
          </div>
          {active ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => command("pause")}
            >
              <Pause />
              暂停
            </Button>
          ) : (
            ["paused", "failed"].includes(task.state) && (
              <Button
                disabled={busy || dirty}
                onClick={() => command("resume")}
              >
                <Play />
                从保存处继续
              </Button>
            )
          )}
        </div>
      )}
      {!planned ? (
        <Card>
          <CardContent className="space-y-6 pt-6 max-w-3xl">
            <Field label="你想写一个什么故事？">
              <Textarea
                aria-label="小说想法"
                className="min-h-32"
                placeholder="例如：一个无法修炼的普通人，发现整个修仙世界的灵气正在消失……也可以留空，让系统替你构思。"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                disabled={active || busy}
                maxLength={10000}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              {seeds.map((seed) => (
                <Button
                  key={seed}
                  size="sm"
                  variant="outline"
                  className="h-auto whitespace-normal text-left py-2"
                  disabled={active || busy}
                  onClick={() => setIdea(seed)}
                >
                  {seed}
                </Button>
              ))}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="整部小说的目标篇幅">
                <select
                  aria-label="目标篇幅"
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  disabled={active || busy}
                  value={target}
                  onChange={(e) => setTarget(Number(e.target.value))}
                >
                  {[100000, 200000, 300000, 500000, 1000000, 2000000].map(
                    (x) => (
                      <option key={x} value={x}>
                        {x / 10000} 万字
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="每章大致篇幅">
                <select
                  aria-label="每章篇幅"
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  disabled={active || busy}
                  value={perChapter}
                  onChange={(e) => setPerChapter(Number(e.target.value))}
                >
                  {[1500, 2000, 3000, 4000, 5000].map((x) => (
                    <option key={x} value={x}>
                      {x} 字
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="text-sm leading-7 text-muted-foreground">
              预计 {Math.ceil(target / perChapter)}{" "}
              章。先生成主角、世界、主线、分卷和结局方案；你看过方案后再开始写正文。连续写作会调用已配置的文字模型。
            </p>
            <Button
              size="lg"
              disabled={
                busy || active || !!story?.chapters.some((c) => c.text.trim())
              }
              onClick={() => launch()}
            >
              <Sparkles />
              {active ? "正在构建全书…" : "帮我生成全书方案"}
            </Button>
            {story?.chapters.some((c) => c.text.trim()) && (
              <p className="text-sm">
                当前已有正文，请打开下方手动编辑，补充全书方案与分卷后继续，已有正文会保留。
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-[1fr_2fr]">
            <Card>
              <CardContent className="pt-6 space-y-3">
                <p className="text-sm text-muted-foreground">整部作品的进度</p>
                <p className="text-3xl font-semibold">
                  {words.toLocaleString()}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    / {n.target_words.toLocaleString()} 字
                  </span>
                </p>
                <progress
                  className="h-2 w-full accent-primary"
                  value={Math.min(words, n.target_words)}
                  max={n.target_words}
                  aria-label="全书字数进度"
                />
                <p className="text-xs text-muted-foreground">
                  已写 {written} / {total} 章 · 已定稿{" "}
                  {story!.chapters.filter((c) => c.status === "ready").length}{" "}
                  章
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6 space-y-3">
                <h2 className="font-medium">
                  {n.completed
                    ? "这部小说已经完结"
                    : allWritten
                      ? "下一步：检查全书，再确认完结"
                      : written
                        ? `下一步：继续推进故事`
                        : "下一步：先读第一章，看看是不是你想要的故事"}
                </h2>
                <p className="text-sm leading-6 text-muted-foreground">
                  {allWritten
                    ? "检查人物成长、主副线与伏笔的收束情况；报告基于章节摘要和剧情记忆，仍需你审阅正文。"
                    : "系统会先细化近期章节，再展开正文、更新剧情记忆并自动保存。已有正文需要修改时，可以随时暂停后编辑。"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {!n.completed && (
                    <>
                      <select
                        aria-label="连续写作范围"
                        className="rounded-md border bg-background p-2 text-sm"
                        disabled={busy || active}
                        value={batch}
                        onChange={(e) => setBatch(e.target.value)}
                      >
                        <option value="1">写下一章</option>
                        <option value="5">连续写 5 章</option>
                        <option value="all">一直写到全书结局</option>
                      </select>
                      <Button
                        disabled={busy || active || allWritten}
                        onClick={() =>
                          command("write", {
                            count:
                              batch === "all"
                                ? "all"
                                : Math.min(Number(batch), total),
                          })
                        }
                      >
                        <Play />
                        {written ? "继续写作" : "试写第一章"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || active || !allWritten}
                        onClick={() => command("review")}
                      >
                        检查全书
                      </Button>
                      {n.audit && !n.audit.issues.length && (
                        <Button
                          disabled={busy || active || dirty}
                          onClick={() => command("complete")}
                        >
                          <Check />
                          确认完结
                        </Button>
                      )}
                    </>
                  )}
                </div>
                {dirty && (
                  <p className="text-xs text-muted-foreground">
                    开始新任务时会先保存当前修改。
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
          <nav className="flex gap-2 border-b pb-3" aria-label="小说工作区">
            {(
              [
                ["plan", "全书方案"],
                ["read", "阅读与修改"],
                ["memory", "剧情记忆"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                variant={tab === id ? "secondary" : "ghost"}
                onClick={() => setTab(id)}
              >
                {id === "read" && <BookOpen />}
                {label}
              </Button>
            ))}
          </nav>
          {tab === "plan" && (
            <div className="space-y-5">
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <h2 className="font-medium">这是一部怎样的小说</h2>
                  <p className="whitespace-pre-wrap text-sm leading-8">
                    {story!.premise}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {story!.genre}
                  </p>
                </CardContent>
              </Card>
              <div className="grid gap-4 md:grid-cols-2">
                {n.volumes.map((v, i) => (
                  <Card key={i}>
                    <CardContent className="pt-6 space-y-3">
                      <p className="text-xs text-muted-foreground">
                        第 {i + 1} 卷 · 第 {v.start}—{v.end} 章
                      </p>
                      <h3 className="font-medium">{v.title}</h3>
                      <p className="whitespace-pre-wrap text-sm leading-7">
                        {v.goal}
                      </p>
                      <details className="text-sm">
                        <summary className="cursor-pointer text-muted-foreground">
                          查看高潮与阶段结局
                        </summary>
                        <p className="mt-3 whitespace-pre-wrap leading-7">
                          {`${v.climax}\n\n${v.resolution}`}
                        </p>
                      </details>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <details className="rounded-xl border p-5">
                <summary className="cursor-pointer text-sm font-medium">
                  查看全书结局（含剧透）
                </summary>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-8">
                  {n.ending}
                </p>
              </details>
            </div>
          )}
          {tab === "read" && (
            <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
              <aside className="max-h-[70vh] overflow-y-auto rounded-xl border p-3 space-y-1">
                <h2 className="mb-3 px-2 text-sm font-medium">章节目录</h2>
                {story!.chapters.map((c, i) => (
                  <button
                    key={c.id}
                    className={`w-full rounded-lg p-3 text-left text-sm ${c.id === chapterId ? "bg-secondary" : "hover:bg-muted"}`}
                    onClick={() => setChapterId(c.id)}
                  >
                    <span className="block">
                      {i + 1}. {c.title}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {c.text.trim()
                        ? `${wordCount(c.text)} 字 · ${c.status === "ready" ? "已定稿" : "初稿"}`
                        : "已规划，待写作"}
                      {c.needs_review && " · 需复核"}
                    </span>
                  </button>
                ))}
                {!story!.chapters.length && (
                  <p className="p-2 text-sm text-muted-foreground">
                    开始写作后，章节会出现在这里。
                  </p>
                )}
              </aside>
              <Card className="min-w-0">
                <CardContent className="pt-6 space-y-5">
                  {chapter ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="mr-auto text-lg font-semibold">
                          {chapter.title}
                        </h2>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={active || busy}
                          onClick={() => setEditing(!editing)}
                        >
                          {editing ? "返回阅读" : "修改本章"}
                        </Button>
                        <Button
                          size="sm"
                          disabled={active || busy || !chapter.text.trim()}
                          onClick={() =>
                            void action(async () => {
                              await persist(true);
                              toast.success("本章已定稿，可用于视频");
                            })
                          }
                        >
                          <Check />
                          定稿本章
                        </Button>
                      </div>
                      {!!chapter.issues?.length && (
                        <ul className="list-disc rounded-lg border border-amber-500 p-5 text-sm">
                          {chapter.issues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      )}
                      {chapter.needs_review && (
                        <p className="rounded-lg bg-muted p-3 text-sm">
                          前文或设定发生变化，本章需要复核。继续写作会先更新剧情记忆；请审阅是否需要修改正文。
                        </p>
                      )}
                      {editing ? (
                        <fieldset
                          disabled={active || busy}
                          className="space-y-4"
                        >
                          <Field label="章节标题">
                            <Input
                              value={chapter.title}
                              maxLength={100}
                              onChange={(e) =>
                                changeChapter({ title: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="本章提要">
                            <Textarea
                              value={chapter.summary}
                              onChange={(e) =>
                                changeChapter({ summary: e.target.value })
                              }
                            />
                          </Field>
                          <Field label="章节正文">
                            <Textarea
                              className="min-h-[60vh] leading-8"
                              value={chapter.text}
                              onChange={(e) =>
                                changeChapter({ text: e.target.value })
                              }
                            />
                          </Field>
                          <Button
                            onClick={() =>
                              void action(async () => {
                                await persist();
                                toast.success(
                                  "修改已保存，相关剧情记忆将在继续写作时更新",
                                );
                              })
                            }
                          >
                            保存本章修改
                          </Button>
                          <StoryWritingAssistant
                            key={chapter.id}
                            story={story!}
                            stage="chapters"
                            chapter={chapter}
                            disabled={busy || active}
                            onApply={changeChapter}
                          />
                        </fieldset>
                      ) : (
                        <article className="mx-auto max-w-3xl whitespace-pre-wrap text-base leading-9">
                          {chapter.text || `本章计划：\n\n${chapter.summary}`}
                        </article>
                      )}
                      {chapter.review && (
                        <details className="border-t pt-4 text-sm">
                          <summary className="cursor-pointer text-muted-foreground">
                            本章 AI 自检记录
                          </summary>
                          <p className="mt-3 whitespace-pre-wrap leading-7">
                            {chapter.review}
                          </p>
                        </details>
                      )}
                    </>
                  ) : (
                    <p className="py-16 text-center text-sm text-muted-foreground">
                      点击“试写第一章”，正文会逐章保存到这里。
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          {tab === "memory" && (
            <Card>
              <CardContent className="pt-6 space-y-5">
                <h2 className="font-medium">截至最近有效章节的剧情记忆</h2>
                <p className="text-sm text-muted-foreground">
                  只记录正文中已发生的事实。改动前文后，受影响的记忆会重新建立。
                </p>
                {(() => {
                  const valid = story!.chapters.filter(
                    (c) =>
                      c.text.trim() &&
                      c.memory &&
                      !c.needs_review &&
                      !c.issues?.length,
                  );
                  const memory = valid.at(-1)?.memory;
                  return memory ? (
                    Object.entries(memory).map(([key, value]) => (
                      <section key={key}>
                        <h3 className="mb-2 text-sm font-medium">
                          {
                            {
                              recap: "已发生的剧情",
                              characters: "人物状态与知识边界",
                              threads: "伏笔、承诺与待解决冲突",
                              timeline: "时间线与位置",
                            }[key]
                          }
                        </h3>
                        <p className="whitespace-pre-wrap text-sm leading-8">
                          {value}
                        </p>
                      </section>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      写完第一章后，系统会自动建立剧情记忆。
                    </p>
                  );
                })()}
              </CardContent>
            </Card>
          )}
          {n.audit && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <h2 className="font-medium">全书检查报告</h2>
                <p className="whitespace-pre-wrap text-sm leading-8">
                  {n.audit.report}
                </p>
                {n.audit.issues.length ? (
                  <ul className="list-disc pl-5 space-y-2 text-sm">
                    {n.audit.issues.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm">
                    未发现待处理的结构与收束问题。审阅正文后可确认完结。
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
      {story && (
        <section className="border-t pt-5 space-y-5">
          <Button variant="ghost" onClick={() => setAdvanced(!advanced)}>
            <ChevronRight className={advanced ? "rotate-90" : ""} />
            手动编辑设定与全书方案
          </Button>
          {advanced && (
            <fieldset disabled={active || busy} className="space-y-5">
              <p className="text-sm text-muted-foreground">
                修改设定会使后续剧情记忆待更新。自动写作期间请先暂停。
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(STORY_STAGES)
                  .filter(([id]) => id !== "chapters")
                  .map(([id, spec]) => (
                    <Button
                      key={id}
                      variant={stage === id ? "secondary" : "outline"}
                      onClick={() => setStage(id as StoryStage)}
                    >
                      {spec.title}
                    </Button>
                  ))}
              </div>
              <div className="space-y-5">
                <div className="space-y-5">
                  {STORY_STAGES[stage].fields.map((field) => (
                    <Field key={field} label={STORY_FIELD_LABELS[field]}>
                      <Textarea
                        aria-label={STORY_FIELD_LABELS[field]}
                        className="min-h-32 leading-7"
                        value={String(story[field as keyof Story] || "")}
                        onChange={(e) => change({ [field]: e.target.value })}
                      />
                    </Field>
                  ))}
                  {stage === "outline" && (
                    <>
                      <Field label="全书结局">
                        <Textarea
                          value={n.ending}
                          onChange={(e) =>
                            change({ novel: { ...n, ending: e.target.value } })
                          }
                        />
                      </Field>
                      {n.volumes.map((v, i) => (
                        <Card key={i}>
                          <CardContent className="pt-5 space-y-3">
                            <h3 className="text-sm font-medium">
                              第{i + 1}卷 · 第{v.start}—{v.end}章
                            </h3>
                            {(
                              ["title", "goal", "climax", "resolution"] as const
                            ).map((key) => (
                              <Field
                                key={key}
                                label={
                                  {
                                    title: "卷名",
                                    goal: "本卷目标",
                                    climax: "高潮",
                                    resolution: "阶段结局",
                                  }[key]
                                }
                              >
                                <Textarea
                                  value={v[key]}
                                  onChange={(e) =>
                                    change({
                                      novel: {
                                        ...n,
                                        volumes: n.volumes.map((x, j) =>
                                          j === i
                                            ? { ...x, [key]: e.target.value }
                                            : x,
                                        ),
                                      },
                                    })
                                  }
                                />
                              </Field>
                            ))}
                          </CardContent>
                        </Card>
                      ))}
                    </>
                  )}
                </div>
                <StoryWritingAssistant
                  key={`${projectId}:${stage}`}
                  story={story}
                  stage={stage}
                  disabled={busy || active}
                  onApply={(patch) => {
                    const { chapter_plan, ...fields } = patch;
                    change(fields);
                    if (chapter_plan)
                      toast.info(
                        "全书方案已应用；近期章节由自动写作按分卷进度规划",
                      );
                  }}
                />
              </div>
            </fieldset>
          )}
        </section>
      )}
    </div>
  );
}
