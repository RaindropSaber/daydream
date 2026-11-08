import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Project,
  newRun,
  addVersion,
  inputs,
  mediaHash,
  selected,
  status,
  uid,
  now,
  copy,
  fresh,
} from "../src/lib/domain";
import { validate, aggregate } from "../src/lib/server/validation";
import { validateCues, stamp } from "../src/lib/server/render";
function fixture() {
  const r = newRun();
  const p: Project = {
    id: uid(),
    title: "测试",
    brief: "",
    production: {
      style: "电影写实",
      ratio: "16:9",
      prompt: "",
      adaptation: "",
      revision: 0,
    },
    assets: [],
    episodes: [],
    created: now(),
    updated: now(),
  };
  addVersion(r, "story", { text: "完整故事" }, p, "test", true, true);
  const plan = {
    prompt: "导演意图",
    beats: [
      {
        id: "b1",
        start: 0,
        end: 8,
        description: "开场",
        camera: "",
        dialogue: "你好",
      },
      {
        id: "b2",
        start: 8,
        end: 16,
        description: "结尾",
        camera: "",
        dialogue: "再见",
      },
    ],
    segments: [
      {
        id: "A",
        title: "A",
        start: 0,
        end: 8,
        duration: 8,
        prompt: "完整提示词A",
        beat_ids: ["b1"],
        references: [],
        mode: "reference",
        depends_on: [],
      },
      {
        id: "B",
        title: "B",
        start: 8,
        end: 16,
        duration: 8,
        prompt: "完整提示词B",
        beat_ids: ["b2"],
        references: [],
        mode: "extend",
        depends_on: ["A"],
      },
    ],
  };
  addVersion(r, "director", plan, p, "test", true, true);
  addVersion(
    r,
    "characters",
    { world: { premise: "测试" }, characters: [] },
    p,
    "test",
    true,
    true,
  );
  for (const s of plan.segments) {
    const id = uid();
    r.media[s.id] = [
      {
        id,
        number: 1,
        content: {
          quality: "standard",
          duration: 8,
          remote_url: "https://provider.example/file.mp4",
        },
        inputs: {},
        input_hash: mediaHash(r, s),
        created: now(),
      },
    ];
    r.media_selection[s.id] = id;
  }
  return { p, r, plan };
}
test("candidate drafts do not replace selected versions", () => {
  const { p, r } = fixture();
  const current = selected(r, "story")!.id;
  addVersion(r, "story", { text: "新稿" }, p, "test", false);
  assert.equal(selected(r, "story")!.id, current);
});
test("segment-local changes preserve unrelated clips and invalidate continuation", () => {
  const { p, r, plan } = fixture();
  assert.equal(status(p, r, "generation"), "approved");
  plan.segments[1].prompt = "只改B";
  selected(r, "director")!.content.segments[1].prompt = "只改B";
  assert(fresh(r, plan.segments[0]));
  assert(!fresh(r, plan.segments[1]));
  const baseline = fixture();
  baseline.r.media_selection.A = "new-upstream";
  assert(!fresh(baseline.r, baseline.plan.segments[1]));
});
test("dependency cycles, gaps and unsupported model parameters are rejected", () => {
  const { r, plan } = fixture();
  assert.doesNotThrow(() => validate(r, "director", copy(plan)));
  const bad = copy(plan);
  bad.segments[0].depends_on = ["B"];
  assert.throws(() => validate(r, "director", bad));
  const gap = copy(plan);
  gap.beats[1].start = 9;
  assert.throws(() => validate(r, "director", gap));
  r.model = "wan2.6-t2v";
  assert.throws(() => validate(r, "director", copy(plan)));
});
test("upstream revision invalidates downstream and current export", () => {
  const { p, r } = fixture();
  r.exports.push({
    id: uid(),
    kind: "finish",
    inputs: inputs(p, r, "finish"),
    content: {},
    created: now(),
  });
  assert.equal(status(p, r, "finish"), "approved");
  addVersion(r, "story", { text: "新版故事" }, p, "test", true, true);
  assert.equal(status(p, r, "director"), "stale");
  assert.equal(status(p, r, "characters"), "stale");
  assert.equal(status(p, r, "finish"), "stale");
});
test("aggregation preserves duration, beats and prompts", () => {
  const { r, plan } = fixture();
  const result = aggregate(r, plan);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].end, 16);
  assert.deepEqual(result.beats, plan.beats);
  assert(result.segments[0].prompt.includes("完整提示词A"));
  assert(result.segments[0].prompt.includes("完整提示词B"));
});
test("caption validation rejects invalid timing and incomplete alignment", () => {
  assert.equal(stamp(1.25), "00:00:01,250");
  assert.throws(() => validateCues([{ start: 0, end: 3, text: "好" }], 2));
  assert.throws(() =>
    validateCues([{ start: 0, end: 1, text: "你" }], 2, "你好"),
  );
  assert.doesNotThrow(() =>
    validateCues([{ start: 0, end: 1, text: "你好" }], 2, "你好"),
  );
});
