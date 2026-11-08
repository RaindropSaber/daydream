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
    style: "电影写实",
    creative_prompt: "",
    ratio: "16:9",
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
  const titles = {
    project: editingProject ? "编辑基础信息" : "新建项目",
    episode: "新建分集",
    run: "新建制作方案",
    asset: initial?.asset_id ? "编辑资源" : "新增资源",
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
            data = await mutate("project-settings", values);
          } else if (type === "project") {
            const { api } = await import("./context");
            data = await api("/api/studio/projects", values);
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
          <Field label={type === "project" ? "创作方向" : "本集剧情"}>
            <Textarea
              rows={4}
              maxLength={10000}
              disabled={busy}
              value={values.brief}
              aria-label="创作方向"
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
      {type === "project" && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="风格">
            <Input
              aria-label="风格"
              list="project-style-presets"
              maxLength={100}
              disabled={busy}
              value={values.style}
              onChange={(e) => set("style", e.target.value)}
              placeholder="选择预设或输入自定义风格"
            />
            <datalist id="project-style-presets">
              {STYLE_PRESETS.map((style) => (
                <option key={style} value={style} />
              ))}
            </datalist>
          </Field>
          <Field label="画幅">
            <Choice
              label="画幅"
              disabled={busy}
              value={values.ratio}
              onChange={(v) => set("ratio", v)}
              options={{ "16:9": "16:9", "9:16": "9:16", "1:1": "1:1" }}
            />
          </Field>
        </div>
      )}
      {type === "project" && (
        <Field label="项目创作规范（可选）">
          <Textarea
            aria-label="项目创作规范"
            placeholder="整体风格、世界观、美术要求等"
            rows={4}
            maxLength={12000}
            value={values.creative_prompt}
            onChange={(e) => set("creative_prompt", e.target.value)}
          />
        </Field>
      )}
      {editingProject && (
        <p className="text-xs leading-6 text-muted-foreground">
          修改创作方向、风格、画幅或规范后，进行中的方案会标记为待更新；已结束方案保留原有结果。
        </p>
      )}
      <FormAssistant
        skill={type}
        projectId={projectId}
        label={editingProject ? "AI 完善基础信息" : "AI 生成"}
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
                story: "继承当前故事",
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
                aria-label="资源名称"
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
