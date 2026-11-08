import { stateId, stateFields } from "../asset-state";
import {
  assert,
  type Json,
  type Project,
  type Run,
  PROFILES,
  selected,
  segments,
  copy,
  uid,
  now,
} from "../domain";
export const WORLD = [
  "premise",
  "technology",
  "visual_language",
  "palette",
  "materials",
  "avoid",
];
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
export function validateWorld(world: Json) {
  assert(
    world &&
      typeof world === "object" &&
      !Array.isArray(world) &&
      Object.entries(world).every(
        ([k, v]) =>
          WORLD.includes(k) && typeof v === "string" && v.length <= 4000,
      ),
    "世界观格式不正确",
  );
  return Object.fromEntries(WORLD.map((k) => [k, world[k] || ""]));
}
export function validate(r: Run, step: string, c: Json): Json {
  assert(c && typeof c === "object" && !Array.isArray(c), "内容必须为对象");
  if (step === "story") {
    assert(
      typeof c.text === "string" && c.text.trim() && c.text.length <= 200000,
      "请填写故事正文（最多20万字）",
    );
    return c;
  }
  if (step === "director") {
    assert(
      typeof c.prompt === "string" &&
        Array.isArray(c.beats) &&
        c.beats.length >= 1 &&
        c.beats.length <= 200,
      "方案需要导演意图和时间节拍",
    );
    let end = 0;
    const seen = new Set<string>();
    for (const b of c.beats) {
      assert(
        typeof b.id === "string" &&
          !seen.has(b.id) &&
          finite(b.start) &&
          finite(b.end) &&
          Math.abs(b.start - end) < 0.01 &&
          b.end > b.start,
        "节拍需从0秒连续排列，ID不能重复",
      );
      assert(
        ["description", "camera", "dialogue"].every(
          (k) => typeof (b[k] ?? "") === "string",
        ),
        "节拍描述需为文本",
      );
      seen.add(b.id);
      end = b.end;
    }
    validate(r, "segments", c);
    assert(
      Math.abs(c.segments.at(-1).end - end) < 0.01,
      "节拍和片段需要覆盖相同时长",
    );
    for (const s of c.segments)
      assert(
        Array.isArray(s.beat_ids) &&
          s.beat_ids.length &&
          s.beat_ids.every((id: string) => seen.has(id)),
        "片段需引用有效节拍",
      );
    return c;
  }
  if (step === "segments") {
    assert(
      Array.isArray(c.segments) &&
        c.segments.length >= 1 &&
        c.segments.length <= 100,
      "需要1–100个片段",
    );
    const cap = PROFILES[r.model];
    assert(cap, "不支持的视频模型");
    let end = 0;
    const seen = new Set<string>();
    for (const s of c.segments) {
      assert(
        typeof s.id === "string" && s.id && !seen.has(s.id),
        "片段ID不能重复",
      );
      assert(
        finite(s.start) &&
          finite(s.end) &&
          Math.abs(s.start - end) < 0.01 &&
          s.end - s.start >= cap.min &&
          s.end - s.start <= cap.max,
        `片段需连续排列，单段 ${cap.min}–${cap.max} 秒`,
      );
      assert(
        typeof s.prompt === "string" &&
          s.prompt.trim() &&
          s.prompt.length <= 12000,
        "请填写片段提示词（最多12000字）",
      );
      s.duration = s.end - s.start;
      s.depends_on ??= [];
      s.references ??= [];
      s.mode ??= "reference";
      assert(
        ["reference", "extend"].includes(s.mode) &&
          Array.isArray(s.depends_on) &&
          s.depends_on.every((id: string) => seen.has(id)) &&
          (s.mode !== "extend" || s.depends_on.length === 1),
        "续写只能依赖前面的一个片段",
      );
      if (cap.provider === "wan")
        assert(
          !s.depends_on.length &&
            s.mode !== "extend" &&
            Number.isInteger(s.duration),
          "万相需使用2–15整数秒独立片段",
        );
      assert(
        Array.isArray(s.references) &&
          s.references.every(
            (v: Json) =>
              typeof v.asset_id === "string" && typeof v.version === "string",
          ),
        "资源引用格式错误",
      );
      seen.add(s.id);
      end = s.end;
    }
    return c;
  }
  if (step === "characters") {
    assert(
      Array.isArray(c.characters) && c.characters.length <= 60,
      "设定最多60项",
    );
    if (c.world) c.world = validateWorld(c.world);
    const ids = new Set(segments(r).map((s) => s.id));
    const seen = new Set<string>();
    for (const e of c.characters) {
      assert(
        typeof e.asset_id === "string" &&
          !seen.has(e.asset_id + ":" + stateId(e)) &&
          ["character", "scene", "prop"].includes(e.kind || "character"),
        "设定类型或ID无效",
      );
      assert(
        ["version", "name", "description"].every(
          (k) => typeof e[k] === "string" && e[k].trim(),
        ),
        "设定缺少名称、描述或版本",
      );
      assert(
        (!e.state_id ||
          (typeof e.state_id === "string" && e.state_id.length <= 100)) &&
          (!e.state_name ||
            (typeof e.state_name === "string" && e.state_name.length <= 80)) &&
          (!e.tags ||
            (Array.isArray(e.tags) &&
              e.tags.length <= 12 &&
              e.tags.every(
                (t: any) => typeof t === "string" && t.length <= 30,
              ))),
        "剧情状态或标签格式错误",
      );
      assert(
        Array.isArray(e.segment_ids) &&
          e.segment_ids.length &&
          e.segment_ids.every((id: string) => ids.has(id)),
        "每项设定需绑定有效片段",
      );
      assert(
        !e.url || (typeof e.url === "string" && e.url.startsWith("https://")),
        "参考地址需为HTTPS",
      );
      assert(
        !e.images || (Array.isArray(e.images) && e.images.length <= 10),
        "图片格式错误",
      );
      for (const other of c.characters) {
        if (other !== e && other.asset_id === e.asset_id)
          assert(
            !other.segment_ids?.some((id: string) =>
              e.segment_ids.includes(id),
            ),
            "同一片段不能使用同一资源的多个状态",
          );
      }
      seen.add(e.asset_id + ":" + stateId(e));
    }
    return c;
  }
  if (step === "subtitles") {
    assert(Array.isArray(c.cues) && c.cues.length <= 3000, "字幕格式错误");
    let end = 0;
    for (const cue of c.cues) {
      assert(
        finite(cue.start) &&
          finite(cue.end) &&
          cue.start >= end &&
          cue.end > cue.start &&
          typeof cue.text === "string",
        "字幕时间需有序且不重叠",
      );
      end = cue.end;
    }
    return c;
  }
  assert(false, "不支持此步骤");
}
export function normalizePlan(p: Project, r: Run, c: Json) {
  for (const s of c.segments || []) {
    s.references =
      s.references ||
      (s.asset_ids || []).map((id: string) => {
        const a = p.assets.find((a) => a.id === id);
        assert(a, "方案引用了不存在的资源");
        const v = a.versions.find((v) => v.id === a.selected)!;
        return {
          asset_id: a.id,
          version: v.id,
          name: a.name,
          kind: a.kind,
          description: v.description,
          url: v.url || "",
        };
      });
    s.beat_ids =
      s.beat_ids ||
      c.beats
        .filter((b: Json) => b.start < s.end && b.end > s.start)
        .map((b: Json) => b.id);
  }
  return validate(r, "director", c);
}
export function registerSettings(p: Project, eid: string, c: Json) {
  for (const entry of c.characters) {
    let a = p.assets.find((a) => a.id === entry.asset_id);
    if (!a) {
      a = {
        id: entry.asset_id,
        name: entry.name,
        kind: entry.kind || "character",
        versions: [],
        selected: null,
        first_episode_id: eid,
      };
      p.assets.push(a);
    }
    if (!a.versions.some((v) => v.id === entry.version))
      a.versions.push({
        id: entry.version,
        number: a.versions.length + 1,
        ...stateFields(entry),
        reference_images: entry.reference_images || [],
        name: entry.name,
        description: entry.description,
        images: entry.images || [],
        url: entry.url || "",
        profile: entry.profile || {},
        created: now(),
        source: "conversation",
      });
    a.selected ??= entry.version;
  }
}
export function normalizeSettings(p: Project, r: Run, proposal: Json): Json {
  assert(
    Array.isArray(proposal.characters) && proposal.characters.length <= 60,
    "设定草稿格式不正确",
  );
  const old = selected(r, "characters")?.content;
  const world = validateWorld(
    proposal.world ||
      old?.world ||
      Object.fromEntries(WORLD.map((k) => [k, ""])),
  );
  const worldChanged =
    JSON.stringify(world) !== JSON.stringify(old?.world || world);
  const list: Json[] = [];
  for (const item of proposal.characters) {
    const kind = item.kind || "character";
    let a = item.asset_id
      ? p.assets.find((a) => a.id === item.asset_id && a.kind === kind)
      : p.assets.find((a) => a.kind === kind && a.name === item.name);
    if (item.asset_id) assert(a, "设定引用不存在的资源");
    let source: Json | undefined;
    if (a) {
      const requested = item.version || a.selected;
      for (const v of [...(r.steps.characters?.versions || [])].reverse()) {
        source = v.content.characters?.find(
          (c: Json) => c.asset_id === a!.id && c.version === requested,
        );
        if (source) break;
      }
      if (!source) {
        const v = a.versions.find((v) => v.id === requested);
        assert(v, "设定版本不存在");
        source = {
          ...stateFields(v),
          asset_id: a.id,
          kind: a.kind,
          version: v.id,
          name: a.name,
          description: v.description,
          images: v.images || [],
          url: v.url || "",
          profile: v.profile || {},
        };
      }
    }
    let entry: Json = source
      ? copy(source)
      : { asset_id: uid(), version: uid(), images: [], url: "", origin: "new" };
    if (
      source &&
      (item.new_state === true ||
        source.name !== item.name ||
        source.description !== item.description ||
        worldChanged)
    ) {
      entry.version = uid();
      entry.base_version = source.base_version || source.version;
      if (item.appearance_changed !== false || worldChanged) {
        entry.reference_images = source.images?.length
          ? copy(source.images)
          : source.reference_images ||
            (source.url ? [{ url: source.url }] : []);
        entry.images = [];
        entry.url = "";
      }
    }
    if (item.new_state === true) {
      assert(
        source && item.state_name?.trim(),
        "新增剧情状态需要原始资源和状态名称",
      );
      entry.state_id = uid();
      entry.state_name = item.state_name.trim();
      entry.tags = item.tags || [];
      entry.version = uid();
      entry.base_version = source.version;
      entry.reference_images = copy(
        source.images?.length
          ? source.images
          : source.reference_images ||
              (source.url ? [{ url: source.url }] : []),
      );
      entry.images = [];
      entry.url = "";
    }
    entry = {
      ...entry,
      kind,
      name: item.name,
      description: item.description,
      reason: item.reason || "",
      segment_ids: item.segment_ids,
    };
    list.push(entry);
  }
  return validate(r, "characters", { world, characters: list });
}
export function aggregate(r: Run, content: Json): Json {
  const cap = PROFILES[r.model],
    beats = content.beats as Json[];
  const points = [0, ...beats.map((b) => b.end)];
  const dp = points.map(() => Infinity),
    prev = points.map(() => -1);
  dp[0] = 0;
  for (let i = 1; i < points.length; i++)
    for (let j = 0; j < i; j++) {
      const d = points[i] - points[j];
      if (d >= cap.min && d <= cap.max && dp[j] + 1 < dp[i]) {
        dp[i] = dp[j] + 1;
        prev[i] = j;
      }
    }
  assert(
    Number.isFinite(dp.at(-1)),
    "节拍边界不能满足模型时长，请调整节拍后再聚合",
  );
  const ranges: number[][] = [];
  for (let i = points.length - 1; i > 0; i = prev[i])
    ranges.unshift([points[prev[i]], points[i]]);
  const list = ranges.map(([start, end], i) => {
    const olds = content.segments.filter(
      (s: Json) => s.start < end && s.end > start,
    );
    const refs = Array.from(
      new Map(
        olds
          .flatMap((s: Json) => s.references || [])
          .map((v: Json) => [v.asset_id + v.version, v]),
      ).values(),
    );
    return {
      id: uid(),
      title: `片段 ${String(i + 1).padStart(2, "0")}`,
      start,
      end,
      duration: end - start,
      prompt: olds.map((s: Json) => s.prompt).join("\n"),
      beat_ids: beats
        .filter((b) => b.start < end && b.end > start)
        .map((b) => b.id),
      references: refs,
      mode: "reference",
      depends_on: [],
    };
  });
  return validate(r, "director", { ...copy(content), segments: list });
}
