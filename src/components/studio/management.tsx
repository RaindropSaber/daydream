"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Search,
  Check,
  RefreshCw,
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
import { useCreativeAction } from "./creative-action";
import { CreateDialog, Choice, ProductionSettingsDialog } from "./forms";
import { Heading, Empty, StatusBadge, date, kindNames } from "./common";
import { STEPS, TITLES, type Json } from "@/lib/types";
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
export { Assets } from "./assets";
export function Jobs() {
  const creativeAction = useCreativeAction();
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
                          ? `素材库 · ${project?.assets.find((a) => a.id === j.segment_id)?.name || "资源"}`
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
                                creativeAction({
                                  title: "继续未完成任务",
                                  description: `继续${names[j.kind] || j.kind}，保留已完成结果；需要继续生成时按供应商实际计费。`,
                                  label: "继续任务",
                                  action: () =>
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
                                })
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
  const [editingProduction, setEditingProduction] = useState(false);
  const [create, setCreate] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playError, setPlayError] = useState(false);
  const completed = playableEpisodes(project!);
  const cards = episodeCards(project!, jobs);
  const playing = completed.find((item) => item.episode.id === playingId);
  return (
    <div className="mx-auto max-w-6xl space-y-5 py-5">
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 break-words text-lg font-semibold">
            {project!.title}
          </h1>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            编辑项目
          </Button>
        </div>
        <p className="max-w-3xl whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
          {project!.brief || "添加项目简介，方便识别这部作品。"}
        </p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">视频制作</h2>
          <span className="text-xs text-muted-foreground">
            {project!.production.style} · {project!.production.ratio}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditingProduction(true)}
        >
          制作设置
        </Button>
      </div>
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
      {editingProduction && (
        <ProductionSettingsDialog onClose={() => setEditingProduction(false)} />
      )}
      {editing && (
        <CreateDialog
          type="project"
          projectId={project!.id}
          initial={{
            title: project!.title,
            brief: project!.brief,
            base_updated: project!.updated,
          }}
          onClose={() => setEditing(false)}
          onCreated={() => toast.success("项目名称与简介已保存")}
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
