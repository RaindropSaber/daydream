import type { Json } from "./types";
export const resourceKey = (entry: Json): string =>
  entry.binding_id || `${entry.asset_id}_${entry.state_id || "default"}`;
export const resourceTokens = (text: string): string[] => [
  ...new Set(Array.from(text.matchAll(/@resource:([\w-]+)/g), (m) => m[1])),
];
export function tagDescription(text: string, entries: Json[]) {
  let result = text;
  for (const entry of [...entries].sort(
    (a, b) => b.name.length - a.name.length,
  )) {
    const token = `@resource:${resourceKey(entry)}`;
    if (result.includes(token)) continue;
    if (result.includes(entry.name))
      result = result.split(entry.name).join(token);
    else result += ` ${token}`;
  }
  return result;
}
export function displayDescription(text: string, entries: Json[]) {
  return text.replace(
    /@resource:([\w-]+)/g,
    (_all, key) =>
      entries.find((e) => resourceKey(e) === key)?.name || "未绑定资源",
  );
}

// An explicit silent shot is a direction to the model, not subtitle text.
export function dialogueText(beat: Json): string {
  const section = beat.description?.match(
    /(?:^|\n)\s*台词与旁白[：:]\s*([\s\S]*?)(?=\n\s*(?:画面与动作|镜头|声音)[：:]|$)/,
  );
  const text = (section ? section[1] : beat.dialogue || "").trim();
  return text === "无对白" ? "" : text;
}
