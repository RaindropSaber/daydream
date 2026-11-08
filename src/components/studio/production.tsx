"use client";
import { stateId, stateName, resourceVersionLabel } from "@/lib/asset-state";
import { useState, useEffect, useRef } from "react";
import {
  Plus,
  ImagePlus,
  Download,
  ArrowUp,
  ArrowDown,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStudio, useAction, useUnsaved } from "./context";
import { StageToolbar, StageMoreActions } from "./stage-toolbar";
import { useCreativeAction } from "./creative-action";
import { FormAssistant } from "./form-assistant";
import { Field, Choice, EditorDialog } from "./forms";
import { VersionBar, VersionActions, useVersion } from "./editor";
import { StatusBadge, Empty, kindNames, date } from "./common";
import type { Json, Run } from "@/lib/types";
import { videoCardState } from "@/lib/video-state";
import { workflowStages } from "@/lib/workflow";
const worldNames: Record<string, string> = {
  premise: "时代与世界观",
  technology: "科技与能源",
  visual_language: "视觉语言",
  palette: "配色与光线",
  materials: "材质与工艺",
  avoid: "避免元素",
};
const plan = (r: Run) =>
  r.steps.director.versions.find((v) => v.id === r.steps.director.selected)
    ?.content;
const setting = (r: Run) =>
  r.steps.characters.versions.find((v) => v.id === r.steps.characters.selected)
    ?.content;
