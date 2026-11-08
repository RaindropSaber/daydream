"use client";
import { useEffect, useState } from "react";
import {
  assetStates,
  stateId,
  stateName,
  resourceVersionLabel,
} from "@/lib/asset-state";
import {
  Plus,
  ArrowUpRight,
  Search,
  Check,
  RefreshCw,
  Download,
  Play,
  Pencil,
  Film,
  MoreHorizontal,
  LockKeyhole,
  Trash2,
} from "lucide-react";
import { playableEpisodes, episodeCards } from "@/lib/project-overview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { projectCreativeText } from "@/lib/creative-spec";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, useStudio, useAction } from "./context";
import { CreateDialog, Choice } from "./forms";
import { Heading, Empty, StatusBadge, date, kindNames } from "./common";
import { STEPS, TITLES, type Json, type Asset } from "@/lib/types";
export function Projects({ projects }: { projects: Json[] }) {
  const { navigate } = useStudio();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("updated");
  const [create, setCreate] = useState(false);
  const list = projects
    .filter((p) => p.title.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title, "zh-CN")
        : b.updated - a.updated,
    );
  return (
    <>
      <Heading
        title="我的项目"
        actions={
          <Button onClick={() => setCreate(true)}>
            <Plus />
            新建项目
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {projects.length} 个项目
        </p>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="w-52 pl-9"
              placeholder="搜索项目"
              aria-label="搜索项目"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Choice
            className="w-32"
            label="项目排序"
            value={sort}
            onChange={setSort}
            options={{ updated: "最近更新", name: "项目名称" }}
          />
        </div>
      </div>
      {list.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <Card
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`打开项目 ${p.title}`}
              className="cursor-pointer shadow-none transition hover:border-primary/40 hover:shadow-sm"
              onClick={() => navigate("overview", { project: p.id })}
              onKeyDown={(e) => {
                if (["Enter", " "].includes(e.key)) {
                  e.preventDefault();
                  navigate("overview", { project: p.id });
                }
              }}
            >
              <CardContent className="space-y-5 pt-6">
                <h2 className="flex items-center justify-between gap-3 font-semibold">
                  {p.title}
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                </h2>
                {p.brief && (
                  <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {p.brief}
                  </p>
                )}
                <div className="flex gap-2">
                  <Badge variant="secondary">{p.style}</Badge>
                  <Badge variant="secondary">{p.ratio}</Badge>
                  <Badge variant="secondary">{p.episodes} 集</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {date(p.updated)} 更新
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Empty>{search ? "未找到匹配的项目" : "暂无项目"}</Empty>
      )}
      {create && (
        <CreateDialog
          type="project"
          onClose={() => setCreate(false)}
          onCreated={(data) =>
            navigate("overview", { project: data.project.id })
          }
        />
      )}
    </>
  );
}
export function ProjectOverview() {
  const { project: p, navigate, jobs } = useStudio();
  const [create, setCreate] = useState(false);
  const { action, busy } = useAction();
  if (!p) return null;
  const download = () =>
    action(async () => {
      const data = await api(`/api/studio/projects/${p.id}/export`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = p.title + "-制作清单.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  return (
    <>
      <Heading
        title={p.title}
        description={p.brief}
        actions={
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void download()}
            >
              <Download />
              导出项目
            </Button>
            <Button onClick={() => setCreate(true)}>
              <Plus />
              新建分集
            </Button>
          </>
        }
      />
      <div className="mb-8 flex flex-wrap gap-3 border-y py-4 text-sm text-muted-foreground">
        <span>{p.style}</span>
        <span>·</span>
        <span>{p.ratio}</span>
        <span>·</span>
        <span>{p.episodes.length} 集</span>
        <span>·</span>
        <span>{p.assets.length} 份共享资源</span>
      </div>
      <h2 className="mb-4 font-semibold">分集</h2>
      {p.episodes.length ? (
        <div className="space-y-3">
          {episodeCards(p, jobs).map(
            ({ episode: e, run: r, step, hasNewVersion }) => {
              if (!r) return null;
              const complete = STEPS.filter(
                (s) => r.statuses?.[s] === "approved",
              ).length;
              return (
                <button
                  key={e.id}
                  onClick={() =>
                    navigate("episode", {
                      project: p.id,
                      episode: e.id,
                      run: r.id,
                      step,
                    })
                  }
                  className="flex w-full flex-wrap items-center gap-5 rounded-xl border bg-card p-5 text-left transition hover:border-primary/40"
                >
                  <span className="grid size-12 place-items-center rounded-lg bg-muted text-lg tabular-nums text-muted-foreground">
                    {String(e.number).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{e.title}</span>
                    <span className="mt-1 block truncate text-sm text-muted-foreground">
                      {e.brief || ""}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {e.runs.length} 个制作方案
                      {hasNewVersion ? " · 有新版本" : ""}
                    </span>
                  </span>
                  <span className="hidden space-y-2 md:block">
                    <span className="flex gap-1">
                      {STEPS.map((s) => (
                        <span
                          key={s}
                          className={`h-1 w-6 rounded ${r.statuses?.[s] === "approved" ? "bg-primary/70" : "bg-muted"}`}
                        />
                      ))}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {complete} / {STEPS.length} 步完成
                    </span>
                  </span>
                  <span className="text-sm text-primary">
                    {e.locked_at
                      ? "查看制作"
                      : r.finished_at
                        ? "查看已结束方案"
                        : "继续" + TITLES[step]}{" "}
                    →
                  </span>
                </button>
              );
            },
          )}
        </div>
      ) : (
        <Empty>暂无分集</Empty>
      )}
      {create && (
        <CreateDialog
          type="episode"
          onClose={() => setCreate(false)}
          onCreated={(data) =>
            navigate("episode", {
              project: p.id,
              episode: data.episode_id,
              run: data.run_id,
              step: "story",
            })
          }
        />
      )}
    </>
  );
}
export function Assets() {
  const { project: p } = useStudio();
  const [edit, setEdit] = useState<Json | null | undefined>(undefined);
  const [category, setCategory] = useState("all");
  if (!p) return null;
  const list = p.assets.filter(
    (a) => category === "all" || a.kind === category,
  );
  return (
    <>
      <Heading
        title="共享资源"
        actions={
          <Button
            onClick={() =>
              setEdit(category === "all" ? null : { kind: category })
            }
          >
            <Plus />
            新增资源
          </Button>
        }
      />
      <div
        className="mb-5 flex flex-wrap gap-2"
        role="group"
        aria-label="资源分类"
      >
        {Object.entries({ all: "全部", ...kindNames }).map(([kind, name]) => (
          <Button
            key={kind}
            variant={category === kind ? "default" : "outline"}
            size="sm"
            aria-pressed={category === kind}
            onClick={() => setCategory(kind)}
          >
            {name} ·{" "}
            {kind === "all"
              ? p.assets.length
              : p.assets.filter((a) => a.kind === kind).length}
          </Button>
        ))}
      </div>
      {list.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <AssetCard
              key={a.id}
              asset={a}
              onEdit={(v) =>
                setEdit({ asset_id: a.id, name: a.name, kind: a.kind, ...v })
              }
            />
          ))}
        </div>
      ) : (
        <Empty>
          {category === "all" ? "暂无资源" : `暂无${kindNames[category]}资源`}
        </Empty>
      )}
      {edit !== undefined && (
        <CreateDialog
          type="asset"
          initial={edit || undefined}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}
function AssetCard({
  asset: a,
  onEdit,
}: {
  asset: Asset;
  onEdit: (v: Json) => void;
}) {
  const { jobs, mutate } = useStudio();
  const { busy, action } = useAction();
  const states = assetStates(a);
  const [state, setState] = useState(
    stateId(a.versions.find((v) => v.id === a.selected) || {}),
  );
  const versions = a.versions.filter((v) => stateId(v) === state);
  const [id, setId] = useState(a.selected || a.versions.at(-1)?.id);
  useEffect(() => {
    setId(versions.at(-1)?.id);
  }, [a.versions.length, state]);
  const v = versions.find((v) => v.id === id) || versions.at(-1)!;
  const imageJob = jobs.find(
    (j) =>
      j.kind === "asset-image" &&
      j.segment_id === a.id &&
      (j.state_id || "default") === state,
  );
  const generating = imageJob && ["queued", "running"].includes(imageJob.state);
  const canGenerate = ["character", "scene", "prop"].includes(a.kind);
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="flex justify-between text-base">
          {a.name}
          <Badge variant="secondary">{kindNames[a.kind]}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Choice
          label={`${a.name}剧情状态`}
          value={state}
          onChange={setState}
          options={Object.fromEntries(
            states.map((v) => [stateId(v), stateName(v)]),
          )}
        />
        {!!v.tags?.length && (
          <div className="flex flex-wrap gap-1">
            {v.tags.map((tag: string) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {v.images?.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {v.images.map((i: Json) => (
              <a href={i.url} key={i.url} target="_blank" rel="noreferrer">
                <img
                  className="aspect-square w-full rounded-lg bg-muted object-contain"
                  src={i.url}
                  alt={a.name}
                />
              </a>
            ))}
          </div>
        )}
        <p className="max-h-44 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {v.description}
        </p>
        <Choice
          label={`${a.name}版本`}
          value={v.id}
          onChange={setId}
          options={Object.fromEntries(
            [...versions]
              .reverse()
              .map((v) => [
                v.id,
                `${resourceVersionLabel(v)} · ${date(v.created)}`,
              ]),
          )}
        />
        {imageJob && (generating || imageJob.state === "failed") && (
          <p role="status" className="text-sm text-muted-foreground">
            {imageJob.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {canGenerate && (
            <Button
              size="sm"
              disabled={busy || !!generating}
              onClick={() =>
                void action(() =>
                  mutate("asset-image", { asset_id: a.id, version_id: v.id }),
                )
              }
            >
              {generating
                ? "出图中…"
                : v.images?.length
                  ? "重新出图"
                  : "生成设定图"}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onEdit({
                description: v.description,
                url: v.url || "",
                base_version: v.id,
                state_name: stateName(v),
              })
            }
          >
            修正当前状态
          </Button>
          {v.url && (
            <Button variant="ghost" size="sm" asChild>
              <a href={v.url} target="_blank" rel="noreferrer">
                参考素材 ↗
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
export function Jobs() {
  const { jobs, refresh, mutate, navigate, project } = useStudio();
  const [filter, setFilter] = useState("all");
  const { busy, action } = useAction();
  const names: Record<string, string> = {
    characters: "设定集整理",
    "character-image": "设定图生成",
    "asset-image": "资源图生成",
    "video-batch": "整集视频生成",
    conversation: "创作对话",
    text: "内容生成",
    video: "视频生成",
    finish: "合成导出",
    assembly: "视频合成",
    export: "字幕导出",
  };
  const list = jobs.filter(
    (j) =>
      filter === "all" ||
      j.state === filter ||
      (filter === "running" && j.state === "queued"),
  );
  return (
    <>
      <Heading
        title="任务记录"
        actions={
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void action(refresh)}
          >
            <RefreshCw />
            刷新
          </Button>
        }
      />
      <div className="mb-5 w-36">
        <Choice
          label="任务状态"
          value={filter}
          onChange={setFilter}
          options={{
            all: "全部任务",
            running: "进行中",
            failed: "失败",
            done: "已完成",
          }}
        />
      </div>
      {list.length ? (
        <Card className="overflow-hidden shadow-none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">任务</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="hidden lg:table-cell">时间</TableHead>
                <TableHead className="text-right pr-5">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((j) => {
                const ep = project?.episodes.find((e) => e.id === j.episode_id),
                  run = ep?.runs.find((r) => r.id === j.run_id);
                return (
                  <TableRow key={j.id}>
                    <TableCell className="max-w-[520px] whitespace-normal py-5 pl-5">
                      <p className="font-medium">
                        {names[j.kind] || "制作任务"}
                        {j.step ? " · " + TITLES[j.step] : ""}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {j.kind === "asset-image"
                          ? `共享资源 · ${project?.assets.find((a) => a.id === j.segment_id)?.name || "资源"}`
                          : `${ep?.title || ""} · ${run?.name || ""}`}
                      </p>
                      {j.state === "failed" && (
                        <p className="mt-2 text-sm text-amber-700">
                          {j.message}
                        </p>
                      )}
                      {j.state === "running" && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {j.message}
                        </p>
                      )}
                      <details className="mt-2 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">任务详情</summary>
                        <p className="mt-2 whitespace-pre-wrap">{j.message}</p>
                        {j.remote_id && (
                          <p className="mt-1 break-all">
                            远端 ID：{j.remote_id}
                          </p>
                        )}
                      </details>
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={j.state} />
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                      {date(j.created)}
                    </TableCell>
                    <TableCell className="pr-5">
                      <div className="flex flex-wrap justify-end gap-2">
                        {j.result_url && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={j.result_url} download>
                              下载
                            </a>
                          </Button>
                        )}
                        {j.state === "failed" &&
                          (j.remote_id || j.kind === "video-batch") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void action(() =>
                                  mutate(
                                    j.kind === "video-batch"
                                      ? "resume-video-batch"
                                      : "resume",
                                    {
                                      episode_id: j.episode_id,
                                      run_id: j.run_id,
                                      job_id: j.id,
                                    },
                                  ),
                                )
                              }
                            >
                              继续
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Empty>暂无任务</Empty>
      )}
    </>
  );
}

export function ProjectSettings() {
  const { project, mutate, navigate, jobs, confirm } = useStudio();
  const [editing, setEditing] = useState(false);
  const [create, setCreate] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playError, setPlayError] = useState(false);
  const completed = playableEpisodes(project!);
  const cards = episodeCards(project!, jobs);
  const playing = completed.find((item) => item.episode.id === playingId);
  return (
    <div className="mx-auto max-w-6xl space-y-5 py-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 break-words text-lg font-semibold">
          {project!.title}
        </h1>
      </header>
      <section
        aria-label="基础信息"
        className="rounded-lg border bg-card px-4 py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">
            基础信息 · {project!.style} · {project!.ratio}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
            编辑
          </Button>
        </div>
        <dl className="mt-4 max-h-72 space-y-4 overflow-y-auto pr-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">创作方向</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words leading-7">
              {project!.brief || "尚未填写"}
            </dd>
          </div>
          {projectCreativeText(project!) && (
            <div>
              <dt className="text-xs text-muted-foreground">项目创作规范</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words leading-7">
                {projectCreativeText(project!)}
              </dd>
            </div>
          )}
        </dl>
      </section>
      <section aria-label="分集" className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            共 {project!.episodes.length} 集 · {completed.length} 集已有成片
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <button
            type="button"
            onClick={() => setCreate(true)}
            className="group flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card p-6 text-primary transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-12 place-items-center rounded-full bg-primary/10 transition group-hover:bg-primary/15">
              <Plus className="size-6" />
            </span>
            <span className="font-medium">制作新一集</span>
          </button>
          {cards.map(
            ({
              episode,
              run,
              film,
              step,
              status,
              working,
              hasNewVersion,
              viewRun,
              editableRun,
              editStep,
            }) => (
              <article
                key={episode.id}
                aria-label={`${episode.title}分集卡片`}
                className="overflow-hidden rounded-xl border bg-card"
              >
                <button
                  type="button"
                  aria-label={`播放${episode.title}`}
                  disabled={!film}
                  onClick={() => {
                    setPlayError(false);
                    setPlayingId(episode.id);
                  }}
                  className="group relative block aspect-video w-full overflow-hidden bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
                >
                  {film ? (
                    <EpisodeCover
                      key={film.output.id}
                      url={`/api/episode-covers/${encodeURIComponent(project!.id)}/${encodeURIComponent(episode.id)}?v=${encodeURIComponent(film.output.id)}`}
                      title={episode.title}
                    />
                  ) : (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                      <Film className="size-7" />
                      <span className="text-xs">暂无成片</span>
                    </span>
                  )}
                  {film && (
                    <span className="absolute inset-0 grid place-items-center bg-black/10 transition group-hover:bg-black/25">
                      <span className="grid size-10 place-items-center rounded-full bg-black/55 text-white">
                        <Play className="size-4" />
                      </span>
                    </span>
                  )}
                  <span className="absolute bottom-2 left-2 rounded bg-black/65 px-2 py-1 text-xs text-white">
                    第 {episode.number} 集
                  </span>
                </button>
                <div className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="min-w-0 break-words text-sm font-semibold">
                      {episode.title}
                    </h2>
                    <Badge
                      variant="secondary"
                      className={
                        working
                          ? "bg-blue-50 text-blue-700"
                          : run?.finished_at
                            ? "bg-emerald-50 text-emerald-700"
                            : ""
                      }
                    >
                      {status}
                    </Badge>
                  </div>
                  {run && (
                    <p className="truncate text-xs text-muted-foreground">
                      {run.name}
                      {hasNewVersion ? " · 有新版本" : ""}
                      {film && film.run.id !== run.id
                        ? " · 已有其他方案成片"
                        : ""}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {viewRun && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          navigate("episode", {
                            project: project!.id,
                            episode: episode.id,
                            run: viewRun.id,
                            step: viewRun.finished_at ? "complete" : step,
                          })
                        }
                      >
                        查看制作
                        <ArrowUpRight className="size-3.5" />
                      </Button>
                    )}
                    {editableRun && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          navigate("episode", {
                            project: project!.id,
                            episode: episode.id,
                            run: editableRun.id,
                            step: editStep,
                          })
                        }
                      >
                        继续制作
                        <ArrowUpRight className="size-3.5" />
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="ml-auto"
                          aria-label={`${episode.title}更多操作`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={
                            !!episode.locked_at ||
                            jobs.some(
                              (job) =>
                                job.episode_id === episode.id &&
                                ["queued", "running"].includes(job.state),
                            )
                          }
                          onSelect={() =>
                            confirm({
                              title: `永久锁定「${episode.title}」？`,
                              description:
                                "锁定后，本集所有方案只能查看，不能进行任何编辑、生成或新建版本。此操作不可逆，无法解锁。",
                              label: "永久锁定",
                              action: async () => {
                                await mutate("lock-episode", {
                                  episode_id: episode.id,
                                });
                              },
                            })
                          }
                        >
                          <LockKeyhole className="size-4" />
                          {episode.locked_at ? "已永久锁定" : "锁定"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          disabled={jobs.some(
                            (job) =>
                              job.episode_id === episode.id &&
                              ["queued", "running"].includes(job.state),
                          )}
                          onSelect={() =>
                            confirm({
                              title: `永久删除「${episode.title}」？`,
                              description:
                                "将删除本集的全部制作方案、历史版本和任务记录。此操作不可逆，无法恢复。",
                              label: "永久删除",
                              action: async () => {
                                await mutate("delete-episode", {
                                  episode_id: episode.id,
                                });
                              },
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </article>
            ),
          )}
        </div>
      </section>
      {editing && (
        <CreateDialog
          type="project"
          projectId={project!.id}
          initial={{
            title: project!.title,
            brief: project!.brief,
            style: project!.style,
            ratio: project!.ratio,
            creative_prompt: projectCreativeText(project!),
            base_updated: project!.updated,
          }}
          onClose={() => setEditing(false)}
          onCreated={() => toast.success("项目基础信息已保存")}
        />
      )}
      {create && (
        <CreateDialog
          type="episode"
          onClose={() => setCreate(false)}
          onCreated={(data) =>
            navigate("episode", {
              project: project!.id,
              episode: data.episode_id,
              run: data.run_id,
              step: "story",
            })
          }
        />
      )}
      <Dialog
        open={!!playing}
        onOpenChange={(open) => {
          if (!open) setPlayingId(null);
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{playing?.episode.title}</DialogTitle>
            <DialogDescription>{playing?.run.name}</DialogDescription>
          </DialogHeader>
          {playing && (
            <video
              key={playing.output.id}
              aria-label={`${playing.episode.title}成片`}
              controls
              autoPlay
              playsInline
              preload="metadata"
              src={playing.output.content.url}
              onError={() => setPlayError(true)}
              className="max-h-[70vh] w-full rounded-lg bg-black"
            />
          )}
          {playError && (
            <p role="alert" className="text-sm text-destructive">
              成片暂时无法播放，请检查文件是否仍然存在。
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EpisodeCover({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
      封面暂不可用
    </span>
  ) : (
    <img
      src={url}
      alt={`${title}视频首帧`}
      loading="lazy"
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-cover"
    />
  );
}
