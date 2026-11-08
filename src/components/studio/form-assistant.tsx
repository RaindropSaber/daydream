"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Sparkles } from "lucide-react";
import { StageToolbar } from "./stage-toolbar";
import { Button } from "@/components/ui/button";
import { useStudio } from "./context";
import {
  CREATION_SKILLS,
  isRunEditingSkill,
  skillPrompt,
  type CreationSkill,
} from "@/lib/creation-flow";
import type { Json } from "@/lib/types";

import { type FormSnapshot } from "@/lib/assistant-draft";
import type { ReferenceScope } from "@/lib/assistant-request";
export type Target = {
  id: string;
  title: string;
  skill: CreationSkill | "story" | "operation";
  prompt?: string;
  request?: (snapshot: FormSnapshot, messages: DraftMessage[]) => Promise<Json>;
  scope: ReferenceScope;
  snapshot: () => FormSnapshot;
  apply: (patch: Json) => void | Promise<void>;
  appliedMessage?: string;
  applyLabel?: string;
  activity?: ReactNode;
};
export type DraftMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  patch?: Json;
  before?: FormSnapshot;
  applied?: boolean;
  promptTrace?: Json;
  skill?: CreationSkill | "story" | "operation";
};
export type FormConversation = {
  id: string;
  target?: Target;
  title: string;
  referenceScope?: ReferenceScope;
  value: string;
  messages: DraftMessage[];
  busy: boolean;
  error: string;
};
const FormAssistantContext = createContext<{
  targets: Target[];
  register: (target: Target) => () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  conversations: FormConversation[];
  activeId: string | null;
  select: (id: string | null) => void;
  launch: (
    target: Target,
    discuss?: boolean,
    proposal?: { text: string; patch: Json },
  ) => void;
  newSession: () => void;
  update: (
    id: string,
    update: (session: FormConversation) => FormConversation,
  ) => void;
}>({
  targets: [],
  register: () => () => {},
  open: false,
  setOpen: () => {},
  conversations: [],
  activeId: null,
  select: () => {},
  launch: () => {},
  newSession: () => {},
  update: () => {},
});
export function FormAssistantProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<FormConversation[]>([]);
  const [activeId, select] = useState<string | null>(null);
  const register = useRef((target: Target) => {
    setTargets((old) => [...old.filter((t) => t.id !== target.id), target]);
    return () => setTargets((old) => old.filter((t) => t.id !== target.id));
  }).current;
  const launch = (
    target: Target,
    discuss = false,
    proposal?: { text: string; patch: Json },
  ) => {
    if (target.snapshot().disabled) return;
    const id = crypto.randomUUID();
    setConversations((old) => [
      ...old,
      {
        id,
        target,
        title: proposal ? target.title : "新对话",
        messages: proposal
          ? [
              {
                id: crypto.randomUUID(),
                role: "assistant",
                text: proposal.text,
                patch: proposal.patch,
                skill: target.skill,
                before: target.snapshot(),
              },
            ]
          : [],
        busy: false,
        error: "",
        value: proposal
          ? ""
          : (target.prompt ??
            (target.skill === "story" || target.skill === "operation"
              ? "帮我完善当前故事，生成可供预览和应用的候选稿。"
              : discuss
                ? `使用 @skill:${target.skill}，和我讨论${CREATION_SKILLS[target.skill].module}，先给建议。`
                : skillPrompt(target.skill))),
      },
    ]);
    select(id);
    setOpen(true);
  };
  const newSession = () => {
    const id = crypto.randomUUID();
    setConversations((old) => [
      ...old,
      {
        id,
        title: `新对话 ${old.length + 1}`,
        value: "",
        messages: [],
        busy: false,
        error: "",
      },
    ]);
    select(id);
    setOpen(true);
  };
  const update = (
    id: string,
    fn: (session: FormConversation) => FormConversation,
  ) =>
    setConversations((old) =>
      old.map((session) => (session.id === id ? fn(session) : session)),
    );
  return (
    <FormAssistantContext.Provider
      value={{
        targets,
        register,
        open,
        setOpen,
        conversations,
        activeId,
        select,
        launch,
        newSession,
        update,
      }}
    >
      {children}
    </FormAssistantContext.Provider>
  );
}
export const useFormAssistant = () => useContext(FormAssistantContext);
// Specialized creative tools share the global conversation and result-card UI.
export function useAssistantTarget(key: string, config: Omit<Target, "id">) {
  const { register, launch } = useFormAssistant();
  const live = useRef(config);
  live.current = config;
  const target = useRef<Target | null>(null);
  useEffect(() => {
    let mounted = true;
    const next: Target = {
      ...live.current,
      id: crypto.randomUUID(),
      snapshot: () => {
        const snapshot = live.current.snapshot();
        return { ...snapshot, disabled: !mounted || snapshot.disabled };
      },
      request: (snapshot, messages) =>
        live.current.request!(snapshot, messages),
      apply: (patch) => live.current.apply(patch),
    };
    target.current = next;
    const unregister = register(next);
    return () => {
      mounted = false;
      unregister();
    };
  }, [key, register]);
  return (prompt?: string, proposal?: { text: string; patch: Json }) => {
    if (!target.current) return;
    target.current.prompt = prompt ?? live.current.prompt;
    launch(target.current, false, proposal);
  };
}
export function FormAssistant({
  skill,
  projectId,
  form,
  onApply,
  context = {},
  disabled = false,
  label = "AI 生成",
  toolbarEnd,
  toolbarStart,
  compactToolbar = false,
  dock = false,
}: {
  skill: CreationSkill;
  projectId?: string;
  form: Json;
  onApply: (patch: Json) => void;
  context?: Json;
  disabled?: boolean;
  label?: string;
  toolbarEnd?: ReactNode;
  toolbarStart?: ReactNode;
  compactToolbar?: boolean;
  dock?: boolean;
}) {
  const studio = useStudio();
  const { register, launch } = useFormAssistant();
  const id = useRef(crypto.randomUUID()).current;
  const live = useRef({ form, context, disabled, onApply });
  const runEditing = isRunEditingSkill(skill);
  const unavailable = disabled || (runEditing && !!studio.run?.finished_at);
  live.current = {
    form,
    context,
    disabled: unavailable,
    onApply,
  };
  const mounted = useRef(false);
  const target = useRef<Target>(null!);
  useEffect(() => {
    mounted.current = true;
    const next: Target = {
      id,
      title: CREATION_SKILLS[skill].module,
      skill,
      scope: {
        project_id:
          projectId ?? (skill === "project" ? undefined : studio.project?.id),
        episode_id:
          runEditing || skill === "run" ? studio.episode?.id : undefined,
        run_id: runEditing || skill === "run" ? studio.run?.id : undefined,
      },
      snapshot: () => ({
        form: structuredClone(live.current.form),
        context: structuredClone(live.current.context),
        disabled:
          !mounted.current || target.current !== next || live.current.disabled,
      }),
      apply: (patch) => live.current.onApply(patch),
    };
    target.current = next;
    const unregister = register(next);
    return () => {
      mounted.current = false;
      unregister();
    };
  }, [
    id,
    skill,
    projectId,
    runEditing,
    register,
    studio.project?.id,
    studio.episode?.id,
    studio.run?.id,
  ]);
  const controls = (
    <div
      className={
        compactToolbar
          ? "flex flex-nowrap items-center gap-1 overflow-x-auto pb-1 [&>*]:shrink-0"
          : "flex flex-wrap items-center gap-2"
      }
    >
      {!dock && toolbarStart}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={unavailable}
        title={label}
        className={compactToolbar ? "px-2 xl:px-3" : undefined}
        onClick={() => launch(target.current)}
      >
        <Sparkles className="size-3.5" />
        <span className={compactToolbar ? "sr-only xl:not-sr-only" : undefined}>
          {label}
        </span>
      </Button>
      {toolbarEnd && <div className="ml-auto">{toolbarEnd}</div>}
    </div>
  );
  return dock ? (
    <StageToolbar meta={toolbarStart}>{controls}</StageToolbar>
  ) : (
    controls
  );
}
