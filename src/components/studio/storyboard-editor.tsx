"use client";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { stateId } from "@/lib/asset-state";
import { assetImageSpec } from "@/lib/asset-images";
import {
  Pencil,
  Sparkles,
  ImagePlus,
  LoaderCircle,
  ArrowRight,
  ArrowLeft,
  Undo2,
} from "lucide-react";
import { useStudio, useAction, useUnsaved, api } from "./context";
import { StageToolbar, StageFooter } from "./stage-toolbar";
import { StoryboardTimeline } from "./storyboard-timeline";
import { resizeShot, insertShot, deleteShot } from "@/lib/storyboard-timeline";
import { useCreativeAction } from "./creative-action";
import { useAssistantTarget } from "./form-assistant";
import { AssistantComposer } from "./assistant-composer";
import { Choice, EditorDialog, Field } from "./forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, kindNames } from "./common";
import {
  resourceKey,
  resourceTokens,
  tagDescription,
  displayDescription,
} from "@/lib/storyboard";
import type { Json } from "@/lib/types";
import type { MentionOption } from "@/lib/assistant-mentions";
const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);
const selected = (r: Json, step: string) =>
  r.steps[step].versions.find((v: Json) => v.id === r.steps[step].selected);
const time = (seconds: number) => {
  const millis = Math.round(seconds * 1000);
  return `${String(Math.floor(millis / 3600000)).padStart(2, "0")}:${String(Math.floor(millis / 60000) % 60).padStart(2, "0")}:${String(Math.floor(millis / 1000) % 60).padStart(2, "0")}${millis % 1000 ? "." + String(millis % 1000).padStart(3, "0") : ""}`;
};
function hydrate(direction: Json, resource: Json) {
  const content = structuredClone(
    direction || { prompt: "", beats: [], segments: [] },
  );
  const resources = structuredClone(resource || { world: {}, characters: [] });
  for (const beat of content.beats) {
    beat.description = tagDescription(
      beat.description || "",
      resources.characters.filter((e: Json) => e.segment_ids.includes(beat.id)),
    );
  }
  content.planning_mode = "storyboard";
  content.segments = [];
  return { content, resources };
}
export function StoryboardEditor() {
  const creativeAction = useCreativeAction();
  const {
    run: r,
    project: p,
    episode: e,
    mutate,
    navigate,
    confirm,
    jobs,
  } = useStudio();
  const { action, busy } = useAction();
  const [content, setContent] = useState<Json>({
    prompt: "",
    beats: [],
    segments: [],
    planning_mode: "storyboard",
  });
  const [resources, setResources] = useState<Json>({
    world: {},
    characters: [],
  });
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState("");
  const [undo, setUndo] = useState<Json | null>(null);
  const [activeBeat, setActiveBeat] = useState("");
  const [editing, setEditing] = useState<Json | null>(null);
  useUnsaved(dirty);
  const dv = r ? selected(r, "director") : null,
    rv = r ? selected(r, "characters") : null;
  useEffect(() => {
    if (!dirty) {
      const next = hydrate(dv?.content, rv?.content);
      setContent(next.content);
      setResources(next.resources);
      setView(dv?.id || "");
    }
  }, [dv?.id, rv?.id]);
  const intent = useRef<{ role: string; beat_id?: string }>({
    role: "storyboard",
  });
  const openAssistant = useAssistantTarget(`storyboard:${r?.id}`, {
    title: "分镜与素材创作",
    skill: "director",
    scope: { project_id: p?.id, episode_id: e?.id, run_id: r?.id },
    snapshot: () => ({
      form: structuredClone({ content, resources }),
      context: { ...intent.current },
      disabled:
        busy ||
        !r ||
        !!r.finished_at ||
        !!e?.locked_at ||
        jobs.some(
          (j) =>
            j.run_id === r?.id &&
            ["character-image", "characters"].includes(j.kind) &&
            ["queued", "running"].includes(j.state),
        ),
    }),
    request: async (snapshot, messages) => {
      const result = await api(
        `/api/studio/projects/${p!.id}/storyboard-assist`,
        {
          episode_id: e!.id,
          run_id: r!.id,
          ...snapshot.form,
          ...snapshot.context,
          ...(snapshot.context.beat_id ? { operation: "optimize" } : {}),
          messages: messages.slice(-29).map((m) => ({
            role: m.role,
            text: (m.patch
              ? `${m.text}\n候选稿：${JSON.stringify(m.patch)}`
              : m.text
            ).slice(0, 20000),
          })),
        },
      );
      return {
        ...result,
        skill: "director",
        patch: result.patch
          ? { role: result.role, beat_id: result.beat_id, ...result.patch }
          : null,
      };
    },
    apply: ({ role, beat_id, ...patch }) =>
      applyResult({ role, beat_id, patch }),
  });
  if (!r || !p || !e) return null;
  const viewedVersion = r.steps.director.versions.find(
    (version) => version.id === (view || dv?.id),
  );
  const imagesWorking = jobs.some(
    (j) =>
      j.run_id === r.id &&
      ["character-image", "characters"].includes(j.kind) &&
      ["queued", "running"].includes(j.state),
  );
  const disabled = busy || imagesWorking || !!r.finished_at || !!e.locked_at;
  const changed = (next: Json) => {
    setContent(next);
    setDirty(true);
    setUndo(null);
  };
  const updateBeat = (bid: string, patch: Json) =>
    changed({
      ...content,
      beats: content.beats.map((b: Json) =>
        b.id === bid ? { ...b, ...patch } : b,
      ),
    });
  const available: Json[] = [
    ...resources.characters,
    ...p.assets.flatMap((a) => {
      const v = a.versions.find((v) => v.id === a.selected);
      if (!v || !["character", "scene", "prop"].includes(a.kind)) return [];
      const entry = {
        ...v,
        asset_id: a.id,
        version: v.id,
        name: a.name,
        kind: a.kind,
        segment_ids: [],
      };
      return resources.characters.some(
        (old: Json) => resourceKey(old) === resourceKey(entry),
      )
        ? []
        : [entry];
    }),
  ];
  const options: MentionOption[] = available.map((entry) => ({
    token: `@resource:${resourceKey(entry)}`,
    label: entry.name,
    kind: "resource",
    description: `${kindNames[entry.kind]} · ${entry.description}`,
    preview: {
      images: entry.images,
      description: entry.description,
      version: entry.state_name || "初始状态",
      status: entry.images?.length || entry.url ? "已绑定" : "待生成参考图",
    },
  }));
  const save = async (approve = false) => {
    const result = await mutate("save-storyboard", {
      content,
      resources,
      confirm: approve,
      base_director: r.steps.director.selected,
      base_resources: r.steps.characters.selected,
    });
    setDirty(false);
    setUndo(null);
    setView(result.director_version);
    if (approve)
      navigate(
        "episode",
        {
          project: p.id,
          episode: e.id,
          run: r.id,
          step: "generation",
        },
        { saved: true },
      );
    return result;
  };
  const analyze = (role: string, beatId?: string) => {
    intent.current = { role, ...(beatId ? { beat_id: beatId } : {}) };
    openAssistant(
      beatId
        ? "帮我优化当前镜头，保留时长和资源标签，先提供候选稿。"
        : role === "storyboard"
          ? "根据本集故事帮我生成完整分镜方案，先提供候选稿。"
          : "帮我分析分镜并匹配素材，先提供候选绑定与新建素材建议。",
    );
  };
  const applyResult = (proposal: Json) => {
    setUndo({
      label:
        proposal.role === "shot"
          ? "撤销优化"
          : proposal.role === "storyboard"
            ? "撤销生成"
            : "撤销匹配",
      description:
        proposal.role === "shot"
          ? `撤销镜头 ${content.beats.findIndex((beat: Json) => beat.id === proposal.beat_id) + 1} 的最近一次 AI 优化`
          : proposal.role === "storyboard"
            ? "撤销最近一次 AI 分镜生成，恢复生成前的分镜与资源"
            : "撤销最近一次 AI 素材匹配，恢复匹配前的绑定与描述",
      content: structuredClone(content),
      resources: structuredClone(resources),
      dirty,
    });
    if (proposal.role === "shot") {
      setContent({
        ...content,
        beats: content.beats.map((beat: Json) =>
          beat.id === proposal.beat_id
            ? { ...beat, description: proposal.patch.description }
            : beat,
        ),
      });
    } else if (proposal.role === "storyboard") {
      const locked = resources.characters
        .filter((entry: Json) => entry.manual)
        .map((entry: Json) => ({
          ...entry,
          segment_ids: proposal.patch.beats
            .filter((beat: Json) =>
              content.beats.some(
                (old: Json) =>
                  entry.segment_ids.includes(old.id) &&
                  old.start < beat.end &&
                  old.end > beat.start,
              ),
            )
            .map((beat: Json) => beat.id),
        }))
        .filter((entry: Json) => entry.segment_ids.length);
      const plain = proposal.patch.beats.map((b: Json) => ({
        ...b,
        description: tagDescription(
          b.description,
          locked.filter((entry: Json) => entry.segment_ids.includes(b.id)),
        ),
      }));
      setContent({ ...proposal.patch, beats: plain });
      setResources({ ...resources, characters: locked });
    } else {
      const next = proposal.patch;
      setResources(next);
      setContent({
        ...content,
        beats: content.beats.map((b: Json) => ({
          ...b,
          description: tagDescription(
            displayDescription(b.description, resources.characters),
            next.characters.filter((entry: Json) =>
              entry.segment_ids.includes(b.id),
            ),
          ),
        })),
      });
    }
    setDirty(true);
    if (proposal.role === "storyboard") setActiveBeat("");
  };
  const editResource = (bid: string, key?: string) => {
    const entry = available.find((a) => resourceKey(a) === key) || {
      asset_id: id(),
      version: id(),
      kind: "prop",
      name: "",
      description: "",
      images: [],
      url: "",
      segment_ids: [bid],
    };
    setEditing({
      entry: structuredClone(entry),
      originalKey: key,
      beatId: bid,
      all: false,
    });
  };
  const saveResource = (value: Json) => {
    const old = resources.characters.find(
      (entry: Json) => resourceKey(entry) === value.originalKey,
    );
    const targets = value.all && old ? old.segment_ids : [value.beatId];
    const entry = { ...value.entry, manual: true, segment_ids: targets };
    if (
      old &&
      resourceKey(old) === resourceKey(entry) &&
      !value.all &&
      old.segment_ids.some((bid: string) => !targets.includes(bid))
    )
      entry.binding_id = id();
    const key = resourceKey(entry);
    const list = resources.characters
      .map((a: Json) =>
        resourceKey(a) === value.originalKey
          ? {
              ...a,
              segment_ids: a.segment_ids.filter(
                (bid: string) => !targets.includes(bid),
              ),
            }
          : a,
      )
      .filter((a: Json) => a.segment_ids.length);
    const match = list.find((a: Json) => resourceKey(a) === key);
    if (match) {
      entry.segment_ids = [...new Set([...match.segment_ids, ...targets])];
      list.splice(list.indexOf(match), 1);
    }
    list.push(entry);
    setResources({ ...resources, characters: list });
    changed({
      ...content,
      beats: content.beats.map((beat: Json) => {
        if (!targets.includes(beat.id)) return beat;
        const token = `@resource:${key}`;
        return {
          ...beat,
          description: value.originalKey
            ? beat.description.replaceAll(
                `@resource:${value.originalKey}`,
                token,
              )
            : tagDescription(beat.description, [entry]),
        };
      }),
    });
    setEditing(null);
  };
  const generateImage = (entry: Json) =>
    creativeAction({
      title: "生成资源设定图",
      description: `为「${entry.name}」生成设定图，先保存当前分镜草稿，使用已配置的图片模型并按供应商实际计费。`,
      label: "生成设定图",
      action: async () => {
        if (dirty) await save();
        await mutate("character-image", {
          asset_id: entry.asset_id,
          entry_version: entry.version,
        });
        toast.success("已加入生成队列，完成后请到素材库审阅并采用候选");
      },
    });
  const missing = resources.characters.filter(
    (entry: Json) => !entry.images?.length && !entry.url,
  );
  const selectedBeat =
    content.beats.find((beat: Json) => beat.id === activeBeat) ||
    content.beats[0];
  const selectedIndex = content.beats.findIndex(
    (beat: Json) => beat.id === selectedBeat?.id,
  );
  const addShot = (referenceId: string, side: "before" | "after") => {
    const shotId = id();
    changed({
      ...content,
      beats: insertShot(
        content.beats,
        { id: shotId, start: 0, end: 3, description: "" },
        referenceId,
        side,
      ),
    });
    setActiveBeat(shotId);
  };
  const removeShot = (shotId: string) => {
    const next = deleteShot(content.beats, shotId);
    changed({ ...content, beats: next });
    setResources({
      ...resources,
      characters: resources.characters
        .map((entry: Json) => ({
          ...entry,
          segment_ids: entry.segment_ids.filter(
            (bid: string) => bid !== shotId,
          ),
        }))
        .filter((entry: Json) => entry.segment_ids.length),
    });
    setActiveBeat(next[Math.min(selectedIndex, next.length - 1)]?.id || "");
  };
  const generateMissing = () =>
    creativeAction({
      title: "补齐素材参考图",
      description: `保存当前草稿，为 ${missing.length} 项素材生成参考图，按图片供应商实际计费。`,
      label: "生成参考图",
      action: async () => {
        const saved = await save();
        await mutate("generate-all-settings", {
          version_id: saved.resource_version,
        });
      },
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <StageToolbar
        meta={
          <>
            <Choice
              label="分镜历史版本"
              value={view || dv?.id || "empty"}
              displayValue={viewedVersion ? `v${viewedVersion.number}` : "暂无"}
              disabled={disabled || !r.steps.director.versions.length}
              className="w-16"
              options={
                r.steps.director.versions.length
                  ? Object.fromEntries(
                      [...r.steps.director.versions]
                        .reverse()
                        .map((v) => [
                          v.id,
                          `v${v.number}${v.id === r.steps.director.selected ? " · 当前" : " · 历史"}`,
                        ]),
                    )
                  : { empty: "暂无分镜" }
              }
              onChange={(vid) => {
                const load = () => {
                  const d = r.steps.director.versions.find(
                    (v) => v.id === vid,
                  )!;
                  const resource = r.steps.characters.versions
                    .filter((v) => v.inputs.director === vid)
                    .at(-1);
                  const next = hydrate(
                    d.content,
                    resource?.content || { world: {}, characters: [] },
                  );
                  setContent(next.content);
                  setResources(next.resources);
                  setView(vid);
                  setUndo(null);
                  setActiveBeat("");
                  setDirty(vid !== r.steps.director.selected);
                };
                if (dirty)
                  confirm({
                    title: "放弃未保存的修改？",
                    description: "切换分镜版本后，未保存的修改会丢失。",
                    action: async () => load(),
                  });
                else load();
              }}
            />
            <StatusBadge
              value={
                dirty
                  ? "draft"
                  : r.statuses?.characters === "approved" &&
                      r.statuses?.director === "approved"
                    ? "approved"
                    : "draft"
              }
            />
            {undo && (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={undo.description}
                title={undo.description}
                onClick={() => {
                  setContent(undo.content);
                  setResources(undo.resources);
                  setDirty(undo.dirty);
                  setUndo(null);
                }}
              >
                <Undo2 />
                {undo.label}
              </Button>
            )}
          </>
        }
      >
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || r.statuses?.story !== "approved"}
          onClick={() => analyze("storyboard")}
        >
          <Sparkles />
          生成分镜
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !content.beats.length}
          onClick={() => analyze("resource")}
        >
          <Sparkles />
          匹配素材
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || !content.beats.length || !dirty}
          onClick={() => void action(() => save())}
        >
          保存草稿
        </Button>
        <Button
          size="sm"
          disabled={
            disabled ||
            !content.beats.length ||
            r.statuses?.story !== "approved"
          }
          onClick={() => {
            if (missing.length) generateMissing();
            else void action(() => save(true));
          }}
        >
          {busy || imagesWorking ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <ArrowRight />
          )}
          {imagesWorking
            ? "正在准备参考图"
            : missing.length
              ? `补齐 ${missing.length} 项参考图`
              : "确认并继续"}
        </Button>
      </StageToolbar>

      {!content.beats.length && (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          点击顶部「生成分镜」，或在底部时间轴添加镜头。
        </div>
      )}
      {selectedBeat && (
        <section
          role="tabpanel"
          id="storyboard-shot-editor"
          aria-label={`镜头${selectedIndex + 1}完整描述`}
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-medium">
              镜头 {String(selectedIndex + 1).padStart(2, "0")}
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              {time(selectedBeat.start)} — {time(selectedBeat.end)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || !selectedBeat.description.trim()}
                onClick={() => analyze("storyboard", selectedBeat.id)}
              >
                <Sparkles />
                优化此镜头
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="上一镜"
                title="上一镜"
                disabled={selectedIndex <= 0}
                onClick={() =>
                  setActiveBeat(content.beats[selectedIndex - 1].id)
                }
              >
                <ArrowLeft />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {selectedIndex + 1} / {content.beats.length}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="下一镜"
                title="下一镜"
                disabled={selectedIndex >= content.beats.length - 1}
                onClick={() =>
                  setActiveBeat(content.beats[selectedIndex + 1].id)
                }
              >
                <ArrowRight />
              </Button>
            </div>
          </div>
          <AssistantComposer
            documentMode
            label={`镜头${selectedIndex + 1}完整描述`}
            focusKey={selectedBeat.id}
            value={selectedBeat.description}
            onChange={(text) => {
              const keys = resourceTokens(text);
              let next = resources.characters
                .map((entry: Json) => ({
                  ...entry,
                  segment_ids:
                    resourceKey(entry) && keys.includes(resourceKey(entry))
                      ? entry.segment_ids
                      : entry.segment_ids.filter(
                          (bid: string) => bid !== selectedBeat.id,
                        ),
                }))
                .filter((entry: Json) => entry.segment_ids.length);
              for (const key of keys) {
                const found = next.find((a: Json) => resourceKey(a) === key);
                if (found) {
                  if (!found.segment_ids.includes(selectedBeat.id))
                    found.segment_ids = [...found.segment_ids, selectedBeat.id];
                } else {
                  const entry = available.find((a) => resourceKey(a) === key);
                  if (entry)
                    next.push({
                      ...entry,
                      segment_ids: [selectedBeat.id],
                      manual: true,
                    });
                }
              }
              setResources({ ...resources, characters: next });
              updateBeat(selectedBeat.id, {
                description: text,
              });
            }}
            onSend={() => {}}
            disabled={disabled}
            waiting={false}
            options={options}
            onMentionClick={(option) =>
              editResource(selectedBeat.id, option.token.slice(10))
            }
          />
        </section>
      )}
      <StageFooter>
        <StoryboardTimeline
          shots={content.beats}
          selectedId={selectedBeat?.id || ""}
          onSelect={setActiveBeat}
          disabled={disabled}
          onResize={(shotId, duration) =>
            changed({
              ...content,
              beats: resizeShot(content.beats, shotId, duration),
            })
          }
          onInsert={addShot}
          onDelete={removeShot}
        />
      </StageFooter>
      {editing && (
        <ResourceDialog
          value={editing}
          assets={p.assets}
          onClose={() => setEditing(null)}
          onSave={saveResource}
          onGenerate={() => {
            const entry = editing.entry;
            setEditing(null);
            generateImage(entry);
          }}
          canGenerate={
            !dirty &&
            resources.characters.some(
              (a: Json) => resourceKey(a) === resourceKey(editing.entry),
            )
          }
        />
      )}
    </div>
  );
}
function ResourceDialog({
  value,
  assets,
  onClose,
  onSave,
  onGenerate,
  canGenerate,
}: {
  value: Json;
  assets: Json[];
  onClose: () => void;
  onSave: (v: Json) => void;
  onGenerate: () => void;
  canGenerate: boolean;
}) {
  const { navigate, project } = useStudio();
  const [draft, setDraft] = useState(structuredClone(value));
  const entry = draft.entry;
  const choices = assets.flatMap((a) =>
    a.versions.map((v: Json) => ({ a, v })),
  );
  return (
    <EditorDialog
      title="分镜资源"
      onClose={onClose}
      onSubmit={() => onSave(draft)}
    >
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          navigate("assets", {
            project: project!.id,
            asset: entry.asset_id,
            state: stateId(entry),
          })
        }
      >
        在素材库审阅与采用候选
      </Button>
      <Field label="绑定已有素材">
        <Choice
          label="绑定素材版本"
          value={`${entry.asset_id}:${entry.version}`}
          options={{
            [`${entry.asset_id}:${entry.version}`]: `${entry.name || "新资源"} · 当前版本`,
            ...Object.fromEntries(
              choices.map(({ a, v }) => [
                `${a.id}:${v.id}`,
                `${a.name} · ${v.state_name || "初始状态"} · v${v.number}`,
              ]),
            ),
          }}
          onChange={(key) => {
            const choice = choices.find(
              ({ a, v }) => `${a.id}:${v.id}` === key,
            );
            if (choice)
              setDraft({
                ...draft,
                entry: {
                  ...choice.v,
                  asset_id: choice.a.id,
                  version: choice.v.id,
                  name: choice.a.name,
                  kind: choice.a.kind,
                  segment_ids: entry.segment_ids,
                  manual: true,
                },
              });
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="名称">
          <Input
            aria-label="分镜资源名称"
            required
            value={entry.name}
            onChange={(ev) =>
              setDraft({ ...draft, entry: { ...entry, name: ev.target.value } })
            }
          />
        </Field>
        <Field label="类型">
          <Choice
            label="分镜资源类型"
            value={entry.kind}
            options={{ character: "人物", scene: "场景", prop: "道具" }}
            onChange={(kind) =>
              setDraft({ ...draft, entry: { ...entry, kind } })
            }
          />
        </Field>
      </div>
      <Field label="资源描述">
        <Textarea
          aria-label="分镜资源描述"
          required
          rows={5}
          value={entry.description}
          onChange={(ev) =>
            setDraft({
              ...draft,
              entry: {
                ...entry,
                version:
                  entry.description === value.entry.description
                    ? id()
                    : entry.version,
                description: ev.target.value,
                reference_images: value.entry.images || [],
                images: [],
                url: "",
              },
            })
          }
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        {assetImageSpec(entry.kind || "character")?.summary}
      </p>
      {!!entry.images?.length && (
        <>
          <div className="flex gap-2">
            {entry.images.map((image: Json) => (
              <img
                key={image.file || image.url}
                src={image.url}
                alt={entry.name}
                className="max-h-80 min-w-0 flex-1 rounded border object-contain"
              />
            ))}
          </div>
          <Field label="传入视频模型的参考视图">
            <Choice
              label="参考视图"
              value={
                entry.reference_image ||
                entry.images[0].file ||
                entry.images[0].url
              }
              options={Object.fromEntries(
                entry.images.map((image: Json) => [
                  image.file || image.url,
                  assetImageSpec(entry.kind || "character")?.pose === image.pose
                    ? assetImageSpec(entry.kind || "character")!.label
                    : image.pose || "参考图",
                ]),
              )}
              onChange={(reference_image) =>
                setDraft({ ...draft, entry: { ...entry, reference_image } })
              }
            />
          </Field>
        </>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.all}
          onChange={(ev) => setDraft({ ...draft, all: ev.target.checked })}
        />
        同步到本集所有引用此素材的分镜
      </label>
      <p className="text-xs text-muted-foreground">
        应用后锁定这项手动绑定，素材模型不会自动替换。
      </p>
      {canGenerate &&
        JSON.stringify(draft.entry) === JSON.stringify(value.entry) && (
          <Button type="button" variant="outline" onClick={onGenerate}>
            <ImagePlus />
            重新生成设定图
          </Button>
        )}
    </EditorDialog>
  );
}
