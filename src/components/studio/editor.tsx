"use client";
import { stateFields, resourceVersionLabel } from "@/lib/asset-state";
import { useState, useEffect } from "react";
import { Plus, Trash2, Check, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStudio, useAction, useUnsaved } from "./context";
import { StageToolbar, StageMoreActions } from "./stage-toolbar";
import { FormAssistant } from "./form-assistant";
import { Choice, Field, EditorDialog } from "./forms";
import { date, StatusBadge, Empty } from "./common";
import {
  TITLES,
  STEPS,
  type Version,
  type Json,
  type Asset,
} from "@/lib/types";
export function useVersion(step: string) {
  const { run: r, mutate, navigate, project, episode, route } = useStudio();
  const requested = route.version;
  const versions = (r?.steps[step]?.versions || []).filter(
    (v) => step !== "director" || Array.isArray(v.content.segments),
  );
  const [id, setId] = useState(requested || versions.at(-1)?.id || "");
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  const { busy, action } = useAction();
  useEffect(() => {
    if (!dirty) setId(requested || versions.at(-1)?.id || "");
  }, [r?.id, versions.length, step, requested]);
  const v = versions.find((v) => v.id === id) || versions.at(-1);
  const current = r?.steps[step]?.selected;
  const save = (content: Json) =>
    action(async () => {
      const result = await mutate("save-step", { step, content, adopt: false });
      setDirty(false);
      setId(result.version_id);
      toast.success("草稿已保存");
    });
  const adopt = () =>
    action(async () => {
      await mutate("adopt-step", { step, version_id: v?.id });
      toast.success("已采用此版本");
    });
  const approve = () =>
    action(async () => {
      await mutate("approve-step", { step });
      setDirty(false);
      const next = STEPS[STEPS.indexOf(step as any) + 1];
      if (next)
        navigate("episode", {
          project: project!.id,
          episode: episode!.id,
          run: r!.id,
          step: next,
        });
    });
  return {
    versions,
    id: setId,
    v,
    current,
    dirty,
    setDirty,
    busy,
    save,
    adopt,
    approve,
    action,
  };
}
export function VersionBar({
  step,
  editor,
  compact = false,
}: {
  step: string;
  editor: ReturnType<typeof useVersion>;
  compact?: boolean;
}) {
  const { run: r, confirm } = useStudio();
  const { v, current, versions } = editor;
  return (
    <div
      className={
        compact
          ? "flex shrink-0 items-center gap-2"
          : "flex flex-wrap items-center gap-3 border-b bg-muted/20 px-5 py-3"
      }
    >
      <span className={compact ? "sr-only" : "text-xs text-muted-foreground"}>
        版本
      </span>
      <div className={compact ? "w-14 xl:w-20" : "min-w-0 flex-1"}>
        <Choice
          label={`${TITLES[step]}版本`}
          displayValue={compact ? (v ? `v${v.number}` : "—") : undefined}
          value={v?.id || "empty"}
          disabled={!v}
          onChange={(id) => {
            const change = () => {
              editor.setDirty(false);
              editor.id(id);
            };
            if (editor.dirty)
              confirm({
                title: "放弃未保存的修改？",
                description: "切换版本后，当前编辑将丢失。",
                action: change,
              });
            else change();
          }}
          options={
            v
              ? Object.fromEntries(
                  [...versions]
                    .reverse()
                    .map((x) => [
                      x.id,
                      compact
                        ? `v${x.number} · ${x.id === current && r?.statuses?.[step] === "approved" ? "当前确认" : x.id === current && r?.statuses?.[step] === "stale" ? "需重新确认" : x.approved ? "历史确认稿" : "草稿"}`
                        : `v${x.number} · ${date(x.created)}${x.id === current ? " · 当前采用" : ""}`,
                    ]),
                )
              : { empty: "暂无版本" }
          }
        />
      </div>
      {!compact && (
        <StatusBadge
          value={
            v?.id === current
              ? r?.statuses?.[step] || "draft"
              : v
                ? "draft"
                : "empty"
          }
        />
      )}
    </div>
  );
}
export function VersionActions({
  editor,
  content,
  compact = false,
}: {
  editor: ReturnType<typeof useVersion>;
  content?: Json;
  compact?: boolean;
}) {
  const { run: r } = useStudio();
  return (
    <div
      className={
        compact
          ? "flex flex-nowrap items-center gap-1"
          : "flex flex-wrap justify-end gap-2"
      }
    >
      {content && (
        <Button
          size={compact ? "sm" : "default"}
          title="保存草稿"
          className={compact ? "px-2 xl:px-3" : undefined}
          variant="outline"
          disabled={editor.busy}
          onClick={() => void editor.save(content)}
        >
          <Save className="size-4" />
          <span className={compact ? "sr-only xl:not-sr-only" : undefined}>
            保存草稿
          </span>
        </Button>
      )}
      {editor.v && editor.v.id !== editor.current && (
        <Button
          size={compact ? "sm" : "default"}
          title="采用此稿"
          className={compact ? "px-2 xl:px-3" : undefined}
          disabled={editor.busy || !editor.v || editor.dirty}
          onClick={() => void editor.adopt()}
        >
          {compact && <Check className="size-4 xl:hidden" />}
          <span className={compact ? "sr-only xl:not-sr-only" : undefined}>
            采用此稿
          </span>
        </Button>
      )}
      <Button
        title={editor.v?.approved ? "已确认" : "确认并继续"}
        className={compact ? "px-2 xl:px-3" : undefined}
        size={compact ? "sm" : "default"}
        disabled={
          editor.busy ||
          !editor.v ||
          editor.v.id !== editor.current ||
          editor.dirty ||
          !!editor.v.approved
        }
        onClick={() => void editor.approve()}
      >
        <Check className="size-4" />
        <span className={compact ? "sr-only xl:not-sr-only" : undefined}>
          {editor.v?.approved ? "已确认" : "确认并继续"}
        </span>
      </Button>
    </div>
  );
}
export { StorySelection as StoryEditor } from "./stories";

