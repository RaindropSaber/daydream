"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MessageCircle,
  Minus,
  LoaderCircle,
  ArrowUpRight,
  Plus,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AssistantComposer } from "./assistant-composer";
import { MENTION_PATTERN, type MentionOption } from "@/lib/assistant-mentions";
import { matchesDraft, pendingDraft } from "@/lib/assistant-draft";
import { assistantRequest } from "@/lib/assistant-request";
import { conversationTimeline } from "@/lib/conversation";
import { CREATION_SKILLS } from "@/lib/creation-flow";
import { TITLES } from "@/lib/types";
import { api, useAction, useStudio } from "./context";
import { useFormAssistant } from "./form-assistant";
import { Choice } from "./forms";

export function Assistant() {
  const studio = useStudio();
  const {
    targets,
    open,
    setOpen,
    conversations,
    activeId,
    select,
    newSession,
    update,
  } = useFormAssistant();
  const session = conversations.find((s) => s.id === activeId);
  const target = session?.target;
  const sending = useRef(new Set<string>());
  const { route } = studio;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const { busy, action } = useAction();
  const viewport = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const run = studio.run;
  const mediaJobs = studio.jobs
    .filter(
      (job) =>
        job.project_id === studio.project?.id && job.kind !== "conversation",
    )
    .sort((a, b) => b.created - a.created)
    .slice(0, 5);
  const messages = run ? conversationTimeline(run) : [];
  const value = session ? session.value : run ? drafts[run.id] || "" : "";
  const latestJob = studio.jobs
    .filter((j) => j.run_id === run?.id && j.kind === "conversation")
    .sort((a, b) => b.created - a.created)[0];
  const waiting = session
    ? session.busy
    : busy ||
      studio.jobs.some(
        (j) =>
          j.run_id === run?.id &&
          j.kind === "conversation" &&
          ["queued", "running"].includes(j.state),
      );
  const unavailable = !session && (!run || !!run.finished_at);
  const applyUnavailable =
    !target || !targets.includes(target) || target.snapshot().disabled;
  const createSession = () => newSession();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (open && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [
    open,
    activeId,
    run?.id,
    messages.length,
    session?.messages.length,
    waiting,
  ]);
  const mentionOptions = useMemo<MentionOption[]>(
    () => [
      ...Object.entries(CREATION_SKILLS).map(([id, skill]) => ({
        token: `@skill:${id}`,
        label: skill.title,
        kind: "skill" as const,
        description: `${id} · ${skill.module}`,
      })),
      ...(run
        ? Object.entries(TITLES)
            .filter(([id]) =>
              [
                "story",
                "director",
                "characters",
                "generation",
                "finish",
                "complete",
              ].includes(id),
            )
            .map(([id, title]) => ({
              token: `@stage:${id}`,
              label: title,
              kind: "stage" as const,
              description: "读取当前方案的内容与状态",
            }))
        : []),
      ...(studio.project?.assets.map((asset) => ({
        token: `@asset:${asset.id}`,
        label: asset.name,
        kind: "asset" as const,
        description: `素材库 · ${asset.kind}`,
      })) || []),
    ],
    [run?.id, studio.project?.assets],
  );

  const setValue = (text: string) => {
    if (session) update(session.id, (s) => ({ ...s, value: text }));
    else if (run) setDrafts((old) => ({ ...old, [run.id]: text }));
  };
  const send = () => {
    if (session) {
      if (
        sending.current.has(session.id) ||
        session.busy ||
        !session.value.trim() ||
        unavailable
      )
        return;
      const before = target?.snapshot();
      const pending = before
        ? pendingDraft(
            before,
            session.messages.filter(
              (message) => message.skill === target?.skill,
            ),
          )
        : {};
      const sent = [
        ...session.messages,
        {
          id: crypto.randomUUID(),
          role: "user" as const,
          text: session.value.trim(),
        },
      ];
      const request = assistantRequest(
        sent.slice(-39),
        session.referenceScope ??
          target?.scope ?? {
            project_id: studio.project?.id,
            episode_id: studio.episode?.id,
            run_id: run?.id,
          },
        target &&
          target.skill !== "story" &&
          target.skill !== "operation" &&
          before &&
          !before.disabled
          ? {
              skill: target.skill,
              form: { ...before.form, ...pending },
              context: before.context,
            }
          : undefined,
      );
      update(session.id, (s) => ({
        ...s,
        title: s.messages.length
          ? s.title
          : session.value.trim().split("\n")[0].slice(0, 28),
        messages: sent,
        referenceScope: request.context_scope,
        value: "",
        busy: true,
        error: "",
      }));
      sending.current.add(session.id);
      void (async () => {
        try {
          if (target?.request && (!before || applyUnavailable))
            throw new Error("原内容已关闭或暂不可编辑，请返回后重新发起对话");
          const result =
            target?.request && before
              ? await target.request(
                  { ...before, form: { ...before.form, ...pending } },
                  sent,
                )
              : await api("/api/studio/assistant", request);
          update(session.id, (s) => ({
            ...s,
            messages: [
              ...s.messages,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                text: result.reply,
                promptTrace: result.prompt_trace,
                skill: result.skill,
                patch: result.patch
                  ? {
                      ...(result.skill === target?.skill ? pending : {}),
                      ...result.patch,
                    }
                  : undefined,
                before,
              },
            ],
          }));
        } catch (e) {
          update(session.id, (s) => ({
            ...s,
            error: e instanceof Error ? e.message : "回复失败，请重试",
            value: s.value || session.value,
          }));
        } finally {
          update(session.id, (s) => ({ ...s, busy: false }));
          sending.current.delete(session.id);
        }
      })();
      return;
    }
    if (
      !value.trim() ||
      !studio.project ||
      !studio.episode ||
      !run ||
      unavailable ||
      waiting
    )
      return;
    if (studio.dirty) {
      toast.error("请先保存当前草稿，再发送对话");
      return;
    }
    const projectId = studio.project.id,
      episodeId = studio.episode.id,
      runId = run.id,
      sent = value;
    void action(async () => {
      await api(`/api/studio/projects/${projectId}/chat`, {
        episode_id: episodeId,
        run_id: runId,
        step: "assistant",
        page_context:
          route.view === "episode"
            ? route.step || "story"
            : route.view || "home",
        message: sent.trim(),
      });
      setDrafts((old) => (old[runId] === sent ? { ...old, [runId]: "" } : old));
      await studio.refresh();
    });
  };

  return (
    <div
      className={`fixed right-3 z-[60] sm:right-4 ${!open && route.view === "episode" && route.step === "director" ? "bottom-40" : "bottom-3 sm:bottom-4"}`}
    >
      {open && (
        <section
          id="creative-assistant"
          role="dialog"
          aria-label="创作助手"
          aria-modal={false}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
          className="mb-2 flex h-[min(760px,calc(100dvh-88px))] w-[min(480px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl"
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
            <h2 className="sr-only">创作助手</h2>
            <div className="min-w-0 flex-1">
              <Choice
                label="选择会话"
                className="h-8 w-full border-0 bg-transparent px-2 shadow-none"
                value={activeId || "legacy"}
                onChange={(id) => select(id === "legacy" ? null : id)}
                options={{
                  ...(!session || run
                    ? {
                        legacy: studio.episode
                          ? `${studio.episode.title} · 历史对话`
                          : "选择会话",
                      }
                    : {}),
                  ...Object.fromEntries(
                    conversations.map((s) => [s.id, s.title]),
                  ),
                }}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="新建会话"
              title="新建会话"
              onClick={createSession}
            >
              <Plus className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="收起创作助手"
              onClick={close}
            >
              <Minus className="size-4" />
            </Button>
          </header>
          <div
            ref={viewport}
            role="log"
            aria-label="创作对话记录"
            aria-live="polite"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3"
          >
            {session ? (
              <>
                {target?.activity}
                {target?.skill === "operation" && mediaJobs.length > 0 && (
                  <div
                    className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm"
                    role="status"
                  >
                    {mediaJobs.map((job) => (
                      <p key={job.id}>
                        {job.state === "done"
                          ? "已完成"
                          : job.state === "failed"
                            ? "失败"
                            : job.state === "running"
                              ? "执行中"
                              : "排队中"}{" "}
                        · {job.message || job.kind}
                      </p>
                    ))}
                  </div>
                )}
                {session.messages.map((m) => (
                  <article
                    key={m.id}
                    className={`text-sm leading-6 ${m.role === "user" ? "ml-8 rounded-xl bg-muted px-3 py-2" : "space-y-2"}`}
                  >
                    <p className="whitespace-pre-wrap break-words">
                      <MentionText text={m.text} options={mentionOptions} />
                    </p>
                    {m.promptTrace && (
                      <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                        <summary className="cursor-pointer font-medium">
                          本次 skill 与提示词
                        </summary>
                        <div className="mt-2 space-y-2 text-muted-foreground">
                          <p>
                            已加载：
                            {m.promptTrace.loaded_skills?.join("、") ||
                              m.promptTrace.skill ||
                              "无"}
                          </p>
                          {m.promptTrace.skill_file && (
                            <p className="break-all">
                              来源：{m.promptTrace.skill_file}
                            </p>
                          )}
                          {m.promptTrace.available_tool && (
                            <p className="break-all">
                              可用工具：{m.promptTrace.available_tool}
                            </p>
                          )}
                          <p>
                            下面是实际发往模型的请求内容，包含系统指令、上下文、对话和工具定义。
                          </p>
                          <pre
                            aria-label="实际模型请求"
                            className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-[11px] leading-5"
                          >
                            {JSON.stringify(m.promptTrace.requests, null, 2)}
                          </pre>
                        </div>
                      </details>
                    )}
                    {m.patch && (
                      <div className="space-y-3 rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {m.skill === "operation"
                              ? "待执行任务"
                              : "生成结果"}
                          </p>
                          {target && m.skill === target.skill && (
                            <Button
                              type="button"
                              size="sm"
                              className="h-7"
                              disabled={
                                m.applied || session.busy || applyUnavailable
                              }
                              onClick={async () => {
                                if (
                                  !targets.includes(target) ||
                                  !matchesDraft(target.snapshot(), m.before)
                                ) {
                                  toast.error(
                                    "内容已变化，请结合最新内容重新生成",
                                  );
                                  return;
                                }
                                update(session.id, (s) => ({
                                  ...s,
                                  busy: true,
                                  error: "",
                                }));
                                try {
                                  await target.apply(m.patch!);
                                  update(session.id, (s) => ({
                                    ...s,
                                    messages: s.messages.map((item) =>
                                      item.id === m.id
                                        ? { ...item, applied: true }
                                        : item,
                                    ),
                                  }));
                                  toast.success(
                                    target.appliedMessage ||
                                      "已应用，请检查后保存",
                                  );
                                } catch (e) {
                                  update(session.id, (s) => ({
                                    ...s,
                                    error:
                                      e instanceof Error
                                        ? e.message
                                        : "应用失败，请重试",
                                  }));
                                } finally {
                                  update(session.id, (s) => ({
                                    ...s,
                                    busy: false,
                                  }));
                                }
                              }}
                            >
                              {m.applied ? (
                                <>
                                  <Check className="size-3.5" />
                                  已应用
                                </>
                              ) : (
                                target.applyLabel || "应用"
                              )}
                            </Button>
                          )}
                        </div>
                        <DraftPreview
                          value={
                            m.skill === "operation"
                              ? Object.fromEntries(
                                  Object.entries(m.patch).filter(
                                    ([key]) => key !== "operation_id",
                                  ),
                                )
                              : m.patch
                          }
                        />
                        {target &&
                          m.skill === target.skill &&
                          !targets.includes(target) && (
                            <p className="text-xs text-muted-foreground">
                              原内容已关闭，请返回后重新发起对话。
                            </p>
                          )}
                      </div>
                    )}
                  </article>
                ))}
                {session.error && (
                  <p role="alert" className="text-sm text-destructive">
                    {session.error}
                  </p>
                )}
              </>
            ) : messages.length ? (
              messages.map((m) => {
                const step =
                  m.target_step || (m.stage !== "assistant" ? m.stage : null);
                return (
                  <article
                    key={m.id}
                    className={`text-sm leading-6 ${m.role === "user" ? "ml-8 rounded-xl bg-muted px-3 py-2" : "space-y-2"}`}
                  >
                    <p className="whitespace-pre-wrap break-words">
                      <MentionText text={m.text} options={mentionOptions} />
                    </p>
                    {m.version_id && step && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto px-0 text-xs"
                        onClick={() =>
                          studio.navigate("episode", {
                            project: studio.project!.id,
                            episode: studio.episode!.id,
                            run: run!.id,
                            step,
                            version: m.version_id,
                          })
                        }
                      >
                        查看{TITLES[step] || ""}草稿
                        <ArrowUpRight className="size-3" />
                      </Button>
                    )}
                  </article>
                );
              })
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                有什么想法，聊聊吧
              </p>
            )}
            {waiting && (
              <p
                role="status"
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <LoaderCircle className="size-3 animate-spin" />
                正在回复…
              </p>
            )}
            {!session && latestJob?.state === "failed" && (
              <p role="alert" className="text-xs text-destructive">
                {latestJob.message}。请重试。
              </p>
            )}
          </div>
          <footer className="shrink-0 border-t p-2">
            <AssistantComposer
              key={activeId || run?.id || "empty"}
              focusKey={`${open}:${activeId || run?.id}`}
              value={value}
              onChange={setValue}
              onSend={send}
              disabled={waiting || unavailable}
              waiting={!!waiting}
              options={mentionOptions}
            />
          </footer>
        </section>
      )}
      <div className="flex justify-end">
        <Button
          ref={trigger}
          aria-expanded={open}
          aria-controls="creative-assistant"
          className="h-10 rounded-full px-4 shadow-lg"
          onClick={() => {
            if (open) close();
            else if (!session) createSession();
            else setOpen(true);
          }}
        >
          <MessageCircle className="size-4" />
          创作助手
        </Button>
      </div>
    </div>
  );
}
const fieldNames: Record<string, string> = {
  title: "名称",
  name: "名称",
  text: "故事正文",
  brief: "简介 / 剧情",
  description: "描述",
  prompt: "提示词",
  ratio: "画幅",
  adaptation: "改编要求",
  style: "视觉风格",
  intent: "导演意图",
  beats: "镜头节拍",
  segments: "生成片段",
  camera: "运镜",
  dialogue: "对白",
  world: "世界观与美术",
  characters: "设定",
  items: "剪辑片段",
  segment_id: "片段",
  in: "开始时间",
  out: "结束时间",
  duration: "时长",
  target_duration: "预设时长（秒）",
  premise: "故事核心",
  genre: "题材",
  theme: "主题",
  outline: "全书主线",
  novel: "长篇方案",
  idea: "故事想法",
  target_words: "目标字数",
  chapter_words: "每章字数",
  ending: "全书结局",
  volumes: "分卷计划",
  start: "起始章节",
  end: "结束章节",
  goal: "本卷目标",
  climax: "高潮",
  resolution: "阶段结局",
  count: "写作章数",
  location: "场景",
  action: "动作",
};
function DraftPreview({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object")
    return (
      <p className="whitespace-pre-wrap break-words text-sm leading-6">
        {String(value)}
      </p>
    );
  if (Array.isArray(value))
    return (
      <ol className="space-y-2">
        {value.map((item, i) => (
          <li key={i} className="rounded border p-2">
            <p className="text-xs text-muted-foreground">{i + 1}</p>
            <DraftPreview value={item} />
          </li>
        ))}
      </ol>
    );
  return (
    <dl className="space-y-2">
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt className="text-xs text-muted-foreground">
            {fieldNames[key] || key}
          </dt>
          <dd>
            <DraftPreview value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MentionText({
  text,
  options,
}: {
  text: string;
  options: MentionOption[];
}) {
  const parts: React.ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(new RegExp(MENTION_PATTERN))) {
    parts.push(text.slice(end, match.index));
    const option = options.find((item) => item.token === match[0]);
    parts.push(
      <span
        key={match.index}
        title={match[0]}
        className="mx-0.5 inline-block rounded-md border border-primary/20 bg-primary/10 px-1.5 text-xs font-medium text-primary"
      >
        {match[1] === "skill" ? "✦ " : "@"}
        {option?.label || match[2]}
      </span>,
    );
    end = match.index! + match[0].length;
  }
  parts.push(text.slice(end));
  return <>{parts}</>;
}
