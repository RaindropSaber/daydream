import type { Json, Run } from "./types";

// Read legacy stage conversations alongside the shared conversation, without
// rewriting message IDs or breaking links to existing draft versions.
export function conversationTimeline(run: Run): Json[] {
  return Object.entries(run.conversations)
    .flatMap<Json>(([stage, messages]) =>
      messages.map((message) => ({ ...message, stage })),
    )
    .sort((a, b) => a.created - b.created);
}
