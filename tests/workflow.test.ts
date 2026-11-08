import { test } from "node:test";
import assert from "node:assert/strict";
import { newRun } from "../src/lib/domain";
import type { Job, Version } from "../src/lib/types";
import { workflowStages } from "../src/lib/workflow";

const version = (
  id: string,
  number: number,
  content = {},
  approved = false,
): Version => ({
  id,
  number,
  content,
  approved,
  inputs: {},
  created: 100 + number,
});
const job = (
  runId: string,
  kind: string,
  state: string,
  created = 200,
  step = "story",
): Job => ({
  id: `${kind}-${created}`,
  project_id: "p",
  episode_id: "e",
  run_id: runId,
  kind,
  state,
  created,
  step,
  message: "任务详情",
});

test("new runs show one actionable starting stage and five stages awaiting prerequisites", () => {
  const stages = workflowStages(newRun(), []);
  assert.deepEqual(
    stages.map((stage) => stage.state),
    ["empty", "blocked", "blocked", "blocked", "blocked", "blocked"],
  );
  assert.equal(stages[0].action, "选择故事章节");
});

test("unadopted drafts are exposed without counting them as completed stages", () => {
  const run = newRun();
  run.steps.story.versions.push(version("draft", 1, { text: "新稿" }));
  let story = workflowStages(run, [])[0];
  assert.equal(story.newDraft, true);
  assert.equal(story.action, "选择故事章节");
  assert.match(story.detail, /待审阅采用/);
  assert.equal(story.status, "empty");
  run.steps.story.selected = "draft";
  run.statuses = { story: "draft" };
  story = workflowStages(run, [])[0];
  assert.equal(story.newDraft, false);
  assert.equal(story.action, "选择故事章节");
});

test("active jobs map to their production stage and remain visible alongside existing approved results", () => {
  const run = newRun();
  run.statuses = {
    story: "approved",
    director: "approved",
    characters: "approved",
    generation: "draft",
  };
  const stages = workflowStages(run, [
    job("other-run", "finish", "running"),
    job(run.id, "character-image", "running"),
    job(run.id, "video-batch", "queued"),
  ]);
  assert.equal(stages[2].state, "running");
  assert.equal(stages[2].status, "approved");
  assert.equal(stages[3].state, "queued");
  assert.equal(stages[4].state, "blocked");
});

test("outdated or recovered failures do not replace current stage state", () => {
  const run = newRun();
  run.steps.story.versions.push(version("current", 2));
  run.steps.story.selected = "current";
  run.statuses = { story: "draft" };
  assert.equal(
    workflowStages(run, [job(run.id, "text", "failed", 50)])[0].state,
    "draft",
  );
  assert.equal(
    workflowStages(run, [job(run.id, "text", "failed", 200)])[0].state,
    "failed",
  );
  assert.equal(
    workflowStages(run, [
      job(run.id, "text", "failed", 200),
      job(run.id, "text", "done", 201),
    ])[0].state,
    "draft",
  );
  run.statuses.story = "approved";
  assert.equal(
    workflowStages(run, [job(run.id, "text", "failed", 200)])[0].state,
    "approved",
  );
});

test("video counts include only adopted fresh final clips and stale stages explain the update needed", () => {
  const run = newRun();
  run.steps.director.versions.push(
    version("plan", 1, {
      segments: ["a", "b", "c", "d"].map((id) => ({ id })),
    }),
  );
  run.steps.director.selected = "plan";
  for (const id of ["a", "b", "c", "d"]) {
    run.media[id] = [
      version(id, 1, { quality: id === "c" ? "draft" : "standard" }),
    ];
  }
  run.media_selection = { a: "a", b: "b", c: "c" };
  run.media_fresh = { a: true, b: false, c: true, d: true };
  run.statuses = { story: "draft", director: "stale", generation: "stale" };
  const stages = workflowStages(run, []);
  assert.match(stages[3].detail, /1 \/ 4 段/);
  assert.equal(stages[1].state, "stale");
  assert.equal(stages[1].action, "更新分镜与资源");
});
