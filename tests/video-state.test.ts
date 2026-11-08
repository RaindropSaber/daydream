import { test } from "node:test";
import assert from "node:assert/strict";
import { newRun } from "../src/lib/domain";
import type { Job, Version } from "../src/lib/types";
import { videoCardState } from "../src/lib/video-state";
const clip: Version = {
  id: "clip",
  number: 1,
  content: { url: "/media/test.mp4" },
  inputs: {},
  created: 20,
};
function job(
  runId: string,
  state: string,
  created: number,
  segment = "B",
): Job {
  return {
    id: `${state}-${created}`,
    project_id: "p",
    episode_id: "e",
    run_id: runId,
    segment_id: segment,
    kind: "video",
    state,
    created,
    message: state,
  };
}
test("video cards display current queued and running tasks even without a video or with an adopted older version", () => {
  const r = newRun();
  assert.equal(
    videoCardState(r, [job(r.id, "running", 30)], "B").state,
    "running",
  );
  assert.equal(
    videoCardState(r, [job(r.id, "queued", 30)], "B").state,
    "queued",
  );
  r.media.B = [clip];
  r.media_selection.B = clip.id;
  r.media_fresh = { B: true };
  assert.equal(
    videoCardState(r, [job(r.id, "running", 30)], "B", clip.id).state,
    "running",
  );
  assert.equal(videoCardState(r, [], "B", clip.id).state, "approved");
});
test("completed retries and newer video results suppress historical failures regardless of job ordering", () => {
  const r = newRun();
  assert.equal(
    videoCardState(r, [job(r.id, "failed", 10), job(r.id, "done", 30)], "B")
      .job,
    undefined,
  );
  r.media.B = [clip];
  assert.equal(
    videoCardState(r, [job(r.id, "failed", 10)], "B").state,
    "candidate",
  );
  assert.equal(
    videoCardState(r, [job(r.id, "failed", 30)], "B").state,
    "failed",
  );
  assert.equal(
    videoCardState(r, [job(r.id, "failed", 30), job(r.id, "running", 40)], "B")
      .state,
    "running",
  );
});
test("card status follows the displayed candidate and never borrows other segment or scheme tasks", () => {
  const r = newRun();
  r.media.B = [clip, { ...clip, id: "new", number: 2, created: 40 }];
  r.media_selection.B = clip.id;
  r.media_fresh = { B: true };
  assert.equal(videoCardState(r, [], "B", "new").state, "candidate");
  assert.equal(
    videoCardState(
      r,
      [job(r.id, "running", 50, "A"), job("other", "running", 50)],
      "B",
      clip.id,
    ).state,
    "approved",
  );
  r.media_fresh.B = false;
  assert.equal(videoCardState(r, [], "B", clip.id).state, "stale");
  assert.equal(videoCardState(r, [], "A").state, "empty");
});
