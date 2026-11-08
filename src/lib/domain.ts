import { createHash, randomUUID } from "node:crypto";
import {
  type Json,
  type Status,
  type Version,
  type Stage,
  type Run,
  type Episode,
  type Asset,
  type Project,
  type Job,
  STEPS,
  TITLES,
  PROFILES,
  DEFAULT_MODEL,
} from "./types";
export * from "./types";
export const uid = () => randomUUID().replaceAll("-", "").slice(0, 16);
export const now = () => Date.now() / 1000;
export const copy = <T>(v: T): T => structuredClone(v);
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assert(test: unknown, message: string): asserts test {
  if (!test) throw new AppError(message);
}
function ordered(value: any): any {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, ordered(value[k])]),
    );
  return value;
}
export const digest = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(ordered(v)))
    .digest("hex");
export function selected(r: Run, s: string): Version | undefined {
  if (s === "segments" && r.planning_schema >= 2) s = "director";
  const g = r.steps[s];
  return g?.versions.find((v) => v.id === g.selected);
}
export const segments = (r: Run): Json[] =>
  selected(r, "segments")?.content.segments || [];
export const chosen = (r: Run, sid: string) =>
  r.media[sid]?.find((v) => v.id === r.media_selection[sid]);
export const entries = (r: Run, sid?: string): Json[] =>
  (selected(r, "characters")?.content.characters || []).filter(
    (c: Json) => !sid || c.segment_ids?.includes(sid),
  );
