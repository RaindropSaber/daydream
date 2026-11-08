import { assert, digest, type Json } from "../domain";
import { videoReferenceLimits } from "../models";
import { PROFILES } from "../types";

export { resourceKey } from "../storyboard";
import { resourceKey } from "../storyboard";
export function readableShot(text: string, resources: Json[]) {
  return text.replace(/@resource:([\w-]+)/g, (_all, key) => {
    const entry = resources.find((e) => resourceKey(e) === key);
    assert(entry, "分镜中存在失效的资源标签，请重新绑定");
    return entry.name;
  });
}
export function compileStoryboard(
  content: Json,
  resources: Json[],
  model: string,
): Json[] {
  const cap = PROFILES[model];
  assert(cap, "不支持的视频模型");
  const beats: Json[] = content.beats || [];
  assert(beats.length > 0, "请先完成分镜");
  const limits = videoReferenceLimits(model);
  function group(start: number, end: number) {
    const shots = beats.slice(start, end);
    const ids = new Set(shots.map((b) => b.id));
    const entries = resources.filter((e) =>
      e.segment_ids.some((id: string) => ids.has(id)),
    );
    const references = [
      ...new Map(
        entries.map((e) => {
          const images = e.images || [];
          const image = e.reference_image
            ? images.find((i: Json) => (i.file || i.url) === e.reference_image)
            : images[0];
          assert(
            !e.reference_image || image,
            `${e.name}的参考视图已失效，请重新选择`,
          );
          if (cap.image_mode !== "text")
            assert(image || e.url, `请先生成或绑定「${e.name}」的参考图`);
          const reference: Json = {
            asset_id: e.asset_id,
            version: e.version,
            state_id: e.state_id || "default",
            kind: e.kind,
            name: e.name,
            description: e.description,
            ...(image ? { image } : { url: e.url || "" }),
          };
          return [
            digest({
              asset: e.asset_id,
              version: e.version,
              image: image || e.url,
            }),
            reference,
          ] as const;
        }),
      ).values(),
    ];
    const count = {
      image:
        cap.image_mode === "text"
          ? 0
          : references.filter((r) => r.image || r.url).length,
      video: 0,
      audio: 0,
    };
    if (count.image > limits.image) return null;
    const duration = shots.at(-1)!.end - shots[0].start;
    if (
      duration < cap.min ||
      duration > cap.max ||
      (cap.provider === "wan" && !Number.isInteger(duration))
    )
      return null;
    const prompt = shots
      .map(
        (b, index) =>
          `镜头 ${start + index + 1}｜${Number((b.start - shots[0].start).toFixed(3))}–${Number((b.end - shots[0].start).toFixed(3))} 秒\n${readableShot(b.description, resources)}`,
      )
      .join("\n\n切镜\n\n");
    return {
      id: "SB_" + digest(shots.map((b) => b.id)).slice(0, 16),
      title: `${shots[0].start}–${shots.at(-1)!.end} 秒`,
      start: shots[0].start,
      end: shots.at(-1)!.end,
      duration,
      prompt,
      beat_ids: shots.map((b) => b.id),
      references,
      depends_on: [],
      mode: "reference",
      reference_count: count,
    };
  }
  const scores = Array(beats.length + 1).fill(Infinity);
  const previous: ({ index: number; segment: Json } | undefined)[] = [];
  scores[0] = 0;
  for (let i = 0; i < beats.length; i++) {
    if (!Number.isFinite(scores[i])) continue;
    for (let j = i + 1; j <= beats.length; j++) {
      if (beats[j - 1].end - beats[i].start > cap.max) break;
      const segment = group(i, j);
      if (!segment) continue;
      const next = scores[i] + 1;
      if (next < scores[j]) {
        scores[j] = next;
        previous[j] = { index: i, segment };
      }
    }
  }
  assert(
    Number.isFinite(scores.at(-1)),
    `无法按当前分镜边界组合：模型要求每段 ${cap.min}–${cap.max} 秒，最多 ${limits.image} 张参考图。请调整分镜时间、资源或视频模型`,
  );
  const result: Json[] = [];
  for (let i = beats.length; i > 0;) {
    const step = previous[i]!;
    result.unshift(step.segment);
    i = step.index;
  }
  return result.map((s, i) => ({ ...s, title: `片段 ${i + 1} · ${s.title}` }));
}
