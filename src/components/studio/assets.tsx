"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Plus,
  Search,
  X,
  ArrowLeft,
  ImageIcon,
  Upload,
  Maximize2,
  LoaderCircle,
  Check,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  assetDefinition,
  adoptedAssetVersion,
  assetUsages,
  searchAssets,
} from "@/lib/asset-library";
import { assetStates, stateId, stateName } from "@/lib/asset-state";
import { assetImageSpec } from "@/lib/asset-images";
import { cn } from "@/lib/utils";
import type { Asset, Json } from "@/lib/types";
import { useStudio, useAction, useUnsaved } from "./context";
import { Heading, Empty, date, kindNames } from "./common";
import { CreateDialog, Choice, Field } from "./forms";
import { useCreativeAction } from "./creative-action";
import { FormAssistant } from "./form-assistant";

const imageUrl = (version?: Json) =>
  version?.images?.[0]?.url || version?.url || "";
const inProgress = (job: Json) => ["queued", "running"].includes(job.state);

export function Assets() {
  const { project, jobs, dirty, setDirty, confirm, route } = useStudio();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [active, setActive] = useState<string | null>(
    project?.assets.some((a) => a.id === route.asset)
      ? route.asset!
      : project?.assets[0]?.id || null,
  );
  const [mobileOpen, setMobileOpen] = useState(!!route.asset);
  const [create, setCreate] = useState(false);
  if (!project) return null;
  const list = searchAssets(project.assets, search, category);
  const asset = project.assets.find((a) => a.id === active) || list[0];
  const select = (id: string | null) => {
    const go = () => {
      setDirty(false);
      if (id) setActive(id);
      setMobileOpen(!!id);
    };
    if (dirty)
      confirm({
        title: "放弃未保存的设定？",
        description: "切换素材后，未保存的编辑将丢失。",
        label: "切换",
        action: go,
      });
    else go();
  };
  return (
    <>
      <Heading
        title="素材库"
        description="管理参考图与设定，在采用后选择需要更新的分镜。"
        actions={
          <Button onClick={() => setCreate(true)}>
            <Plus />
            新增素材
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="素材分类"
        >
          {Object.entries({ all: "全部", ...kindNames }).map(([kind, name]) => (
            <Button
              key={kind}
              size="sm"
              variant={category === kind ? "secondary" : "ghost"}
              aria-pressed={category === kind}
              onClick={() => setCategory(kind)}
            >
              {name}
              <span className="text-xs text-muted-foreground">
                {kind === "all"
                  ? project.assets.length
                  : project.assets.filter((a) => a.kind === kind).length}
              </span>
            </Button>
          ))}
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9 pr-9"
            aria-label="搜索素材"
            placeholder="搜索名称、描述、状态或标签"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <Button
              className="absolute right-0 top-0"
              size="icon"
              variant="ghost"
              aria-label="清除素材搜索"
              onClick={() => setSearch("")}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="mb-3 text-xs text-muted-foreground" role="status">
        {search.trim()
          ? `找到 ${list.length} 个匹配素材`
          : `${list.length} 个素材`}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.95fr)]">
        <section
          className={cn(mobileOpen && "hidden lg:block")}
          aria-label="素材列表"
        >
          {list.length ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {list.map((item) => {
                const initial =
                  item.versions.find((v) => v.id === item.selected) ||
                  item.versions[0];
                const adopted = adoptedAssetVersion(
                  item,
                  stateId(initial || {}),
                );
                const photo = ["character", "scene", "prop", "style"].includes(
                  item.kind,
                )
                  ? imageUrl(adopted)
                  : "";
                const job = jobs.find(
                  (j) =>
                    j.segment_id === item.id &&
                    ["asset-image", "character-image"].includes(j.kind) &&
                    inProgress(j),
                );
                const candidates = item.versions.filter(
                  (v) =>
                    v.images?.length &&
                    v.number >
                      (adoptedAssetVersion(item, stateId(v))?.number || 0),
                );
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`查看素材 ${item.name}`}
                    aria-pressed={asset?.id === item.id}
                    onClick={() => select(item.id)}
                    className={cn(
                      "overflow-hidden rounded-xl border bg-card text-left transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      asset?.id === item.id &&
                        "border-primary ring-1 ring-primary/20",
                    )}
                  >
                    <div className="relative flex aspect-square items-center justify-center bg-muted/50">
                      {photo ? (
                        <img
                          src={photo}
                          alt={item.name}
                          className="size-full object-contain"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                          <ImageIcon className="size-7" />
                          {adopted?.url
                            ? "外部参考素材"
                            : candidates.length
                              ? "有候选待采用"
                              : "尚无采用图"}
                        </div>
                      )}
                      {job && (
                        <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-background/95 px-2 py-1 text-xs">
                          <LoaderCircle className="size-3 animate-spin" />
                          生成中
                        </span>
                      )}
                    </div>
                    <div className="space-y-2 p-3">
                      <p
                        className="truncate text-sm font-medium"
                        title={item.name}
                      >
                        {item.name}
                      </p>
                      <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
                        <span>
                          {kindNames[item.kind]} · {assetStates(item).length}{" "}
                          个状态
                        </span>
                        {candidates.length > 0 && (
                          <span className="text-primary">
                            {candidates.length} 个候选
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty>
              {search.trim()
                ? "未找到匹配的素材，试试其他关键词。"
                : "这个分类还没有素材。"}
            </Empty>
          )}
        </section>
        {asset ? (
          <section
            className={cn(
              "min-w-0 rounded-xl border bg-card lg:sticky lg:top-20",
              !mobileOpen && "hidden lg:block",
            )}
            aria-label="素材详情"
          >
            <div className="border-b px-4 py-2 lg:hidden">
              <Button size="sm" variant="ghost" onClick={() => select(null)}>
                <ArrowLeft className="size-4" />
                返回素材列表
              </Button>
            </div>
            <AssetInspector
              key={asset.id}
              asset={asset}
              initialState={route.asset === asset.id ? route.state : undefined}
            />
          </section>
        ) : (
          <div className="hidden rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground lg:block">
            选择素材查看详情，或先新增一项素材。
          </div>
        )}
      </div>
      {create && (
        <CreateDialog
          type="asset"
          initial={category === "all" ? undefined : { kind: category }}
          onClose={() => setCreate(false)}
          onCreated={(data) => {
            setActive(data.asset_id);
            setMobileOpen(true);
            setSearch("");
          }}
        />
      )}
    </>
  );
}

function AssetInspector({
  asset,
  initialState,
}: {
  asset: Asset;
  initialState?: string;
}) {
  const { dirty, setDirty, confirm } = useStudio();
  const [state, setState] = useState(
    (initialState && assetStates(asset).some((v) => stateId(v) === initialState)
      ? initialState
      : undefined) ||
      stateId(asset.versions.find((v) => v.id === asset.selected) || {}),
  );
  const states = assetStates(asset);
  const switchState = (next: string) => {
    const go = () => {
      setDirty(false);
      setState(next);
    };
    if (dirty)
      confirm({
        title: "放弃未保存的设定？",
        description: "切换剧情状态后，未保存的编辑将丢失。",
        action: go,
      });
    else go();
  };
  return (
    <AssetDetail
      key={state}
      asset={asset}
      state={state}
      states={states}
      onState={switchState}
    />
  );
}

function AssetDetail({
  asset,
  state,
  states,
  onState,
}: {
  asset: Asset;
  state: string;
  states: Json[];
  onState: (value: string) => void;
}) {
  const creativeAction = useCreativeAction();
  const { project, jobs, mutate, refresh, confirm, navigate } = useStudio();
  const definition = assetDefinition(asset, state)!;
  const adopted = adoptedAssetVersion(asset, state);
  const versions = asset.versions.filter((v) => stateId(v) === state);
  const images = versions.filter((v) => v.images?.length || v.url);
  const candidates = images.filter((v) => v.number > (adopted?.number || 0));
  const [tab, setTab] = useState("preview");
  const [viewId, setViewId] = useState(
    adopted?.id || images.at(-1)?.id || definition.id,
  );
  const preview =
    versions.find((v) => v.id === viewId) || adopted || definition;
  const [compare, setCompare] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [note, setNote] = useState("");
  const [form, setForm] = useState({
    name: asset.name,
    description: definition.description || "",
    url: definition.url || "",
  });
  const [formBase, setFormBase] = useState(definition.id);
  const [edited, setEdited] = useState(false);
  const dirty =
    edited &&
    (form.name !== asset.name ||
      form.description !== definition.description ||
      form.url !== (definition.url || ""));
  useUnsaved(dirty);
  const { busy, action } = useAction();
  const [waitingJob, setWaitingJob] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ file: File; url: string } | null>(
    null,
  );
  const input = useRef<HTMLInputElement>(null);
  const [newState, setNewState] = useState(false);
  const [stateTitle, setStateTitle] = useState("");
  const [stateDescription, setStateDescription] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const job = jobs.find(
    (j) =>
      ["asset-image", "character-image"].includes(j.kind) &&
      j.segment_id === asset.id &&
      (j.state_id || "default") === state,
  );
  const generating = !!job && inProgress(job);
  const spec = assetImageSpec(asset.kind);
  const usages = assetUsages(project!, asset.id, state);
  const editableUsages = usages.filter(
    (u) => !u.locked && u.version_id !== adopted?.id,
  );
  const isImageAsset = ["character", "scene", "prop", "style"].includes(
    asset.kind,
  );
  const photo = isImageAsset ? imageUrl(preview) : "";
  const hasReference = !!(preview.images?.length || preview.url);
  const oldDefinition =
    !!imageUrl(preview) &&
    (preview.definition_id || preview.id) !== definition.id;
  useEffect(() => {
    if (!edited) {
      setForm({
        name: asset.name,
        description: definition.description || "",
        url: definition.url || "",
      });
      setFormBase(definition.id);
    }
  }, [definition.id, asset.name, edited]);
  useEffect(() => {
    if (!waitingJob) return;
    const completed = jobs.find((j) => j.id === waitingJob);
    if (
      completed?.state === "done" &&
      completed.asset_version &&
      versions.some((v) => v.id === completed.asset_version)
    ) {
      setViewId(completed.asset_version);
      setTab("preview");
      setWaitingJob(null);
      toast.success("候选图已生成，请检查后采用");
    } else if (completed?.state === "failed") setWaitingJob(null);
  }, [waitingJob, jobs, versions]);
  useEffect(
    () => () => {
      if (upload) URL.revokeObjectURL(upload.url);
    },
    [upload],
  );
  const save = () =>
    void action(async () => {
      const result = await mutate("asset", {
        asset_id: asset.id,
        kind: asset.kind,
        base_version: formBase,
        ...form,
      });
      setFormBase(result.version_id);
      setEdited(false);
      toast.success("设定已保存，当前采用图保持不变");
    });
  const generate = () => {
    if (dirty) {
      setTab("setting");
      toast.error("请先保存设定，再生成候选图");
      return;
    }
    creativeAction({
      title: "生成素材候选图",
      description: `为「${asset.name}」生成新候选。${note ? `本次调整：${note}。` : ""}使用已配置的图片模型并按供应商实际计费；结果需审阅后采用。`,
      label: "开始生成",
      action: async () => {
        const result = await mutate("asset-image", {
          asset_id: asset.id,
          version_id: definition.id,
          note,
        });
        setWaitingJob(result.job_id);
        toast.success("已加入生成队列，完成后作为候选供你审阅");
      },
    });
  };
  const adopt = (version: Json) =>
    void action(async () => {
      await mutate("asset-adopt", {
        asset_id: asset.id,
        version_id: version.id,
        expected_adopted: adopted?.id || null,
      });
      setViewId(version.id);
      setCompare(false);
      toast.success("已采用；已有分镜引用保持原版本");
    });
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      !file.size ||
      file.size > 20 * 1024 * 1024
    ) {
      toast.error("请选择20MB以内的PNG或JPEG图片");
      return;
    }
    setUpload({ file, url: URL.createObjectURL(file) });
  };
  const saveUpload = () =>
    void action(async () => {
      if (!upload) return;
      const formData = new FormData();
      formData.set("image", upload.file);
      formData.set("version_id", definition.id);
      const result = await fetch(
        `/api/studio/projects/${project!.id}/assets/${asset.id}/images`,
        { method: "POST", body: formData },
      );
      const data = await result.json();
      if (!result.ok) throw Error(data.error || "上传失败");
      await refresh();
      setUpload(null);
      setViewId(data.version_id);
      setTab("preview");
      toast.success("图片已上传为候选，请检查后采用");
    });
  const update = () => {
    const targets = editableUsages.filter((u) => checked.includes(u.key));
    if (!targets.length || !adopted) return;
    confirm({
      title: `更新 ${targets.length} 处素材引用？`,
      description: `${targets.map((u) => `${u.episode_title} / ${u.run_name}（${u.shots.join("、")}）`).join("；")}。更新后需重新确认资源并检查受影响视频，已结束方案保持原版本。`,
      label: "更新引用",
      action: async () => {
        await mutate("asset-update-references", {
          asset_id: asset.id,
          version_id: adopted.id,
          targets: targets.map(
            ({ episode_id, run_id, settings_id, version_id }) => ({
              episode_id,
              run_id,
              settings_id,
              version_id,
            }),
          ),
        });
        setChecked([]);
        toast.success("引用已更新，请返回分镜与资源复核");
      },
    });
  };
  const view = (version: Json) => {
    setViewId(version.id);
    setTab("preview");
    setCompare(false);
  };
  return (
    <div className="space-y-4 p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold">{asset.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{kindNames[asset.kind]}</Badge>
            <span className="text-xs text-muted-foreground">
              {stateName(definition)}
            </span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={dirty || busy}
          onClick={() => {
            setStateTitle("");
            setStateDescription(definition.description);
            setNewState(true);
          }}
        >
          <Plus className="size-3.5" />
          新增状态
        </Button>
      </div>
      {states.length > 1 && (
        <Choice
          label="素材剧情状态"
          value={state}
          options={Object.fromEntries(
            states.map((v) => [stateId(v), stateName(v)]),
          )}
          onChange={onState}
        />
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          variant="line"
          className="grid w-full grid-cols-2 gap-y-1 group-data-[orientation=horizontal]/tabs:h-auto sm:flex"
        >
          <TabsTrigger value="preview">预览与生成</TabsTrigger>
          <TabsTrigger value="setting">设定{dirty && " ·"}</TabsTrigger>
          <TabsTrigger value="versions">
            版本{candidates.length > 0 && ` · ${candidates.length}`}
          </TabsTrigger>
          <TabsTrigger value="usage">使用位置</TabsTrigger>
        </TabsList>
        <TabsContent value="preview" className="space-y-4 pt-3">
          {compare && adopted && adopted.id !== preview.id ? (
            <div className="grid grid-cols-2 gap-3">
              <Preview
                image={imageUrl(adopted)}
                label="当前采用"
                name={asset.name}
              />
              <Preview
                image={photo}
                label={`正在预览 · v${preview.number}`}
                name={asset.name}
              />
            </div>
          ) : (
            <Preview
              image={photo}
              label={
                preview.id === adopted?.id
                  ? `当前采用 · v${preview.number}`
                  : photo
                    ? `候选预览 · v${preview.number}`
                    : "尚无设定图"
              }
              name={asset.name}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {photo
                ? date(preview.created)
                : "完善设定后生成，或上传自己的图片"}
            </span>
            <div className="flex gap-2">
              {adopted && preview.id !== adopted.id && photo && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={compare}
                  onClick={() => setCompare(!compare)}
                >
                  <Layers className="size-3.5" />
                  {compare ? "结束对比" : "对比当前图"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={!photo}
                onClick={() => setZoom(true)}
              >
                <Maximize2 className="size-3.5" />
                放大
              </Button>
            </div>
          </div>
          {preview.url && !isImageAsset && (
            <Button asChild variant="outline">
              <a href={preview.url} target="_blank" rel="noreferrer">
                打开参考素材
                <ArrowUpRight className="size-4" />
              </a>
            </Button>
          )}
          {oldDefinition && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              这张图片依据旧设定生成。新的文字设定已保存，可生成新候选。
            </p>
          )}
          {hasReference && preview.id !== adopted?.id && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                预览不会改变当前采用图。
              </p>
              <Button size="sm" disabled={busy} onClick={() => adopt(preview)}>
                <Check className="size-3.5" />
                采用此版本
              </Button>
            </div>
          )}
          {candidates.length > 0 && preview.id === adopted?.id && (
            <Button
              className="w-full justify-between"
              variant="outline"
              onClick={() => setTab("versions")}
            >
              {candidates.length} 个候选可审阅
              <ArrowUpRight className="size-4" />
            </Button>
          )}
          {spec && (
            <div className="space-y-3 border-t pt-4">
              <Field label="这次想怎么调整？">
                <Textarea
                  rows={2}
                  maxLength={2000}
                  aria-label="本次生图调整要求"
                  placeholder="例如：保持外形，补全侧面和背面的结构"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
              <p className="text-xs text-muted-foreground">
                {spec.summary} 调整要求仅用于本次出图，不修改设定。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || generating || dirty}
                  onClick={generate}
                >
                  {generating ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ImageIcon className="size-4" />
                  )}
                  {generating ? "正在生成候选…" : "生成新候选"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || dirty}
                  onClick={() => input.current?.click()}
                >
                  <Upload className="size-4" />
                  上传图片
                </Button>
                <input
                  ref={input}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  aria-label="上传素材图片"
                  onChange={chooseFile}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                使用已配置的生图模型，按供应商计费；生成结果不会自动采用。
              </p>
            </div>
          )}
          {job && (
            <div
              className="rounded-lg bg-muted px-3 py-2 text-xs"
              role="status"
            >
              {job.state === "done"
                ? "候选图已生成，请在版本中预览并决定是否采用。"
                : job.message}
              {job.state === "failed" && (
                <span className="mt-1 block text-muted-foreground">
                  如果提交结果不确定，请先核对供应商控制台，再决定是否重新生成。
                </span>
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="setting" className="space-y-4 pt-3">
          <Field label="素材名称">
            <Input
              aria-label="素材名称"
              maxLength={100}
              value={form.name}
              onChange={(event) => {
                setEdited(true);
                setForm({ ...form, name: event.target.value });
              }}
            />
          </Field>
          <Field label="外形与材质设定">
            <Textarea
              aria-label="素材设定描述"
              rows={7}
              maxLength={15000}
              value={form.description}
              onChange={(event) => {
                setEdited(true);
                setForm({ ...form, description: event.target.value });
              }}
            />
          </Field>
          <Field label="参考地址（可选）">
            <Input
              type="url"
              aria-label="素材参考地址"
              placeholder="https://"
              value={form.url}
              onChange={(event) => {
                setEdited(true);
                setForm({ ...form, url: event.target.value });
              }}
            />
          </Field>
          <FormAssistant
            skill="asset"
            form={form}
            context={{
              asset_id: asset.id,
              kind: asset.kind,
              state_name: stateName(definition),
            }}
            disabled={busy}
            onApply={(patch) => {
              setEdited(true);
              setForm((old) => ({ ...old, ...patch }));
            }}
            label="AI 完善设定"
          />
          <p className="text-xs text-muted-foreground">
            保存为当前状态的新设定版本，当前采用图和分镜引用不会自动改变。
          </p>
          <div className="flex gap-2">
            <Button
              disabled={
                busy || !dirty || !form.name.trim() || !form.description.trim()
              }
              onClick={save}
            >
              保存设定
            </Button>
            {dirty && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEdited(false);
                  setForm({
                    name: asset.name,
                    description: definition.description || "",
                    url: definition.url || "",
                  });
                }}
              >
                放弃修改
              </Button>
            )}
          </div>
        </TabsContent>
        <TabsContent value="versions" className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">
            所有设定和图片均保留。查看历史版本不会更改当前采用图。
          </p>
          {[...versions].reverse().map((v) => (
            <div
              className="flex items-center gap-3 rounded-lg border p-3"
              key={v.id}
            >
              <div className="flex size-16 shrink-0 items-center justify-center rounded bg-muted">
                {isImageAsset && imageUrl(v) ? (
                  <img
                    className="size-full object-contain"
                    src={imageUrl(v)}
                    alt={`${asset.name}版本${v.number}`}
                  />
                ) : (
                  <ImageIcon className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  v{v.number} ·{" "}
                  {v.id === adopted?.id
                    ? "当前采用"
                    : v.images?.length
                      ? v.number > (adopted?.number || 0)
                        ? "图片候选"
                        : "历史图片"
                      : v.url
                        ? "参考素材"
                        : "文字设定"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {date(v.created)}
                  {v.source === "upload" && " · 上传"}
                </p>
                {v.generation_note && (
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={v.generation_note}
                  >
                    {v.generation_note}
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => view(v)}>
                预览
              </Button>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="usage" className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">
            同一方案内共享该状态的素材绑定，按方案选择更新范围。
          </p>
          {usages.length === 0 ? (
            <Empty>这个状态尚未用于分镜。</Empty>
          ) : (
            usages.map((usage) => (
              <div key={usage.key} className="rounded-lg border p-3">
                <label className="flex items-start gap-3">
                  <input
                    className="mt-1"
                    type="checkbox"
                    aria-label={`更新${usage.episode_title} ${usage.run_name}的素材引用`}
                    checked={checked.includes(usage.key)}
                    disabled={
                      !adopted ||
                      usage.locked ||
                      usage.version_id === adopted.id
                    }
                    onChange={(event) =>
                      setChecked((old) =>
                        event.target.checked
                          ? [...old, usage.key]
                          : old.filter((key) => key !== usage.key),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      {usage.episode_title} · {usage.run_name}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {usage.shots.join("、")} ·{" "}
                      {usage.locked
                        ? "只读，保留原版本"
                        : usage.version_id === adopted?.id
                          ? "已使用当前采用版本"
                          : "可更新到当前采用版本"}
                    </span>
                  </span>
                </label>
                <Button
                  size="sm"
                  variant="link"
                  className="ml-5 px-0"
                  onClick={() =>
                    navigate("episode", {
                      project: project!.id,
                      episode: usage.episode_id,
                      run: usage.run_id,
                      step: "director",
                    })
                  }
                >
                  查看分镜
                  <ArrowUpRight className="size-3.5" />
                </Button>
              </div>
            ))
          )}
          <Button
            disabled={
              busy ||
              !adopted ||
              !checked.some((key) => editableUsages.some((u) => u.key === key))
            }
            onClick={update}
          >
            更新所选引用
          </Button>
          <p className="text-xs text-muted-foreground">
            更新前会确认影响范围；已结束或锁定的方案不更新。
          </p>
        </TabsContent>
      </Tabs>
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {asset.name} · v{preview.number}
            </DialogTitle>
            <DialogDescription>图片预览不会改变采用状态。</DialogDescription>
          </DialogHeader>
          <img
            className="max-h-[75dvh] w-full object-contain"
            src={photo || undefined}
            alt={asset.name}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!upload}
        onOpenChange={(open) => {
          if (!open && !busy) setUpload(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>上传图片预览</DialogTitle>
            <DialogDescription>
              图片会保存为新候选，之后可在素材详情中采用。
            </DialogDescription>
          </DialogHeader>
          {upload && (
            <img
              className="max-h-[55dvh] w-full object-contain"
              src={upload.url}
              alt="准备上传的素材"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setUpload(null)}
            >
              取消
            </Button>
            <Button disabled={busy} onClick={saveUpload}>
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              保存为候选
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={newState} onOpenChange={setNewState}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增剧情状态</DialogTitle>
            <DialogDescription>
              继承「{stateName(definition)}
              」的外形作为参考，单独描述这个状态的差异。
            </DialogDescription>
          </DialogHeader>
          <Field label="状态名称">
            <Input
              aria-label="新状态名称"
              maxLength={80}
              placeholder="例如：穿雨衣、受损"
              value={stateTitle}
              onChange={(event) => setStateTitle(event.target.value)}
            />
          </Field>
          <Field label="这个状态的设定">
            <Textarea
              aria-label="新状态设定"
              rows={6}
              maxLength={15000}
              value={stateDescription}
              onChange={(event) => setStateDescription(event.target.value)}
            />
          </Field>
          <Button
            disabled={busy || !stateTitle.trim() || !stateDescription.trim()}
            onClick={() =>
              void action(async () => {
                const result = await mutate("asset-state", {
                  asset_id: asset.id,
                  version_id: definition.id,
                  state_name: stateTitle,
                  description: stateDescription,
                });
                setNewState(false);
                onState(result.state_id);
                toast.success("新状态已创建，可生成或上传参考图");
              })
            }
          >
            创建状态草稿
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Preview({
  image,
  label,
  name,
}: {
  image: string;
  label: string;
  name: string;
}) {
  return (
    <figure className="relative flex aspect-square max-h-[400px] items-center justify-center overflow-hidden rounded-lg bg-muted/50">
      {image ? (
        <img src={image} alt={name} className="size-full object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <ImageIcon className="size-8" />
          {label}
        </div>
      )}
      <figcaption className="absolute bottom-2 left-2 rounded bg-background/95 px-2 py-1 text-xs">
        {label}
      </figcaption>
    </figure>
  );
}
