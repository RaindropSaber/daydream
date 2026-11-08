import type { Json } from "./types";

export type FormSnapshot = { form: Json; context: Json; disabled: boolean };
export function matchesDraft(current: FormSnapshot, before?: FormSnapshot) {
  return (
    !!before &&
    !current.disabled &&
    JSON.stringify(current.form) === JSON.stringify(before.form) &&
    JSON.stringify(current.context) === JSON.stringify(before.context)
  );
}

// Keep unaccepted edits when the user asks to revise a previous result card.
export function pendingDraft(
  current: FormSnapshot,
  messages: { patch?: Json; before?: FormSnapshot; applied?: boolean }[],
): Json {
  const latest = messages.findLast((m) => m.patch);
  return latest && !latest.applied && matchesDraft(current, latest.before)
    ? latest.patch!
    : {};
}

export function formExcerpt(form: Json) {
  const text = JSON.stringify(form, null, 2);
  return text.length <= 10000
    ? text
    : `${text.slice(0, 10000)}\n…（完整内容将随请求提供给助手）`;
}
