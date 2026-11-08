import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { database, migrate } from "../src/lib/server/db";
import { createProject, mutate } from "../src/lib/server/studio";
import { loadProject, saveProject } from "../src/lib/server/repository";
import { createStory, loadStory } from "../src/lib/server/stories";
import { addVersion, newRun, inputs, digest, status } from "../src/lib/domain";
let temporary: string;
before(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "daydream-production-"));
  process.env.DATA_DIR = temporary;
  process.env.SQLITE_PATH = path.join(temporary, "settings.sqlite3");
  await migrate("002_stories.sql");
  await database().query(
    "INSERT INTO projects(id,title,brief,style,ratio,metadata,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      "existing",
      "已有作品",
      "原来的项目说明",
      "水彩",
      "9:16",
      {
        creative_prompt: "冷暖对比，保留纸张纹理",
        creative_spec: { palette: "蓝色海面" },
        config_revision: 3,
        other: "保留的元数据",
      },
      1,
      2,
    ],
  );
  await migrate();
});
after(async () => {
  await database().end();
  await fs.rm(temporary, { recursive: true, force: true });
});
test("schema moves existing video settings without losing project information", async () => {
  const p = await loadProject("existing");
  assert.equal(p.brief, "原来的项目说明");
  assert.equal(p.other, "保留的元数据");
  assert.equal(p.production.style, "水彩");
  assert.equal(p.production.ratio, "9:16");
  assert.match(p.production.prompt, /冷暖对比，保留纸张纹理/);
  assert.match(p.production.prompt, /蓝色海面/);
  assert.equal(p.production.revision, 3);
  const columns = (
    await database().query("PRAGMA table_info(projects)")
  ).rows.map((row) => row.name);
  assert(!columns.includes("style") && !columns.includes("ratio"));
  assert.equal(Object.hasOwn(p, "creative_prompt"), false);
  await migrate();
  assert.deepEqual((await loadProject("existing")).production, p.production);
});
test("project and production edits keep their fields separate and preserve the story", async () => {
  const { project: p } = await createProject({
    title: "新作品",
    brief: "用于组织作品的说明",
  });
  const { story } = await createStory(p.id, { title: "自己的故事" });
  const settings = {
    style: "国风水墨",
    ratio: "1:1",
    prompt: "淡墨与留白",
    adaptation: "对白推动情节，避免旁白",
    base_revision: 0,
  };
  await mutate(p.id, "production-settings", settings);
  const current = await loadProject(p.id);
  await mutate(p.id, "project-settings", {
    title: "改名作品",
    brief: "调整后的简介",
    base_updated: current.updated,
  });
  const saved = await loadProject(p.id);
  assert.deepEqual(await loadStory(p.id), story);
  assert.deepEqual(saved.production, current.production);
  assert.equal(saved.brief, "调整后的简介");
  await assert.rejects(
    createProject({ title: "无效混合表单", style: "水彩" }),
    /仅需名称与简介/,
  );
  await assert.rejects(
    mutate(p.id, "production-settings", {
      ...settings,
      title: "越界修改",
      base_revision: 1,
    }),
    /未知字段/,
  );
  await assert.rejects(
    mutate(p.id, "project-settings", {
      title: saved.title,
      brief: saved.brief,
      ratio: "9:16",
      base_updated: saved.updated,
    }),
    /制作设置/,
  );
  assert.equal((await loadProject(p.id)).title, saved.title);
});
test("finished schemes retain their export basis after a project's production settings change", async () => {
  const { project: p } = await createProject({ title: "成片设置快照" });
  const ids = await mutate(p.id, "episodes", { title: "第一集" });
  const saved = await loadProject(p.id);
  const r = saved.episodes[0].runs[0];
  // A completed scheme's basis stays tied to its own settings snapshot.
  r.finished_at = 10;
  r.production_snapshot = structuredClone(saved.production);
  const before = inputs(saved, r, "finish");
  const frozen = digest(r);
  await saveProject(saved);
  await mutate(p.id, "production-settings", {
    style: "水彩",
    ratio: "9:16",
    prompt: "新美术",
    adaptation: "新改编",
    base_revision: 0,
  });
  const current = await loadProject(p.id);
  assert.equal(digest(current.episodes[0].runs[0]), frozen);
  assert.deepEqual(
    inputs(current, current.episodes[0].runs[0], "finish"),
    before,
  );
  assert.equal(
    status(current, current.episodes[0].runs[0], "complete"),
    "approved",
  );
  const second = await mutate(p.id, "episodes", { title: "第二集" });
  const newEpisode = (await loadProject(p.id)).episodes.find(
    (e) => e.id === second.episode_id,
  )!;
  assert.equal(
    newEpisode.runs[0].project_config_revision,
    current.production.revision,
  );
  assert.equal(ids.run_id, r.id);
});