export function PlanEditor() {
  const editor = useVersion("director");
  const { project: p, run: r, mutate, episode } = useStudio();
  const [content, setContent] = useState<Json>(
    structuredClone(
      editor.v?.content || { prompt: "", beats: [], segments: [] },
    ),
  );
  const [refs, setRefs] = useState<string | null>(null);
  useEffect(
    () =>
      setContent(
        structuredClone(
          editor.v?.content || { prompt: "", beats: [], segments: [] },
        ),
      ),
    [editor.v?.id],
  );
  const change = (fn: (c: Json) => void) => {
    setContent((old) => {
      const next = structuredClone(old);
      fn(next);
      return next;
    });
    editor.setDirty(true);
  };
  const makeId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  return (
    <div className="space-y-6">
      <StageMoreActions>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            change((c) => {
              const end = c.beats.at(-1)?.end || 0;
              c.beats.push({
                id: makeId(),
                start: end,
                end: end + 5,
                description: "",
                camera: "",
                dialogue: "",
              });
            })
          }
        >
          <Plus />
          添加节拍
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={!editor.v || editor.dirty || editor.busy}
          onClick={() =>
            void editor.action(async () => {
              const result = await mutate("aggregate-plan", {
                version_id: editor.v?.id,
              });
              editor.id(result.version_id);
            })
          }
        >
          聚合片段
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            change((c) => {
              const start = c.segments.at(-1)?.end || 0,
                end = Math.min(c.beats.at(-1)?.end || start + 4, start + 30);
              c.segments.push({
                id: makeId(),
                title: `片段 ${c.segments.length + 1}`,
                start,
                end,
                duration: end - start,
                prompt: "",
                beat_ids: c.beats
                  .filter((b: Json) => b.start < end && b.end > start)
                  .map((b: Json) => b.id),
                references: [],
                depends_on: [],
                mode: "reference",
              });
            })
          }
        >
          <Plus />
          添加片段
        </Button>
      </StageMoreActions>
      <FormAssistant
        dock
        compactToolbar
        toolbarStart={
          <>
            <VersionBar step="director" editor={editor} compact />
            <StatusBadge
              value={
                editor.dirty
                  ? "draft"
                  : editor.v?.id === editor.current
                    ? r?.statuses?.director || "empty"
                    : editor.v
                      ? "draft"
                      : "empty"
              }
            />
          </>
        }
        toolbarEnd={
          <VersionActions editor={editor} content={content} compact />
        }
        key={`director-${editor.v?.id || "new"}`}
        skill="director"
        form={content}
        disabled={editor.busy || r?.statuses?.story !== "approved"}
        onApply={(patch) => {
          setContent((old) => ({ ...old, ...patch }));
          editor.setDirty(true);
        }}
      />
      <div className="min-w-0 space-y-4">
        <Card className="overflow-hidden shadow-none">
          <CardContent className="space-y-6 pt-5">
            {r?.steps.story.selected && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">故事参考</summary>
                <p className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap leading-7">
                  {
                    r.steps.story.versions.find(
                      (v) => v.id === r.steps.story.selected,
                    )?.content.text
                  }
                </p>
              </details>
            )}
            <Field label="整体导演意图">
              <Textarea
                rows={4}
                aria-label="导演意图"
                value={content.prompt}
                onChange={(e) => change((c) => (c.prompt = e.target.value))}
              />
            </Field>
            <div className="flex items-center justify-between">
              <h3 className="font-medium">时间节拍</h3>
            </div>
            {content.beats.map((b: Json, i: number) => (
              <div
                key={b.id}
                className="space-y-3 rounded-lg border bg-muted/10 p-4"
              >
                <FormAssistant
                  skill="beat"
                  form={{
                    description: b.description,
                    camera: b.camera || "",
                    dialogue: b.dialogue || "",
                  }}
                  context={{ current_beat: b, plan: content }}
                  onApply={(patch) =>
                    change((c) => {
                      Object.assign(c.beats[i], patch);
                    })
                  }
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{i + 1}</span>
                  <Input
                    className="w-20"
                    type="number"
                    min={0}
                    step="0.1"
                    aria-label={`节拍${i + 1}开始秒`}
                    value={b.start}
                    onChange={(e) =>
                      change((c) => (c.beats[i].start = Number(e.target.value)))
                    }
                  />
                  <span className="text-xs">—</span>
                  <Input
                    className="w-20"
                    type="number"
                    min={0}
                    step="0.1"
                    aria-label={`节拍${i + 1}结束秒`}
                    value={b.end}
                    onChange={(e) =>
                      change((c) => (c.beats[i].end = Number(e.target.value)))
                    }
                  />
                  <span className="text-xs text-muted-foreground">秒</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto"
                    aria-label="删除节拍"
                    onClick={() => change((c) => c.beats.splice(i, 1))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Textarea
                  rows={2}
                  aria-label={`节拍${i + 1}画面`}
                  placeholder="画面、动作与情绪"
                  value={b.description}
                  onChange={(e) =>
                    change((c) => (c.beats[i].description = e.target.value))
                  }
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    aria-label={`节拍${i + 1}运镜`}
                    placeholder="镜头与运镜"
                    value={b.camera || ""}
                    onChange={(e) =>
                      change((c) => (c.beats[i].camera = e.target.value))
                    }
                  />
                  <Input
                    aria-label={`节拍${i + 1}台词`}
                    placeholder="对白或旁白"
                    value={b.dialogue || ""}
                    onChange={(e) =>
                      change((c) => (c.beats[i].dialogue = e.target.value))
                    }
                  />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">生成片段</h3>
              <div className="flex gap-2"></div>
            </div>
            {content.segments.map((s: Json, i: number) => (
              <div key={s.id} className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center gap-2">
                  <Input
                    className="font-medium"
                    aria-label={`片段${i + 1}名称`}
                    value={s.title}
                    onChange={(e) =>
                      change((c) => (c.segments[i].title = e.target.value))
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="删除片段"
                    onClick={() => change((c) => c.segments.splice(i, 1))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="起止时间（秒）">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.1"
                        aria-label={`片段${i + 1}开始秒`}
                        value={s.start}
                        onChange={(e) =>
                          change((c) => {
                            c.segments[i].start = Number(e.target.value);
                            c.segments[i].duration =
                              c.segments[i].end - c.segments[i].start;
                            c.segments[i].beat_ids = c.beats
                              .filter(
                                (b: Json) =>
                                  b.start < c.segments[i].end &&
                                  b.end > c.segments[i].start,
                              )
                              .map((b: Json) => b.id);
                          })
                        }
                      />
                      <span>—</span>
                      <Input
                        type="number"
                        step="0.1"
                        aria-label={`片段${i + 1}结束秒`}
                        value={s.end}
                        onChange={(e) =>
                          change((c) => {
                            c.segments[i].end = Number(e.target.value);
                            c.segments[i].duration =
                              c.segments[i].end - c.segments[i].start;
                            c.segments[i].beat_ids = c.beats
                              .filter(
                                (b: Json) =>
                                  b.start < c.segments[i].end &&
                                  b.end > c.segments[i].start,
                              )
                              .map((b: Json) => b.id);
                          })
                        }
                      />
                    </div>
                  </Field>
                  <Field label="生成方式">
                    <Choice
                      label="生成方式"
                      value={s.depends_on?.[0] || "none"}
                      onChange={(v) =>
                        change((c) => {
                          c.segments[i].depends_on = v === "none" ? [] : [v];
                          c.segments[i].mode =
                            v === "none" ? "reference" : "extend";
                        })
                      }
                      options={{
                        none: "独立片段",
                        ...(!r?.model.startsWith("wan")
                          ? Object.fromEntries(
                              content.segments
                                .slice(0, i)
                                .map((p: Json) => [p.id, "续写：" + p.title]),
                            )
                          : {}),
                      }}
                    />
                  </Field>
                </div>
                <FormAssistant
                  skill="segment"
                  form={{ prompt: s.prompt }}
                  context={{ current_segment: s, plan: content }}
                  onApply={(patch) =>
                    change((c) => {
                      c.segments[i].prompt = patch.prompt;
                    })
                  }
                />
                <Field label="完整视频提示词">
                  <Textarea
                    rows={5}
                    value={s.prompt}
                    onChange={(e) =>
                      change((c) => (c.segments[i].prompt = e.target.value))
                    }
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  {s.references?.map((ref: Json) => (
                    <Badge key={ref.asset_id} variant="secondary">
                      {ref.name}
                      {ref.state_name ? ` · ${ref.state_name}` : ""}
                    </Badge>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRefs(s.id)}
                  >
                    选择资源版本
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {refs && (
        <References
          assets={p?.assets || []}
          initial={
            content.segments.find((s: Json) => s.id === refs)?.references || []
          }
          onClose={() => setRefs(null)}
          onSave={(list) => {
            change(
              (c) =>
                (c.segments.find((s: Json) => s.id === refs).references = list),
            );
            setRefs(null);
          }}
        />
      )}
    </div>
  );
}
function References({
  assets,
  initial,
  onSave,
  onClose,
}: {
  assets: Asset[];
  initial: Json[];
  onSave: (list: Json[]) => void;
  onClose: () => void;
}) {
  const [refs, setRefs] = useState<Record<string, string>>(
    Object.fromEntries(initial.map((ref) => [ref.asset_id, ref.version])),
  );
  return (
    <EditorDialog
      title="片段资源"
      onClose={onClose}
      onSubmit={() =>
        onSave(
          Object.entries(refs).map(([id, version]) => {
            const a = assets.find((a) => a.id === id)!,
              v = a.versions.find((v) => v.id === version)!;
            return {
              ...stateFields(v),
              images: v.images || [],
              asset_id: a.id,
              version: v.id,
              name: a.name,
              kind: a.kind,
              description: v.description,
              url: v.url || "",
            };
          }),
        )
      }
    >
      {assets.length ? (
        assets.map((a) => (
          <div key={a.id} className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!refs[a.id]}
                onChange={(e) =>
                  setRefs((old) => {
                    const next = { ...old };
                    if (e.target.checked)
                      next[a.id] = a.selected || a.versions.at(-1)!.id;
                    else delete next[a.id];
                    return next;
                  })
                }
              />
              {a.name}
            </label>
            {refs[a.id] && (
              <Choice
                label={`${a.name}版本`}
                value={refs[a.id]}
                onChange={(v) => setRefs((old) => ({ ...old, [a.id]: v }))}
                options={Object.fromEntries(
                  a.versions.map((v) => [
                    v.id,
                    `${resourceVersionLabel(v)} · ${v.description?.slice(0, 50) || ""}`,
                  ]),
                )}
              />
            )}
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">暂无素材</p>
      )}
    </EditorDialog>
  );
}
