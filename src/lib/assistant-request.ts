import type { Json } from "./types";
import type { CreationSkill } from "./creation-flow";

export type ReferenceScope = {
  project_id?: string;
  episode_id?: string;
  run_id?: string;
};
export type FormSource = {
  skill: CreationSkill;
  form: Json;
  context: Json;
};

// Supply read sources to the agent, without injecting their content as messages.
export function assistantRequest(
  messages: { role: string; text: string; patch?: Json }[],
  scope: ReferenceScope = {},
  formSource?: FormSource,
) {
  return {
    mode: "prompt",
    context_scope: scope,
    ...(formSource ? { form_source: formSource } : {}),
    messages: messages.map((message) => ({
      role: message.role,
      text: (message.patch
        ? `${message.text}\n\n结果卡片：\n${JSON.stringify(message.patch)}`
        : message.text
      ).slice(0, 20000),
    })),
  };
}
