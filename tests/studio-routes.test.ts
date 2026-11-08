import assert from "node:assert/strict";
import test from "node:test";
import { studioPath, isStudioStep } from "../src/lib/studio-routes";

const scope = { project: "p1", episode: "e1", run: "r1" };

test("global pages and project workspaces have distinct paths", () => {
  assert.equal(studioPath("home"), "/");
  assert.equal(studioPath("models"), "/models");
  assert.equal(studioPath("overview", scope), "/projects/p1");
  assert.equal(studioPath("story-workspace", scope), "/projects/p1/stories");
  for (const view of ["assets", "jobs", "models"] as const)
    assert.equal(studioPath(view, scope), `/projects/p1/${view}`);
});

test("workflow and draft links preserve their full resource scope", () => {
  const path = "/projects/p1/episodes/e1";
  assert.equal(studioPath("episode", scope), `${path}?run=r1`);
  assert.equal(
    studioPath("episode", { ...scope, step: "director", version: "v1" }),
    `${path}/director?run=r1&version=v1`,
  );
  assert.equal(
    studioPath("episode", { ...scope, run: "r2", step: "complete" }),
    "/projects/p1/episodes/e1/complete?run=r2",
  );
});

test("query selections cannot change the page identity", () => {
  const url = new URL(
    studioPath("episode", { ...scope, run: "r/a?b#c", version: "v&run=other" }),
    "http://localhost",
  );
  assert.equal(url.pathname, "/projects/p1/episodes/e1");
  assert.equal(url.searchParams.get("run"), "r/a?b#c");
  assert.equal(url.searchParams.get("version"), "v&run=other");
});

test("IDs are encoded as individual segments rather than URL syntax", () => {
  assert.equal(
    studioPath("overview", { project: "项目/a?b#c" }),
    "/projects/%E9%A1%B9%E7%9B%AE%2Fa%3Fb%23c",
  );
});

test("incomplete scopes and unknown steps cannot produce misleading links", () => {
  assert.throws(() => studioPath("overview"), /project/);
  assert.throws(() => studioPath("episode", { project: "p1" }), /episode/);
  assert.equal(
    studioPath("episode", { project: "p1", episode: "e1" }),
    "/projects/p1/episodes/e1",
  );
  assert.throws(
    () => studioPath("episode", { ...scope, step: "missing" }),
    /未知制作步骤/,
  );
  assert.equal(isStudioStep("director"), true);
  assert.equal(isStudioStep("missing"), false);
});
