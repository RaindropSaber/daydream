"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Check,
  FolderKanban,
  Settings2,
  ArrowLeft,
  Library,
  History,
  Clapperboard,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  api,
  StudioContext,
  ConfirmationProvider,
  useConfirm,
} from "./context";
import { Projects, ProjectSettings, Assets, Jobs } from "./management";
import { StoryEditor, PlanEditor } from "./editor";
import { FormAssistantProvider } from "./form-assistant";
import { Assistant } from "./assistant";
import { Models } from "./models";
import { WorkflowPipeline } from "./workflow-pipeline";
import { StageWorkspace } from "./stage-toolbar";
import { CompleteScheme } from "./complete-scheme";
import { SettingsEditor, Generation, Finish } from "./production";
import { CreateDialog, Choice } from "./forms";
import { Heading, StatusBadge } from "./common";
import { cn } from "@/lib/utils";
import { episodeDisplayRun } from "@/lib/project-overview";
import { STEPS, TITLES, type Project, type Json, type Job } from "@/lib/types";
export default function StudioApp() {
  return (
    <ConfirmationProvider>
      <FormAssistantProvider>
        <Workspace />
      </FormAssistantProvider>
    </ConfirmationProvider>
  );
}
function Workspace() {
  const router = useRouter(),
    query = useSearchParams();
  const confirm = useConfirm();
  const pid = query.get("project"),
    current = query.get("view") || (pid ? "overview" : "home");
  const [summary, setSummary] = useState<Json>({
    projects: [],
    config: {},
    profiles: {},
  });
  const [data, setData] = useState<{ project: Project; jobs: Job[] } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const epoch = useRef(0);
  const load = useCallback(
    async (spinner = false) => {
      const n = ++epoch.current;
      if (spinner) setLoading(true);
      try {
        const [index, detail] = await Promise.all([
          api("/api/studio"),
          pid ? api(`/api/studio/projects/${pid}`) : Promise.resolve(null),
        ]);
        if (n !== epoch.current) return;
        setSummary(index);
        setData(detail);
        setError("");
      } catch (e) {
        if (n === epoch.current)
          setError(e instanceof Error ? e.message : "读取失败");
      } finally {
        if (n === epoch.current) setLoading(false);
      }
    },
    [pid],
  );
  useEffect(() => {
    void load(true);
  }, [load]);
  useEffect(() => {
    if (current === "models") return;
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 2000);
    return () => clearInterval(timer);
  }, [current, load]);
  useEffect(() => {
    const handle = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handle);
    return () => window.removeEventListener("beforeunload", handle);
  }, [dirty]);
  const navigate = useCallback(
    (view: string, params: Json = {}) => {
      const go = () => {
        setDirty(false);
        const q = new URLSearchParams({
          view,
          ...Object.fromEntries(
            Object.entries(params).map(([k, v]) => [k, String(v)]),
          ),
        });
        router.push("/?" + q.toString());
      };
      if (dirty)
        confirm({
          title: "放弃未保存的修改？",
          description: "离开后，当前未保存的编辑将丢失。",
          label: "离开",
          action: go,
        });
      else go();
    },
    [router, dirty, confirm],
  );
  const p = data?.project || null;
  const episode = p?.episodes.find(
    (e) => e.id === (query.get("episode") || p.episodes[0]?.id),
  );
  const run = episode
    ? query.get("run")
      ? episode.runs.find((r) => r.id === query.get("run"))
      : episodeDisplayRun(episode)
    : undefined;
  const mutate = useCallback(
    async (action: string, body: Json = {}) => {
      if (!p) throw Error("请先选择项目");
      const result = await api(`/api/studio/projects/${p.id}/${action}`, {
        episode_id: episode?.id,
        run_id: run?.id,
        ...body,
      });
      await load();
      return result;
    },
    [p, episode?.id, run?.id, load],
  );
  const scoped = !!p && current !== "home";
  const sublinks = [
    { view: "overview", title: "项目概览", Icon: FolderKanban },
    { view: "assets", title: "共享资源", Icon: Library },
    { view: "jobs", title: "任务记录", Icon: History },
  ];
  return (
    <StudioContext.Provider
      value={{
        project: p,
        episode,
        run,
        jobs: data?.jobs || [],
        config: summary.config,
        profiles: summary.profiles,
        refresh: () => load(),
        mutate,
        navigate,
        dirty,
        setDirty,
        confirm,
      }}
    >
      <div className="h-dvh overflow-hidden bg-background">
        {scoped && (
          <aside
            aria-label="项目工作台侧栏"
            className="fixed inset-y-0 left-0 z-20 flex w-16 flex-col border-r bg-card px-2 py-5 sm:w-56 sm:px-4"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`切换项目：${p.title}`}
                  className="mb-6 flex w-full shrink-0 items-center justify-center gap-2 rounded-lg px-2 py-2 text-left outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:justify-start"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Clapperboard className="size-4" />
                  </span>
                  <div className="hidden min-w-0 flex-1 sm:block">
                    <p
                      className="truncate text-sm font-semibold"
                      title={p.title}
                    >
                      {p.title}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      项目工作台
                    </p>
                  </div>
                  <ChevronDown className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>切换项目</DropdownMenuLabel>
                {summary.projects.map((item: Json) => (
                  <DropdownMenuItem
                    key={item.id}
                    onSelect={() => {
                      if (item.id !== p.id)
                        navigate("overview", { project: item.id });
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.title}
                    </span>
                    {item.id === p.id && (
                      <Check className="size-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <nav
              aria-label="项目工作台导航"
              className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain"
            >
              {sublinks.map(({ view, title, Icon }) => {
                const active =
                  current === view ||
                  (view === "overview" &&
                    ["project-settings", "project", "episode"].includes(
                      current,
                    ));
                return (
                  <button
                    key={view}
                    aria-label={title}
                    aria-current={active ? "page" : undefined}
                    onClick={() => navigate(view, { project: p.id })}
                    className={cn(
                      "flex w-full items-center justify-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground transition hover:bg-muted sm:justify-start",
                      active && "bg-primary/7 text-primary",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="hidden sm:inline">{title}</span>
                  </button>
                );
              })}
            </nav>
            <div className="mt-4 shrink-0 space-y-1 border-t pt-3">
              <button
                aria-label="我的项目"
                onClick={() => navigate("home")}
                className="flex w-full items-center justify-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground transition hover:bg-muted sm:justify-start"
              >
                <FolderKanban className="size-4 shrink-0" />
                <span className="hidden sm:inline">我的项目</span>
              </button>
              <button
                aria-label="模型管理"
                aria-current={current === "models" ? "page" : undefined}
                onClick={() =>
                  navigate("models", scoped ? { project: p.id } : {})
                }
                className={cn(
                  "flex w-full items-center justify-center gap-3 rounded-lg px-3 py-3 text-sm text-muted-foreground transition hover:bg-muted sm:justify-start",
                  current === "models" && "bg-primary/7 text-primary",
                )}
              >
                <Settings2 className="size-4 shrink-0" />
                <span className="hidden sm:inline">模型管理</span>
              </button>
            </div>
          </aside>
        )}
        <div
          className={cn(
            "flex h-full min-w-0 flex-col",
            scoped && "ml-16 sm:ml-56",
          )}
        >
          {!scoped && (
            <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-4 lg:px-6">
              <button
                onClick={() => navigate("home")}
                aria-label="Daydream 我的项目"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <Clapperboard className="size-4 text-primary" />
                Daydream
              </button>
              {current !== "home" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate("home")}
                >
                  我的项目
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => navigate("models")}
                >
                  <Settings2 className="size-4" />
                  模型管理
                </Button>
              )}
            </header>
          )}
          <main
            className={cn(
              "mx-auto min-h-0 w-full max-w-[1800px] flex-1",
              current === "episode"
                ? "overflow-hidden p-3 lg:p-4"
                : "overflow-y-auto overscroll-contain px-5 pb-5 lg:px-6 lg:pb-6",
            )}
          >
            {loading ? (
              <div className="flex items-center justify-center gap-3 py-24 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                正在读取…
              </div>
            ) : error ? (
              <Card>
                <CardContent className="space-y-4 pt-6">
                  <p className="text-sm">{error}</p>
                  <Button variant="outline" onClick={() => void load(true)}>
                    重新读取
                  </Button>
                </CardContent>
              </Card>
            ) : current === "home" ? (
              <Projects projects={summary.projects} />
            ) : current === "models" ? (
              <Models />
            ) : !p ? (
              <p className="text-sm text-muted-foreground">项目不存在</p>
            ) : ["overview", "project-settings", "project"].includes(
                current,
              ) ? (
              <ProjectSettings key={p.id} />
            ) : current === "assets" ? (
              <Assets />
            ) : current === "jobs" ? (
              <Jobs />
            ) : (
              <Workflow
                key={run?.id || "empty"}
                step={
                  query.get("step") || (run?.finished_at ? "complete" : "story")
                }
              />
            )}
          </main>
        </div>
        <Assistant />
      </div>
    </StudioContext.Provider>
  );
}
function Workflow({ step }: { step: string }) {
  const {
    run: r,
    episode: e,
    project: p,
    navigate,
    mutate,
    jobs,
    confirm,
    dirty,
    setDirty,
  } = useContextStudio();
  const [newScheme, setNewScheme] = useState(false);
  if (!r || !e || !p)
    return <p className="text-sm text-muted-foreground">请先添加分集。</p>;
  const current = STEPS.includes(step as any) ? step : "story";
  const previous = (
    {
      director: "story",
      characters: "director",
      generation: "characters",
      finish: "generation",
      complete: "finish",
    } as Json
  )[current];
  const failure = jobs.find(
    (j) =>
      j.run_id === r.id &&
      ((j.step === current && ["text", "conversation"].includes(j.kind)) ||
        (current === "finish" && j.kind === "finish")),
  );
  const switchScheme = (rid: string) => {
    if (rid === r.id) return;
    const go = async () => {
      if (!e.locked_at) await mutate("switch-run", { run_id: rid });
      navigate("episode", {
        project: p.id,
        episode: e.id,
        run: rid,
        step: e.runs.find((scheme) => scheme.id === rid)?.finished_at
          ? "complete"
          : "story",
      });
    };
    if (dirty)
      confirm({
        title: "放弃未保存的修改？",
        description: "切换方案后，未保存的编辑将丢失。",
        action: async () => {
          setDirty(false);
          await go();
        },
      });
    else void go();
  };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <nav
        aria-label="制作工作台位置"
        className="flex shrink-0 items-center gap-2 text-sm"
      >
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 px-2"
          onClick={() => navigate("overview", { project: p.id })}
        >
          <ArrowLeft className="size-3.5" />
          返回项目概览
        </Button>
        <span
          className="min-w-0 truncate text-muted-foreground"
          title={`${p.title} / ${e.title}`}
        >
          {p.title}
          <span className="mx-2" aria-hidden="true">
            /
          </span>
          <span className="font-medium text-foreground">{e.title}</span>
          {e.target_duration != null && (
            <span className="ml-2 text-xs">预设 {e.target_duration} 秒</span>
          )}
        </span>
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 gap-3">
        <WorkflowPipeline
          controls={
            <>
              <div className="hidden md:block">
                <div className="flex items-center gap-2">
                  <h1
                    className="min-w-0 flex-1 truncate text-sm font-semibold"
                    title={e.title}
                  >
                    {e.title}
                  </h1>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    disabled={!!e.locked_at}
                    aria-label="新方案"
                    title="新方案"
                    onClick={() => setNewScheme(true)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-2 min-w-0">
                  <Choice
                    label="制作方案"
                    value={r.id}
                    onChange={switchScheme}
                    className="w-full min-w-0 text-xs [&_[data-slot=select-value]]:truncate"
                    options={Object.fromEntries(
                      e.runs.map((scheme) => [
                        scheme.id,
                        scheme.name + (scheme.finished_at ? " · 已结束" : ""),
                      ]),
                    )}
                  />
                </div>
                {(e.locked_at || r.finished_at) && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {e.locked_at ? "已永久锁定 · 只读" : "已结束 · 只读"}
                  </p>
                )}
              </div>
              <div className="md:hidden">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="分集与制作方案"
                    >
                      <Clapperboard className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuLabel>{e.title}</DropdownMenuLabel>
                    {e.runs.map((scheme) => (
                      <DropdownMenuItem
                        key={scheme.id}
                        onSelect={() => switchScheme(scheme.id)}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {scheme.name}
                          {scheme.finished_at ? " · 已结束" : ""}
                        </span>
                        {scheme.id === r.id && <Check className="size-4" />}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!!e.locked_at}
                      onSelect={() => setNewScheme(true)}
                    >
                      <Plus className="size-4" />
                      新方案
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </>
          }
          run={r}
          jobs={jobs}
          current={current}
          onSelect={(next) =>
            navigate("episode", {
              project: p.id,
              episode: e.id,
              run: r.id,
              step: next,
            })
          }
        />
        <StageWorkspace
          key={`${r.id}:${current}`}
          title={TITLES[current]}
          locked={!!e.locked_at || (!!r.finished_at && current !== "complete")}
        >
          <div
            key={current}
            aria-label={`${TITLES[current]}内容`}
            tabIndex={0}
            className={cn(
              "min-h-0 flex-1 p-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:p-5",
              current === "story"
                ? "flex flex-col overflow-hidden"
                : "overflow-y-auto overscroll-contain",
            )}
          >
            {previous && r.statuses?.[previous] !== "approved" && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800">
                <span>请先确认{TITLES[previous]}。</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate("episode", {
                      project: p.id,
                      episode: e.id,
                      run: r.id,
                      step: previous,
                    })
                  }
                >
                  前往{TITLES[previous]}
                </Button>
              </div>
            )}
            {r.statuses?.[current] === "stale" && (
              <p className="mb-5 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800">
                上游内容已变更，请更新当前版本。历史结果仍可查看。
              </p>
            )}
            {failure?.state === "failed" && (
              <p
                role="alert"
                className="mb-5 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800"
              >
                {failure.message}
              </p>
            )}
            {current === "complete" ? (
              <CompleteScheme onNewScheme={() => setNewScheme(true)} />
            ) : (
              <>
                {(e.locked_at || r.finished_at) && (
                  <p className="mb-4 text-sm text-muted-foreground">
                    {e.locked_at
                      ? "本集已永久锁定，所有方案只能查看，不能编辑或新建版本。"
                      : "此方案已结束，内容只读。可通过左侧分集名称旁的「+」新建方案继续创作。"}
                  </p>
                )}
                <fieldset
                  disabled={!!e.locked_at || !!r.finished_at}
                  className={
                    current === "story"
                      ? "flex min-h-0 min-w-0 flex-1 flex-col"
                      : "min-w-0"
                  }
                >
                  <legend className="sr-only">
                    {TITLES[current]}
                    {e.locked_at || r.finished_at ? "（只读）" : "编辑"}
                  </legend>
                  {current === "story" ? (
                    <StoryEditor key={r.id + current} />
                  ) : current === "director" ? (
                    <PlanEditor key={r.id + current} />
                  ) : current === "characters" ? (
                    <SettingsEditor key={r.id + current} />
                  ) : current === "generation" ? (
                    <Generation />
                  ) : (
                    <Finish />
                  )}
                </fieldset>
              </>
            )}
          </div>
        </StageWorkspace>
      </div>
      {newScheme && !e.locked_at && (
        <CreateDialog
          type="run"
          initial={{
            name: `制作方案 ${e.runs.length + 1}`,
            inherit: r.finished_at ? "all" : "story",
          }}
          onClose={() => setNewScheme(false)}
          onCreated={(data) =>
            navigate("episode", {
              project: p.id,
              episode: e.id,
              run: data.run_id,
              step: "story",
            })
          }
        />
      )}
    </div>
  );
}
import { useStudio as useContextStudio } from "./context";
