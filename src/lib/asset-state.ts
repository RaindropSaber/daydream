import type { Asset, Json } from "./types";

// Legacy resources belong to the default story state.
export const stateId = (v: Json) => v.state_id || "default";
export const stateName = (v: Json) => v.state_name || "初始状态";
export const resourceVersionLabel = (v: Json) =>
  `${stateName(v)} · v${v.number}${v.tags?.length ? ` · ${v.tags.join(" / ")}` : ""}`;
export function assetStates(a: Asset) {
  const states = new Map<string, Json>();
  for (const v of a.versions) {
    const key = stateId(v);
    states.set(key, v);
  }
  return [...states.values()];
}
export function stateFields(v: Json): Json {
  return {
    state_id: stateId(v),
    state_name: stateName(v),
    tags: v.tags || [],
    ...(v.base_version ? { base_version: v.base_version } : {}),
  };
}