export function SettingsEditor() {
  const creativeAction = useCreativeAction();
  const editor = useVersion("characters");
  const { run: r, mutate, confirm, jobs, project: p, navigate } = useStudio();
  const [edit, setEdit] = useState<Json | null>(null);
  const [draft, setDraft] = useState<Json | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [editor.v?.id]);
  if (!r) return null;
  const content = draft || editor.v?.content,
    adopted = !draft && editor.v?.id === editor.current,
    working = jobs.some(
      (j) =>
        j.run_id === r.id &&
        ["characters", "character-image"].includes(j.kind) &&
        ["queued", "running"].includes(j.state),
    );
  const ready = r.statuses?.director === "approved";
  const missing = (content?.characters || []).filter(
    (c: Json) => !c.images?.length && !c.url,
  );
  const generateAll = () =>
    creativeAction({
      title: "生成设定图",
      description: `将${adopted ? "使用当前版本" : "采用当前草稿并"}补齐 ${missing.length} 项设定图，调用 Seedream 并按供应商实际计费。`,
      label: "开始生成",
      action: () =>
        mutate("generate-all-settings", { version_id: editor.v?.id }).then(
          () => {},
        ),
    });
  return (
    <div className="space-y-6">
      {content && (
        <StageMoreActions>
          <Button
            size="sm"
            variant="ghost"
            disabled={!adopted || !ready || working}
            onClick={() =>
              setEdit({ type: "world", value: content.world || {} })
            }
          >
            编辑美术规范
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!adopted || !ready || working}
            onClick={() => setEdit({ type: "bind" })}
          >
            <Plus />
            从素材库添加
          </Button>
          <Button
            disabled={
              !!draft || !content || !ready || working || !missing.length
            }
            onClick={generateAll}
          >
            <ImagePlus />
            生成缺少的图片
          </Button>
        </StageMoreActions>
      )}
      <FormAssistant
        dock
        compactToolbar
        toolbarStart={
          <>
            <VersionBar step="characters" editor={editor} compact />
            <StatusBadge
              value={
                editor.dirty
                  ? "draft"
                  : adopted
                    ? r.statuses?.characters || "empty"
                    : content
                      ? "draft"
                      : "empty"
              }
            />
          </>
        }
        toolbarEnd={
          <div className="flex items-center gap-2">
            <VersionActions
              editor={editor}
              content={draft || undefined}
              compact
            />
          </div>
        }
        key={`settings-${editor.v?.id || "new"}`}
        skill="settings"
        form={content || { world: {}, characters: [] }}
        disabled={!ready || working || editor.busy}
        onApply={(patch) => {
          setDraft((old) => ({ ...(old || content), ...patch }));
          editor.setDirty(true);
        }}
      />
      {draft && <p className="text-sm text-muted-foreground">草稿未保存</p>}
      <div className="min-w-0 space-y-4">
        {content ? (
          <Card className="overflow-hidden shadow-none">
            <CardContent className="space-y-7 pt-5">
              <section className="rounded-lg border bg-muted/20 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="font-medium">统一美术规范</h3>
                </div>
                <dl className="space-y-4">
                  {Object.entries(worldNames).map(([k, label]) => (
                    <div
                      key={k}
                      className="grid gap-1 sm:grid-cols-[110px_1fr]"
                    >
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="whitespace-pre-wrap text-sm leading-relaxed">
                        {content.world?.[k] || "未填写"}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  本集设定 · {content.characters.length}
                </h3>
              </div>
              {content.characters.map((c: Json) => {
                const job = jobs.find(
                  (j) =>
                    j.run_id === r.id &&
                    j.kind === "character-image" &&
                    j.segment_id === c.asset_id &&
                    (j.state_id || "default") === stateId(c),
                );
                const images = c.images?.length
                  ? c.images
                  : job?.state === "failed"
                    ? job.images || []
                    : [];
                const generating =
                  job && ["queued", "running"].includes(job.state);
                return (
                  <section
                    key={c.asset_id + ":" + stateId(c)}
                    className="space-y-4 rounded-lg border p-4"
                  >
                    <div className="flex justify-between gap-3">
                      <div>
                        <h3 className="font-medium">
                          {c.name} · {stateName(c)}
                        </h3>
                        {!!c.tags?.length && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {c.tags.join(" · ")}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary">
                        {kindNames[c.kind || "character"]}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate("assets", {
                          project: p!.id,
                          asset: c.asset_id,
                          state: stateId(c),
                        })
                      }
                    >
                      在素材库审阅与采用候选
                    </Button>
                    {images.length ? (
                      <div className="flex gap-3">
                        {images.map((i: Json) => (
                          <a
                            className="min-w-0 flex-1"
                            key={i.url}
                            href={i.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <img
                              className="h-52 w-full rounded-md bg-muted object-contain"
                              src={i.url}
                              alt={c.name + "设定图"}
                            />
                          </a>
                        ))}
                      </div>
                    ) : c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer">
                        <img
                          className="h-52 w-full rounded-md bg-muted object-contain"
                          src={c.url}
                          alt={c.name}
                        />
                      </a>
                    ) : (
                      <div className="grid h-40 place-items-center rounded-md bg-muted text-sm text-muted-foreground">
                        暂无设定图
                      </div>
                    )}
                    <p className="max-h-52 overflow-auto whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                      {c.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      使用片段：
                      {c.segment_ids
                        .map(
                          (id: string) =>
                            plan(r)?.segments.find((s: Json) => s.id === id)
                              ?.title || id,
                        )
                        .join("、")}
                    </p>
                    {generating && (
                      <p className="flex gap-2 text-xs text-muted-foreground">
                        <LoaderCircle className="size-3 animate-spin" />
                        {job.message}
                      </p>
                    )}
                    {job?.state === "failed" && (
                      <p className="text-sm text-amber-700">{job.message}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!adopted || !ready || working}
                        onClick={() => setEdit({ type: "entry", entry: c })}
                      >
                        修正当前状态
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!adopted || !ready || working}
                        onClick={() => setEdit({ type: "state", entry: c })}
                      >
                        <Plus />
                        新增剧情状态
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!adopted || !ready || working}
                        onClick={() =>
                          creativeAction({
                            title:
                              job?.state === "failed" && images.length
                                ? "继续生成设定图"
                                : "生成设定图",
                            description: `为「${c.name}」${job?.state === "failed" && images.length ? "补齐剩余图片" : "生成新的设定图"}，调用 Seedream 并按供应商实际计费。`,
                            label: "生成",
                            action: () =>
                              mutate("character-image", {
                                asset_id: c.asset_id,
                                entry_version: c.version,
                                ...(job?.state === "failed" && images.length
                                  ? { resume_job_id: job.id }
                                  : {}),
                              }).then(() => {}),
                          })
                        }
                      >
                        {job?.state === "failed" && images.length
                          ? "继续生成"
                          : c.images?.length || c.url
                            ? "重新生成图片"
                            : "生成图片"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!adopted || !ready || working}
                        onClick={() =>
                          confirm({
                            title: "移出本集？",
                            description: `移出「${c.name}」；项目资源和历史版本保留。`,
                            action: () =>
                              mutate("remove-character", {
                                asset_id: c.asset_id,
                                entry_version: c.version,
                              }).then(() => {}),
                          })
                        }
                      >
                        移出
                      </Button>
                    </div>
                  </section>
                );
              })}
            </CardContent>
          </Card>
        ) : (
          <Empty>暂无设定集</Empty>
        )}
      </div>
      {edit && (
        <SettingDialog
          key={edit.type + String(edit.entry?.version || "")}
          value={edit}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
function SettingDialog({
  value,
  onClose,
}: {
  value: Json;
  onClose: () => void;
}) {
  const { run: r, project: p, mutate } = useStudio();
  const { action, busy } = useAction();
  const [world, setWorld] = useState<Json>(
    value.value ||
      Object.fromEntries(Object.keys(worldNames).map((k) => [k, ""])),
  );
  const [description, setDescription] = useState(
    value.entry?.description || "",
  );
  const [ids, setIds] = useState<string[]>(
    value.type === "state" ? [] : value.entry?.segment_ids || [],
  );
  const [stateTitle, setStateTitle] = useState("");
  const [tags, setTags] = useState("");
  const assets = p!.assets.filter((a) =>
    ["character", "scene", "prop"].includes(a.kind),
  );
  const [reference, setReference] = useState(
    assets[0] ? assets[0].id + ":" + assets[0].selected : "",
  );
  const list = plan(r!)?.segments || [];
  return (
    <EditorDialog
      title={
        value.type === "world"
          ? "统一美术规范"
          : value.type === "bind"
            ? "绑定共享设定"
            : value.type === "state"
              ? "新增剧情状态"
              : "修正当前状态"
      }
      description={
        value.type === "world"
          ? "修改规范会使当前设定图待更新，历史图片保留。"
          : value.type === "state"
            ? "从原状态继承设定和参考图。仅所选片段切换到新状态，其他片段保持原样。"
            : value.type === "entry"
              ? "修正会保存新版本；已完成的其他方案及历史版本保持原样。"
              : undefined
      }
      busy={busy}
      onClose={onClose}
      onSubmit={() =>
        void action(async () => {
          if (value.type === "world") await mutate("edit-world", { world });
          else if (value.type === "state")
            await mutate("new-resource-state", {
              asset_id: value.entry.asset_id,
              entry_version: value.entry.version,
              state_name: stateTitle,
              tags: tags
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
              description,
              segment_ids: ids,
            });
          else if (value.type === "entry")
            await mutate("edit-character", {
              asset_id: value.entry.asset_id,
              entry_version: value.entry.version,
              description,
              segment_ids: ids,
            });
          else {
            const [asset_id, version_id] = reference.split(":");
            await mutate("bind-character", {
              asset_id,
              version_id,
              segment_ids: ids,
            });
          }
          onClose();
        })
      }
    >
      {value.type !== "bind" && (
        <FormAssistant
          skill={value.type === "world" ? "world" : "entry"}
          form={value.type === "world" ? world : { description }}
          context={{ entry: value.entry }}
          disabled={busy}
          onApply={(patch) =>
            value.type === "world"
              ? setWorld((old) => ({ ...old, ...patch }))
              : setDescription(patch.description)
          }
        />
      )}
      {value.type === "world" ? (
        Object.entries(worldNames).map(([k, label]) => (
          <Field key={k} label={label}>
            <Textarea
              rows={3}
              value={world[k] || ""}
              onChange={(e) =>
                setWorld((old) => ({ ...old, [k]: e.target.value }))
              }
            />
          </Field>
        ))
      ) : (
        <>
          {value.type === "state" && (
            <>
              <Field label="状态名称">
                <Input
                  required
                  maxLength={80}
                  value={stateTitle}
                  onChange={(e) => setStateTitle(e.target.value)}
                  placeholder="如：雨衣造型、暴雨夜、火灾后"
                />
              </Field>
              <Field label="标签（逗号分隔）">
                <Input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="冬季，受伤，第3集"
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                来源：{value.entry.name} · {stateName(value.entry)}
                ；保留人物身份或场景结构，只修改本次剧情变化。
              </p>
            </>
          )}
          {value.type === "entry" || value.type === "state" ? (
            <Field label="设定描述">
              <Textarea
                required
                rows={9}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="资源版本">
              <Choice
                label="设定资源版本"
                disabled={!reference}
                value={reference || "none"}
                onChange={setReference}
                options={
                  reference
                    ? Object.fromEntries(
                        assets.flatMap((a) =>
                          a.versions.map((v) => [
                            a.id + ":" + v.id,
                            `${a.name} · ${resourceVersionLabel(v)}`,
                          ]),
                        ),
                      )
                    : { none: "暂无可用设定" }
                }
              />
            </Field>
          )}
          <Field label="使用片段">
            <div className="space-y-3">
              {list.map((s: Json) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={ids.includes(s.id)}
                    onChange={(e) =>
                      setIds((old) =>
                        e.target.checked
                          ? [...old, s.id]
                          : old.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.title}
                </label>
              ))}
            </div>
          </Field>
        </>
      )}
    </EditorDialog>
  );
}
export function Generation() {
  const creativeAction = useCreativeAction();
  const { run: r, jobs, mutate, confirm } = useStudio();
  const { action, busy } = useAction();
  const attemptedPlan = useRef("");
  const [planningError, setPlanningError] = useState("");
  const storyboard = !!r && plan(r)?.planning_mode === "storyboard";
  const planFresh =
    !storyboard ||
    (r?.generation_plan?.director_version === r?.steps.director.selected &&
      r?.generation_plan?.resource_version === r?.steps.characters.selected &&
      r?.generation_plan?.model === r?.model);
  const basis = r
    ? `${r.id}:${r.steps.director.selected}:${r.steps.characters.selected}:${r.model}`
    : "";
  const compile = () =>
    action(async () => {
      setPlanningError("");
      try {
        await mutate("compile-video-plan");
      } catch (error) {
        setPlanningError(
          error instanceof Error ? error.message : "片段组合失败",
        );
        throw error;
      }
    });
  useEffect(() => {
    if (
      storyboard &&
      !planFresh &&
      !r?.finished_at &&
      r?.statuses?.director === "approved" &&
      r?.statuses?.characters === "approved" &&
      !jobs.some(
        (j) =>
          j.run_id === r.id &&
          ["video", "video-batch"].includes(j.kind) &&
          ["queued", "running"].includes(j.state),
      ) &&
      attemptedPlan.current !== basis
    ) {
      attemptedPlan.current = basis;
      void compile();
    }
  }, [basis, storyboard, planFresh]);
  if (!r) return null;
  const list =
      (storyboard ? r.generation_plan?.segments : plan(r)?.segments) || [],
    working = jobs.some(
      (j) =>
        j.run_id === r.id &&
        ["video", "video-batch"].includes(j.kind) &&
        ["queued", "running"].includes(j.state),
    ),
    ready =
      r.statuses?.characters === "approved" &&
      r.statuses?.director === "approved" &&
      planFresh;
  const batch = jobs.find((j) => j.run_id === r.id && j.kind === "video-batch");
  const generationState = workflowStages(r, jobs).find(
    (stage) => stage.id === "generation",
  )!.state;
  return (
    <div className="space-y-5">
      <StageToolbar
        meta={
          <>
            <StatusBadge
              value={
                ["running", "queued", "failed"].includes(generationState)
                  ? generationState
                  : r.statuses?.generation || "empty"
              }
            />{" "}
            <p className="text-sm text-muted-foreground">
              {
                list.filter(
                  (s: Json) => r.media_fresh?.[s.id] && r.media_selection[s.id],
                ).length
              }{" "}
              / {list.length}
            </p>
          </>
        }
      >
        {storyboard && (
          <Button
            variant="outline"
            disabled={busy || working || !!r.finished_at}
            onClick={() => void compile()}
          >
            重新组合片段
          </Button>
        )}
        <Button
          disabled={!ready || working || busy || !list.length}
          onClick={() =>
            void action(async () => {
              const preview = await mutate("preview-video-batch");
              creativeAction({
                title: "生成整集视频",
                description: `预计新增 ${preview.new_count} 段、${preview.new_seconds} 秒，复用 ${preview.reuse_count} 段。新增片段按所选供应商实际计费。`,
                label: "开始生成",
                action: () =>
                  mutate("generate-all-videos", {
                    preview_token: preview.token,
                  }).then(() => {}),
              });
            })
          }
        >
          生成整集片段
        </Button>
        {batch && (
          <div className="flex gap-2">
            {batch.state === "done" && (
              <Button
                size="sm"
                disabled={
                  busy ||
                  Object.entries(batch.results || {}).every(
                    ([sid, id]) => r.media_selection[sid] === id,
                  )
                }
                onClick={() =>
                  void action(() =>
                    mutate("adopt-video-batch", { job_id: batch.id }),
                  )
                }
              >
                {Object.entries(batch.results || {}).every(
                  ([sid, id]) => r.media_selection[sid] === id,
                )
                  ? "已采用"
                  : "采用这批片段"}
              </Button>
            )}
            {batch.state === "failed" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || working}
                onClick={() =>
                  creativeAction({
                    title: "继续未完成视频片段",
                    description:
                      "保留已完成候选，继续这批尚未完成的片段，按供应商实际计费。",
                    label: "继续生成",
                    action: () =>
                      mutate("resume-video-batch", { job_id: batch.id }),
                  })
                }
              >
                继续未完成片段
              </Button>
            )}
          </div>
        )}
      </StageToolbar>
      {storyboard && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm">
          <p>
            {busy
              ? "正在按模型能力组合分镜…"
              : planFresh
                ? `已自动组合 ${list.length} 个生成片段，优先减少调用次数；每段已包含分镜和实际传入的参考资源。`
                : "分镜、资源或模型已变化，请重新组合片段。"}
          </p>
          {planningError && (
            <p role="alert" className="text-destructive">
              {planningError}
            </p>
          )}
        </div>
      )}
      {batch && (
        <Card className="shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <div>
              <p className="font-medium">
                整集任务 · {batch.progress?.done || 0} /{" "}
                {batch.progress?.total || list.length}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {batch.message}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      {list.length ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {list.map((s: Json) => (
            <VideoCard key={s.id} segment={s} working={working} ready={ready} />
          ))}
        </div>
      ) : (
        <Empty>请先确认视频方案</Empty>
      )}
    </div>
  );
}
function VideoCard({
  segment: s,
  working,
  ready,
}: {
  segment: Json;
  working: boolean;
  ready: boolean;
}) {
  const creativeAction = useCreativeAction();
  const { run: r, jobs, mutate, confirm } = useStudio();
  const versions = r!.media[s.id] || [],
    adopted = r!.media_selection[s.id];
  const [id, setId] = useState(adopted || versions.at(-1)?.id || "");
  useEffect(() => {
    if (versions.length) setId(versions.at(-1)!.id);
  }, [versions.length]);
  const v =
    versions.find((v) => v.id === id) ||
    versions.find((v) => v.id === adopted) ||
    versions.at(-1);
  const { state, job } = videoCardState(r!, jobs, s.id, v?.id);
  const { action, busy } = useAction();
  const [options, setOptions] = useState(false);
  return (
    <Card className="overflow-hidden shadow-none">
      <div className="aspect-video bg-slate-950">
        {v ? (
          <video
            className="h-full w-full"
            controls
            preload="metadata"
            src={v.content.url}
          />
        ) : (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 text-sm text-slate-400"
            role="status"
          >
            {state === "running" && (
              <LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" />
            )}
            {state === "running"
              ? "视频生成中"
              : state === "queued"
                ? "等待生成视频"
                : state === "failed"
                  ? "视频生成失败"
                  : "暂无视频"}
          </div>
        )}
      </div>
      <CardContent className="space-y-4 pt-5">
        <div className="flex justify-between gap-3">
          <h3 className="font-medium">{s.title}</h3>
          <StatusBadge value={state} />
        </div>
        <p className="text-xs text-muted-foreground">
          {s.start}–{s.end} 秒 · {s.duration} 秒
        </p>
        {v && (
          <Choice
            label={`${s.title}视频版本`}
            value={v.id}
            onChange={setId}
            options={Object.fromEntries(
              [...versions]
                .reverse()
                .map((v) => [
                  v.id,
                  `v${v.number} · ${v.content.quality === "draft" ? "样片" : v.content.quality === "final" ? "1080P" : "720P"}${v.id === adopted ? " · 已采用" : ""}`,
                ]),
            )}
          />
        )}
        <div className="flex flex-wrap gap-2">
          {v && (
            <>
              <Button
                size="sm"
                disabled={busy || v.id === adopted}
                onClick={() =>
                  void action(() =>
                    mutate("adopt-media", {
                      segment_id: s.id,
                      version_id: v.id,
                    }),
                  )
                }
              >
                {v.id === adopted ? "已采用" : "采用此版本"}
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={v.content.url} download>
                  下载
                </a>
              </Button>
            </>
          )}
          {r!.model.startsWith("wan") && r!.model !== "wan2.6-t2v" && (
            <Button
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => setOptions(true)}
            >
              首帧与声音
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!ready || working || busy}
            onClick={() =>
              creativeAction({
                title: "生成视频",
                description: `生成「${s.title}」，${Math.ceil(s.duration)} 秒、720P。使用当前视频模型并按供应商实际计费，结果保存为新候选。`,
                label: "提交生成",
                action: () =>
                  mutate("generate-video", {
                    segment_id: s.id,
                    quality: "standard",
                  }).then(() => {}),
              })
            }
          >
            生成 720P 视频
          </Button>
        </div>
        {job && (
          <p
            className={`text-xs ${job.state === "failed" ? "text-amber-700" : "text-muted-foreground"}`}
          >
            {job.message}
          </p>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">提示词与参考</summary>
          <p className="mt-3 whitespace-pre-wrap leading-6">{s.prompt}</p>
          {!!s.beat_ids?.length && (
            <p className="mt-2">包含分镜：{s.beat_ids.join("、")}</p>
          )}
          {!!s.references?.length && (
            <div className="mt-3 flex flex-wrap gap-3">
              {s.references.map((ref: Json, index: number) => (
                <div key={index} className="w-24 space-y-1">
                  {ref.image?.url && (
                    <img
                      src={ref.image.url}
                      alt={ref.name}
                      className="h-20 w-24 rounded border object-contain"
                    />
                  )}
                  <p>{ref.name}</p>
                </div>
              ))}
            </div>
          )}
        </details>
      </CardContent>
      {options && (
        <VideoOptions segment={s} onClose={() => setOptions(false)} />
      )}
    </Card>
  );
}
function VideoOptions({
  segment: s,
  onClose,
}: {
  segment: Json;
  onClose: () => void;
}) {
  const { run: r, mutate } = useStudio();
  const current = r!.video_options?.[s.id] || {};
  const [frame, setFrame] = useState(
    current.first_frame?.startsWith("https://")
      ? "none"
      : current.first_frame || "none",
  );
  const [url, setUrl] = useState(
    current.first_frame?.startsWith("https://") ? current.first_frame : "",
  );
  const [audio, setAudio] = useState(
    current.audio === false ? "false" : "true",
  );
  const images =
    plan(r!)?.planning_mode === "storyboard"
      ? (s.references || [])
          .filter((ref: Json) => ref.image)
          .map((ref: Json) => [ref.image.file || ref.image.url, ref.name])
      : (setting(r!)?.characters || [])
          .filter((c: Json) => c.segment_ids.includes(s.id))
          .flatMap((c: Json) =>
            (c.images || []).map((i: Json) => [
              i.file,
              `${c.name} · ${i.pose || "参考图"}`,
            ]),
          );
  const { action, busy } = useAction();
  return (
    <EditorDialog
      title="首帧与声音"
      busy={busy}
      onClose={onClose}
      onSubmit={() =>
        void action(async () => {
          await mutate("video-options", {
            segment_id: s.id,
            first_frame: url.trim() || (frame === "none" ? "" : frame),
            audio: audio === "true",
          });
          onClose();
        })
      }
    >
      <Field label="设定图">
        <Choice
          label="首帧设定图"
          value={frame}
          onChange={setFrame}
          options={{ none: "选择设定图", ...Object.fromEntries(images) }}
        />
      </Field>
      <Field label="自定义首帧地址（优先）">
        <Input
          type="url"
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      {r!.model.endsWith("-flash") && (
        <Field label="声音">
          <Choice
            label="声音"
            value={audio}
            onChange={setAudio}
            options={{ true: "有声", false: "无声" }}
          />
        </Field>
      )}
    </EditorDialog>
  );
}
export function Finish() {
  const creativeAction = useCreativeAction();
  const { run: r, mutate, confirm, jobs } = useStudio();
  const list =
    (plan(r!)?.planning_mode === "storyboard"
      ? r!.generation_plan?.segments
      : plan(r!)?.segments) || [];
  const defaults = () =>
    list.map((s: Json) => ({
      segment_id: s.id,
      in: 0,
      out:
        r!.media[s.id]?.find((v) => v.id === r!.media_selection[s.id])?.content
          .duration || s.duration,
    }));
  const [items, setItems] = useState<Json[]>(defaults);
  const [resolution, setResolution] = useState("720p");
  const [caption, setCaption] = useState("none");
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  const { action, busy } = useAction();
  const selection = JSON.stringify(r!.media_selection);
  useEffect(() => {
    if (!dirty) setItems(defaults());
  }, [selection]);
  const working = jobs.find(
    (j) =>
      j.run_id === r!.id &&
      j.kind === "finish" &&
      ["queued", "running"].includes(j.state),
  );
  const outputs = r!.exports.filter((output) => output.kind === "finish");
  const [outputId, setOutputId] = useState("");
  const latestId = r!.current_export?.id || outputs.at(-1)?.id || "";
  useEffect(() => setOutputId(latestId), [latestId]);
  const out =
    outputs.find((output) => output.id === outputId) ||
    r!.current_export ||
    outputs.at(-1);
  return (
    <div className="space-y-6">
      <StageMoreActions>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setItems(defaults());
            setDirty(false);
          }}
        >
          重置剪辑
        </Button>
        {out && (
          <>
            <Button size="sm" variant="outline" asChild>
              <a href={out.content.url} download>
                <Download className="size-3.5" />
                下载成片
              </a>
            </Button>
            {out.content.srt_url && (
              <Button size="sm" variant="outline" asChild>
                <a href={out.content.srt_url} download>
                  下载字幕
                </a>
              </Button>
            )}
            {out.content.master_url && (
              <Button size="sm" variant="outline" asChild>
                <a href={out.content.master_url} download>
                  下载母版
                </a>
              </Button>
            )}
          </>
        )}
      </StageMoreActions>
      <FormAssistant
        dock
        compactToolbar
        toolbarStart={
          <>
            <Choice
              label="成片版本"
              value={out?.id || "empty"}
              displayValue={
                out
                  ? `v${outputs.findIndex((output) => output.id === out.id) + 1}`
                  : "暂无"
              }
              disabled={!outputs.length}
              onChange={setOutputId}
              options={
                outputs.length
                  ? Object.fromEntries(
                      outputs.map((output, index) => [
                        output.id,
                        `v${index + 1} · ${date(output.created)}${output.id === r!.current_export?.id ? " · 当前成片" : " · 历史成片"}`,
                      ]),
                    )
                  : { empty: "暂无成片" }
              }
              className="w-16"
            />
            <StatusBadge
              value={dirty ? "draft" : r!.statuses?.finish || "empty"}
            />
          </>
        }
        toolbarEnd={
          <Button
            title="导出成片"
            aria-label="导出成片"
            disabled={
              busy || !!working || r!.statuses?.generation !== "approved"
            }
            onClick={() => {
              const submit = async () => {
                await mutate("finish", {
                  items,
                  resolution,
                  caption_mode: caption,
                });
                setDirty(false);
              };
              if (caption !== "none")
                creativeAction({
                  title: "导出字幕成片",
                  description:
                    "字幕处理会将实际音频发送到火山方舟，并按音频模型实际计费。",
                  label: "开始导出",
                  action: submit,
                });
              else
                creativeAction({
                  title: "导出成片",
                  description: "使用当前片段顺序、裁切和输出规格合成成片。",
                  label: "开始导出",
                  action: submit,
                });
            }}
          >
            {working ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            <span className="sr-only xl:not-sr-only">
              {working ? "处理中" : "导出成片"}
            </span>
          </Button>
        }
        skill="finish"
        form={{ items }}
        disabled={busy || !!working}
        onApply={(patch) => {
          setItems(patch.items);
          setDirty(true);
        }}
      />
      <Card className="shadow-none">
        <CardContent className="space-y-6 pt-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="分辨率">
              <Choice
                label="输出分辨率"
                value={resolution}
                onChange={setResolution}
                options={{ "720p": "720P", "1080p": "1080P" }}
              />
            </Field>
            <Field
              label="字幕"
              description={
                caption === "asr"
                  ? "识别实际声音，生成文字与时间。"
                  : caption === "align"
                    ? "保留方案台词，根据声音对齐时间。"
                    : undefined
              }
            >
              <Choice
                label="字幕方式"
                value={caption}
                onChange={setCaption}
                options={{
                  none: "不添加字幕",
                  asr: "语音识别",
                  align: "台词对齐",
                }}
              />
            </Field>
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              片段顺序与裁切
            </summary>
            <div className="mt-4 space-y-3">
              {items.map((item, i) => (
                <div
                  key={item.segment_id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
                >
                  <span className="min-w-24 flex-1 text-sm">
                    {list.find((s: Json) => s.id === item.segment_id)?.title}
                  </span>
                  <Input
                    className="w-20"
                    aria-label="裁切入点"
                    type="number"
                    step="0.01"
                    min={0}
                    value={item.in}
                    onChange={(e) => {
                      setItems((old) =>
                        old.map((v, index) =>
                          index === i
                            ? { ...v, in: Number(e.target.value) }
                            : v,
                        ),
                      );
                      setDirty(true);
                    }}
                  />
                  <span className="text-muted-foreground">—</span>
                  <Input
                    className="w-20"
                    aria-label="裁切出点"
                    type="number"
                    step="0.01"
                    value={item.out}
                    onChange={(e) => {
                      setItems((old) =>
                        old.map((v, index) =>
                          index === i
                            ? { ...v, out: Number(e.target.value) }
                            : v,
                        ),
                      );
                      setDirty(true);
                    }}
                  />
                  {[-1, 1].map((d) => (
                    <Button
                      key={d}
                      aria-label={d === -1 ? "上移片段" : "下移片段"}
                      variant="ghost"
                      size="icon"
                      disabled={i + d < 0 || i + d >= items.length}
                      onClick={() => {
                        setItems((old) => {
                          const n = [...old];
                          [n[i], n[i + d]] = [n[i + d], n[i]];
                          return n;
                        });
                        setDirty(true);
                      }}
                    >
                      {d === -1 ? (
                        <ArrowUp className="size-4" />
                      ) : (
                        <ArrowDown className="size-4" />
                      )}
                    </Button>
                  ))}
                </div>
              ))}
            </div>
          </details>
          {working && (
            <p className="text-sm text-muted-foreground">{working.message}</p>
          )}
        </CardContent>
      </Card>
      {out && (
        <Card className="shadow-none">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">
                成片预览{" "}
                {!r!.current_export && (
                  <Badge variant="secondary">历史版本</Badge>
                )}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <video
              className="max-h-[540px] w-full rounded-lg bg-slate-950"
              controls
              src={out.content.url}
            />
          </CardContent>
        </Card>
      )}
      {r!.exports.length > 0 && (
        <details className="rounded-lg border bg-card p-5">
          <summary className="cursor-pointer text-sm">
            导出历史 · {r!.exports.length}
          </summary>
          <div className="mt-4 divide-y">
            {[...r!.exports].reverse().map((x) => (
              <div
                key={x.id}
                className="flex items-center justify-between gap-4 py-3 text-sm"
              >
                <span className="text-muted-foreground">
                  {date(x.created)} ·{" "}
                  {x.content.resolution?.toUpperCase() || "成片"}
                </span>
                <a className="text-primary" href={x.content.url} download>
                  下载
                </a>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