export function inputs(p: Project, r: Run, s: string): Json {
  if (
    r.project_config_revision &&
    ["story", "director", "segments", "characters"].includes(s)
  ) {
    const base = inputs(p, { ...r, project_config_revision: 0 }, s);
    return { ...base, project_config: r.project_config_revision };
  }
  if (s === "characters")
    return {
      story: selected(r, "story")?.id ?? null,
      director: selected(r, "director")?.id ?? null,
    };
  if (s === "director" || s === "segments")
    return { story: selected(r, "story")?.id ?? null, model: r.model };
  if (s === "assembly")
    return {
      media: Object.fromEntries(
        segments(r).map((s) => [s.id, r.media_selection[s.id] ?? null]),
      ),
    };
  if (s === "subtitles")
    return { assembly: selected(r, "assembly")?.id ?? null };
  if (s === "finish")
    return {
      ...inputs(p, r, "assembly"),
      ratio: p.ratio,
      plan: selected(r, "director")
        ? digest(selected(r, "director")!.content)
        : null,
    };
  return {};
}
export function mediaHash(r: Run, s: Json): string {
  const plan = selected(r, "director")?.content;
  const v: Json = {
    ...(r.project_config_revision
      ? { project_config: r.project_config_revision }
      : {}),
    segment: s,
    model: r.model,
    upstream: Object.fromEntries(
      (s.depends_on || []).map((id: string) => [
        id,
        r.media_selection[id] ?? null,
      ]),
    ),
  };
  if (r.model.startsWith("wan"))
    v.video_options = r.video_options?.[s.id] || {};
  if (plan && r.planning_schema >= 2) {
    v.direction = plan.prompt;
    v.beats = plan.beats.filter(
      (b: Json) => b.start < s.end && b.end > s.start,
    );
  }
  const cast = entries(r, s.id);
  if (cast.length)
    v.characters = cast.map((c) =>
      Object.fromEntries(
        [
          "asset_id",
          "kind",
          "version",
          "name",
          "description",
          "images",
          "url",
        ].map((k) => [k, c[k] ?? null]),
      ),
    );
  const world = selected(r, "characters")?.content.world;
  if (world) v.world = world;
  return digest(v);
}
export function fresh(r: Run, s: Json, seen = new Set<string>()): boolean {
  const v = chosen(r, s.id);
  if (!v || v.input_hash !== mediaHash(r, s) || seen.has(s.id)) return false;
  const next = new Set([...seen, s.id]);
  return (s.depends_on || []).every((id: string) => {
    const parent = segments(r).find((x) => x.id === id);
    return parent && fresh(r, parent, next);
  });
}
export function status(p: Project, r: Run, s: string): Status {
  if (s === "complete") return r.finished_at ? "approved" : "empty";
  if (s === "segments") return status(p, r, "director");
  if (s === "finish") {
    const outs = r.exports.filter((x) => x.kind === "finish");
    if (!outs.length) return "empty";
    return status(p, r, "generation") === "approved" &&
      outs.some((x) => digest(x.inputs) === digest(inputs(p, r, "finish")))
      ? "approved"
      : "stale";
  }
  if (s === "generation") {
    const list = segments(r);
    if (!list.length) return "empty";
    if (
      status(p, r, "director") !== "approved" ||
      status(p, r, "characters") !== "approved"
    )
      return list.some((s) => chosen(r, s.id)) ? "stale" : "draft";
    if (
      list.some(
        (s) => !chosen(r, s.id) || chosen(r, s.id)!.content.quality === "draft",
      )
    )
      return "draft";
    return list.every((s) => fresh(r, s)) ? "approved" : "stale";
  }
  const v = selected(r, s);
  if (!v) return "empty";
  if (digest(v.inputs) !== digest(inputs(p, r, s))) return "stale";
  if (
    (s === "director" && status(p, r, "story") !== "approved") ||
    (s === "characters" && status(p, r, "director") !== "approved") ||
    (s === "assembly" && status(p, r, "generation") !== "approved")
  )
    return "stale";
  return v.approved ? "approved" : "draft";
}
export function requireStep(p: Project, r: Run, s: string) {
  assert(status(p, r, s) === "approved", `请先更新并确认「${TITLES[s] || s}」`);
}
export function newRun(name = "制作方案 A"): Run {
  return {
    id: uid(),
    name,
    model: DEFAULT_MODEL,
    planning_schema: 2,
    created: now(),
    steps: Object.fromEntries(
      [
        "story",
        "director",
        "characters",
        "segments",
        "assembly",
        "subtitles",
      ].map((s) => [s, { versions: [], selected: null }]),
    ),
    media: {},
    media_selection: {},
    conversations: { story: [], director: [], characters: [] },
    exports: [],
  };
}
export function addVersion(
  r: Run,
  s: string,
  content: Json,
  p: Project,
  source = "manual",
  adopt = false,
  approved = false,
  basis?: Json,
) {
  const g = (r.steps[s] ??= { versions: [], selected: null });
  const v: Version = {
    id: uid(),
    number: g.versions.length + 1,
    created: now(),
    content: copy(content),
    inputs: copy(basis ?? inputs(p, r, s)),
    source,
    approved,
  };
  g.versions.push(v);
  if (adopt) g.selected = v.id;
  return v;
}
export function view(p: Project): Project {
  const v = copy(p);
  for (const e of v.episodes)
    for (const r of e.runs) {
      if (e.locked_at && r.locked_view) {
        Object.assign(r, copy(r.locked_view));
        continue;
      }
      r.statuses = Object.fromEntries(
        [...STEPS, "assembly", "subtitles"].map((s) => [s, status(v, r, s)]),
      );
      r.media_fresh = Object.fromEntries(
        segments(r).map((s) => [s.id, fresh(r, s)]),
      );
      r.current_export =
        [...r.exports]
          .reverse()
          .find(
            (x) =>
              x.kind === "finish" &&
              digest(x.inputs) === digest(inputs(v, r, "finish")) &&
              status(v, r, "generation") === "approved",
          ) ?? null;
    }
  return v;
}
export function locate(p: Project, eid: string, rid?: string) {
  const e = p.episodes.find((e) => e.id === eid);
  assert(e, "分集不存在");
  const r = e.runs.find((r) => r.id === (rid || e.active_run));
  assert(r, "制作方案不存在");
  return { e, r };
}
