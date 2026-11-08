import { test } from "node:test";
import assert from "node:assert/strict";
import { compileStoryboard } from "../src/lib/server/segment-planner";
import { tagDescription, resourceTokens } from "../src/lib/storyboard";
import type { Json } from "../src/lib/types";
const model = "doubao-seedance-2-0-fast-260128";
const shots = (ends: number[]) => ({
  prompt: "克制",
  beats: ends.map((end, i) => ({
    id: `b${i}`,
    start: i ? ends[i - 1] : 0,
    end,
    description: "机器人撑伞",
    camera: "固定",
    dialogue: "",
  })),
});
const resource = (id: string, beatIds: string[]): Json => ({
  asset_id: id,
  version: "v1",
  kind: "prop",
  name: id,
  description: "独立设定",
  segment_ids: beatIds,
  images: [
    { file: id + ".jpg", url: "/media/" + id + ".jpg", pose: "portrait" },
    {
      file: id + "-full.jpg",
      url: "/media/" + id + "-full.jpg",
      pose: "fullbody",
    },
  ],
});
test("three short storyboard shots totaling eight seconds become a single request with one view per unique resource", () => {
  const content = shots([2, 5, 8]);
  const resources = [
    resource("robot", ["b0", "b1", "b2"]),
    resource("umbrella", ["b1", "b2"]),
  ];
  content.beats[0].description = "@resource:robot_default 撑伞";
  const result = compileStoryboard(content, resources, model);
  assert.equal(result.length, 1);
  assert.equal(result[0].duration, 8);
  assert.equal(result[0].references.length, 2);
  assert.match(result[0].prompt, /robot 撑伞/);
  assert.equal(result[0].reference_count.image, 2);
  assert.deepEqual(result[0].beat_ids, ["b0", "b1", "b2"]);
});
test("reference limits can require splitting an eight-second story; no reference is silently dropped", () => {
  const content = shots([4, 8]);
  const refs = Array.from({ length: 10 }, (_, i) =>
    resource("r" + i, [i < 5 ? "b0" : "b1"]),
  );
  const result = compileStoryboard(content, refs, model);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((s) => s.references.length),
    [5, 5],
  );
  assert.equal(result[0].end, result[1].start);
  assert.throws(
    () =>
      compileStoryboard(
        shots([8]),
        refs.map((r) => ({ ...r, segment_ids: ["b0"] })),
        model,
      ),
    /无法按当前分镜边界组合/,
  );
});
test("duration constraints preserve shot boundaries, reference choices and deterministic grouping", () => {
  const content = shots([5, 10, 15, 20]);
  const entry = resource("x", ["b0", "b1", "b2", "b3"]);
  entry.reference_image = "x-full.jpg";
  const first = compileStoryboard(content, [entry], model);
  assert.equal(first.length, 2);
  assert(first.every((s) => s.duration >= 4 && s.duration <= 15));
  assert.equal(first[0].references[0].image.file, "x-full.jpg");
  assert.deepEqual(compileStoryboard(content, [entry], model), first);
  assert.throws(
    () =>
      compileStoryboard(
        content,
        [{ ...entry, reference_image: "missing.jpg" }],
        model,
      ),
    /参考视图已失效/,
  );
  assert.throws(
    () => compileStoryboard(shots([3]), [], model),
    /无法按当前分镜边界组合/,
  );
  assert.throws(
    () =>
      compileStoryboard(
        shots([8]),
        [{ ...entry, segment_ids: ["b0"], images: [], reference_image: "" }],
        model,
      ),
    /先生成或绑定/,
  );
});
test("inline tags keep distinct resource identities and existing tags survive repeated analysis", () => {
  const entries = [
    { asset_id: "a", name: "机器人" },
    { asset_id: "b", name: "雨伞" },
  ];
  const text = tagDescription("机器人举起雨伞", entries);
  assert.deepEqual(resourceTokens(text), ["a_default", "b_default"]);
  assert.equal(tagDescription(text, entries), text);
});

test("compiled video requests preserve the complete shot description", () => {
  const content = shots([4, 8]);
  content.beats[0].description =
    "画面与动作：机器人走近。\n镜头：缓慢推近。\n台词与旁白：机器人：等一下\n声音：雨滴敲打伞面";
  content.beats[1].description =
    "画面与动作：撑伞。\n镜头：固定。\n台词与旁白：无对白\n声音：脚步踩过水洼";
  const result = compileStoryboard(content, [], model);
  assert(result[0].prompt.includes(content.beats[0].description));
  assert(result[0].prompt.includes(content.beats[1].description));
  assert.match(result[0].prompt, /镜头 1｜0–4 秒/);
  assert.match(result[0].prompt, /镜头 2｜4–8 秒/);
  assert.equal(result[0].prompt.split("切镜").length - 1, 1);
});
