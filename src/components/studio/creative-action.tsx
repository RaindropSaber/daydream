"use client";
import { useRef } from "react";
import { api, useStudio } from "./context";
import { useAssistantTarget } from "./form-assistant";
import { assistantRequest } from "@/lib/assistant-request";

type Operation = {
  title: string;
  description: string;
  label?: string;
  action: () => void | Promise<unknown>;
};

/** Media generation and export use the same global result-card confirmation. */
export function useCreativeAction() {
  const studio = useStudio();
  const operation = useRef<(Operation & { id: string }) | null>(null);
  const scope = {
    project_id: studio.project?.id,
    episode_id: studio.episode?.id,
    run_id: studio.run?.id,
  };
  const open = useAssistantTarget(
    `operation:${scope.project_id}:${scope.episode_id}:${scope.run_id}`,
    {
      title: "制作任务",
      skill: "operation",
      scope,
      snapshot: () => ({
        form: { operation_id: operation.current?.id },
        context: { ...scope, updated: studio.project?.updated },
        disabled: !operation.current,
      }),
      request: (_snapshot, messages) =>
        api("/api/studio/assistant", assistantRequest(messages, scope)),
      apply: async (patch) => {
        const current = operation.current;
        if (!current || patch.operation_id !== current.id)
          throw new Error("操作内容已变化，请重新发起");
        await current.action();
      },
      appliedMessage: "任务已提交，进度会显示在创作浮窗中",
      applyLabel: "执行任务",
    },
  );
  return (next: Operation) => {
    operation.current = { ...next, id: crypto.randomUUID() };
    open(undefined, {
      text: `${next.title}\n\n${next.description}`,
      patch: {
        operation_id: operation.current.id,
        操作: next.title,
        执行说明: next.label || "开始执行",
      },
    });
  };
}
