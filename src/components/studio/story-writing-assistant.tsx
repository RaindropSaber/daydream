"use client";
import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "./context";
import { useFormAssistant, type Target } from "./form-assistant";
import {
  STORY_STAGES,
  type Story,
  type StoryChapter,
  type StoryStage,
} from "@/lib/stories";
import type { Json } from "@/lib/types";

export function StoryWritingAssistant({
  story,
  stage,
  chapter,
  disabled,
  onApply,
}: {
  story: Story;
  stage: StoryStage;
  chapter?: StoryChapter;
  disabled: boolean;
  onApply: (patch: Json) => void;
}) {
  const { register, launch } = useFormAssistant();
  const id = useRef(crypto.randomUUID()).current;
  const live = useRef({ story, chapter, disabled, onApply });
  live.current = { story, chapter, disabled, onApply };
  const target = useRef<Target | null>(null);
  useEffect(() => {
    let mounted = true;
    const next: Target = {
      id,
      title: STORY_STAGES[stage].title,
      skill: "story",
      scope: { project_id: story.project_id },
      prompt: `帮我完善${STORY_STAGES[stage].title}，生成可供预览和应用的候选稿。`,
      snapshot: () => {
        const current = live.current;
        const form: Json =
          (stage === "chapters" ? current.chapter : current.story) || {};
        return {
          form: Object.fromEntries(
            STORY_STAGES[stage].fields.map((field) => [field, form[field]]),
          ),
          context: {
            story: structuredClone(current.story),
            chapter_id: current.chapter?.id,
          },
          disabled: !mounted || current.disabled,
        };
      },
      request: async (snapshot, messages) => {
        const content = snapshot.context.story as Story;
        const result = await api(
          `/api/studio/projects/${content.project_id}/story/assist`,
          {
            stage,
            chapter_id: snapshot.context.chapter_id,
            content:
              stage === "chapters"
                ? {
                    ...content,
                    chapters: content.chapters.map((c) =>
                      c.id === snapshot.context.chapter_id
                        ? { ...c, ...snapshot.form }
                        : c,
                    ),
                  }
                : { ...content, ...snapshot.form },
            messages: messages.slice(-29).map((m) => ({
              role: m.role,
              text: (m.patch
                ? `${m.text}\n\n候选稿：\n${JSON.stringify(m.patch)}`
                : m.text
              ).slice(0, 20000),
            })),
          },
        );
        return { ...result, skill: "story" };
      },
      apply: (patch) => live.current.onApply(patch),
    };
    target.current = next;
    const unregister = register(next);
    return () => {
      mounted = false;
      unregister();
    };
  }, [id, stage, story.project_id, chapter?.id, register]);
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={() => target.current && launch(target.current)}
    >
      <Sparkles className="size-3.5" />
      帮我创作
    </Button>
  );
}
