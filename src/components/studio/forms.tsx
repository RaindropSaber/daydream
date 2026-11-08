"use client";
import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogPortal,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { STYLE_PRESETS } from "@/lib/creative-spec";
import { FormAssistant, useFormAssistant } from "./form-assistant";
import { useAction, useStudio } from "./context";
import { kindNames } from "./common";
import { DEFAULT_EPISODE_DURATION, type Json } from "@/lib/types";
export function Choice({
  value,
  onChange,
  options,
  label,
  disabled,
  className,
  displayValue,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Record<string, string>;
  label: string;
  disabled?: boolean;
  className?: string;
  displayValue?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className={className || "w-full"}>
        <SelectValue>{displayValue}</SelectValue>
      </SelectTrigger>
      <SelectContent className="z-[70]">
        {Object.entries(options).map(([k, v]) => (
          <SelectItem key={k} value={k}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Field({
  label,
  children,
  description,
}: {
  label: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      {children}
      {description && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
export function EditorDialog({
  title,
  description,
  children,
  onSubmit,
  onClose,
  busy = false,
  label = "保存",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onSubmit: () => void;
  onClose: () => void;
  busy?: boolean;
  label?: string;
}) {
  const { open: assistantOpen } = useFormAssistant();
  return (
    <Dialog
      modal={false}
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPortal>
        <div className="fixed inset-0 z-50 bg-black/50" aria-hidden="true" />
      </DialogPortal>
      <DialogContent
        onInteractOutside={(e) => {
          if (assistantOpen) e.preventDefault();
        }}
        className="max-h-[85vh] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : "sr-only"}>
            {description || title}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? "保存中…" : label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function CreateDialog({
  type,
  projectId,
  initial,
  onClose,
  onCreated,
}: {
  type: "project" | "episode" | "run" | "asset";
  projectId?: string;
  initial?: Json;
  onClose: () => void;
  onCreated?: (data: Json) => void;
}) {
  const { mutate, refresh } = useStudio();
  const { busy, action } = useAction();
  const [values, setValues] = useState<Json>({
    title: "",
    brief: "",
    name: "",
    kind: "character",
    description: "",
    url: "",
    inherit: "story",
    ...(type === "episode"
      ? { target_duration: DEFAULT_EPISODE_DURATION }
      : {}),
    ...initial,
  });
  const set = (k: string, v: string) =>
    setValues((old) => ({ ...old, [k]: v }));
  const editingProject = type === "project" && !!projectId;
  const editingEpisode = type === "episode" && !!initial?.episode_id;
  const titles = {
    project: editingProject ? "编辑项目" : "新建项目",
    episode: editingEpisode ? "编辑分集" : "新建分集",
    run: "新建制作方案",
    asset: initial?.asset_id ? "编辑素材" : "新增素材",
  };
  return (
    <EditorDialog
      title={titles[type]}
      busy={busy}
      onClose={onClose}
      onSubmit={() =>
        void action(async () => {
          let data;
          if (editingProject) {
            data = await mutate("project-settings", {
              title: values.title,
              brief: values.brief,
              base_updated: values.base_updated,
            });
          } else if (editingEpisode) {
            data = await mutate("episode-settings", values);
          } else if (type === "project") {
            const { api } = await import("./context");
            data = await api("/api/studio/projects", {
              title: values.title,
              brief: values.brief,
            });
            await refresh();
          } else
            data = await mutate(
              { episode: "episodes", run: "runs", asset: "asset" }[type],
              values,
            );
          onCreated?.(data);
          onClose();
        })
      }
    >
      {(type === "project" || type === "episode") && (
        <>
          <Field label={type === "project" ? "项目名称" : "集名"}>
            <Input
              required
              maxLength={100}
              autoFocus
              aria-label="名称"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label={type === "project" ? "项目简介" : "本集剧情"}>
            <Textarea
              rows={4}
              maxLength={10000}
              disabled={busy}
              value={values.brief}
              aria-label={type === "project" ? "项目简介" : "本集剧情"}
              onChange={(e) => set("brief", e.target.value)}
            />
          </Field>
        </>
      )}
      {type === "episode" && (
        <Field label="预设时长（秒）">
          <Input
            type="number"
            required
            min={1}
            step={1}
            disabled={busy}
            aria-label="预设时长（秒）"
            value={values.target_duration}
            onChange={(e) =>
              setValues((old) => ({
                ...old,
                target_duration:
                  e.target.value === "" ? "" : Number(e.target.value),
              }))
            }
          />
        </Field>
      )}
      <FormAssistant
        skill={type}
        projectId={projectId}
        label={editingProject ? "AI 完善项目简介" : "AI 生成"}
        form={values}
        disabled={busy}
        onApply={(patch) => setValues((old) => ({ ...old, ...patch }))}
      />
      {type === "run" && (
        <>
          <Field label="方案名称">
            <Input
              required
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="继承内容">
            <Choice
              label="继承内容"
              value={values.inherit}
              onChange={(v) => set("inherit", v)}
              options={{
                story: "继承当前选章",
                all: "复制全部内容与采用结果",
                empty: "空白方案",
              }}
            />
          </Field>
        </>
      )}
      {type === "asset" && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Field label="类型">
              <Choice
                label="资源类型"
                value={values.kind}
                onChange={(v) => set("kind", v)}
                options={kindNames}
              />
            </Field>
            <Field label="名称">
              <Input
                required
                maxLength={100}
                aria-label="素材名称"
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </Field>
          </div>
          {initial?.state_name && (
            <p className="text-sm text-muted-foreground">
              当前状态：{initial.state_name} · 本次修改将保存为该状态的新版本。
            </p>
          )}
          <Field label="设定描述">
            <Textarea
              rows={6}
              required
              aria-label="设定描述"
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <Field label="参考地址（可选）">
            <Input
              type="url"
              placeholder="https://"
              aria-label="参考地址"
              value={values.url}
              onChange={(e) => set("url", e.target.value)}
            />
          </Field>
        </>
      )}
    </EditorDialog>
  );
}

export function ProductionSettingsDialog({ onClose }: { onClose: () => void }) {
  const { project, mutate } = useStudio();
  const { busy, action } = useAction();
  const [values, setValues] = useState({ ...project!.production });
  const set = (key: string, value: string) =>
    setValues((old) => ({ ...old, [key]: value }));
  return (
    <EditorDialog
      title="制作设置"
      busy={busy}
      onClose={onClose}
      onSubmit={() =>
        void action(async () => {
          await mutate("production-settings", {
            style: values.style,
            ratio: values.ratio,
            prompt: values.prompt,
            adaptation: values.adaptation,
            base_revision: values.revision,
          });
          onClose();
        })
      }
    >
      <p className="text-sm leading-6 text-muted-foreground">
        统一当前项目的视频表现方式。剧情和人物设定来自「故事创作」中已选用的章节。
      </p>
      <div className="grid grid-cols-2 gap-4">
        <Field label="视觉风格">
          <Input
            required
            disabled={busy}
            aria-label="视觉风格"
            list="video-style-presets"
            maxLength={100}
            value={values.style}
            onChange={(e) => set("style", e.target.value)}
          />
          <datalist id="video-style-presets">
            {STYLE_PRESETS.map((style) => (
              <option key={style} value={style} />
            ))}
          </datalist>
        </Field>
        <Field label="画幅">
          <Choice
            label="画幅"
            value={values.ratio}
            disabled={busy}
            onChange={(value) => set("ratio", value)}
            options={{ "16:9": "16:9", "9:16": "9:16", "1:1": "1:1" }}
          />
        </Field>
      </div>
      <Field label="美术规范">
        <Textarea
          disabled={busy}
          aria-label="美术规范"
          maxLength={12000}
          value={values.prompt}
          onChange={(e) => set("prompt", e.target.value)}
          placeholder="画面质感、配色、光线、服装与场景的美术表达，以及需要避免的视觉元素。"
        />
      </Field>
      <Field label="改编要求">
        <Textarea
          disabled={busy}
          aria-label="改编要求"
          maxLength={12000}
          value={values.adaptation}
          onChange={(e) => set("adaptation", e.target.value)}
          placeholder="如何把原文拍成视频，例如叙事视角、节奏、旁白使用与需要保留的情节。"
        />
      </Field>
      <p className="text-xs leading-6 text-muted-foreground">
        修改后，进行中的视频方案需要复核；已结束方案保留原结果。故事正文与已选原文不会被修改。
      </p>
      <FormAssistant
        skill="production"
        projectId={project!.id}
        label="AI 完善制作设置"
        form={values}
        disabled={busy}
        onApply={(patch) => setValues((old) => ({ ...old, ...patch }))}
      />
    </EditorDialog>
  );
}
