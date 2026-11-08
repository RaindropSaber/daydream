import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrate, database } from "../src/lib/server/db";
import { createProject, mutate } from "../src/lib/server/studio";
import { loadProject } from "../src/lib/server/repository";
import {
  createStory,
  saveStory,
  loadStory,
  loadStoryRevision,
  projectStory,
  assistStory,
} from "../src/lib/server/stories";
import { selected, status, digest, type Json } from "../src/lib/domain";
import { storeConfig } from "../src/lib/server/settings";
import type { Story } from "../src/lib/stories";
let dir: string;
const originalFetch = globalThis.fetch;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "daydream-stories-"));
  process.env.DATA_DIR = dir;
  process.env.SQLITE_PATH = path.join(dir, "stories.sqlite3");
  await migrate();
});
after(async () => {
  globalThis.fetch = originalFetch;
  await database().end();
  await fs.rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const { project } = await createProject({ title: "群岛邮差" });
  let { story } = await createStory(project.id, { title: "失落航线" });
  ({ story } = await saveStory(project.id, {
    expected_revision: story.revision,
    content: {
      ...story,
      world: "群岛以信件传递记忆",
      characters: "阿遥：寻找失踪的姐姐",
      chapters: [
        {
          id: "one",
          title: "第一章",
          summary: "收到旧信",
          text: "阿遥收到一封迟到了十年的信。",
          status: "draft",
        },
        {
          id: "two",
          title: "第二章",
          summary: "出发",
          text: "她驶向地图上不存在的岛屿。",
          status: "draft",
        },
      ],
    },
    confirm_chapter_id: "one",
  }));
  const ids = await mutate(project.id, "episodes", { title: "第一集" });
  const op = (action: string, body: Json = {}) =>
    mutate(project.id, action, { ...ids, ...body });
  return { project, story, ids, op };
}
async function confirm(story: Story, id: string) {
  return (
    await saveStory(story.project_id, {
      content: story,
      expected_revision: story.revision,
      confirm_chapter_id: id,
    })
  ).story;
}
function source(story: Story, ids: string[], expected: string | null = null) {
  return {
    story_id: story.id,
    story_revision: story.revision,
    chapter_ids: ids,
    expected_selected: expected,
  };
}
test("one project owns one story and cannot select another project's chapters", async () => {
  const a = await fixture(),
    b = await fixture();
  assert.equal((await projectStory(a.project.id))!.id, a.story.id);
  await assert.rejects(
    createStory(a.project.id, { title: "第二部" }),
    /只能有一部/,
  );
  await assert.rejects(
    a.op("select-story", source(b.story, ["one"])),
    /当前项目/,
  );
  const selectedA = await a.op("select-story", source(a.story, ["one"]));
  assert(selectedA.version_id);
  assert.equal(
    (await loadProject(b.project.id)).episodes[0].runs[0].steps.story.selected,
    null,
  );
  const empty = await createProject({ title: "空项目" });
  assert.equal(await projectStory(empty.project.id), null);
  await assert.rejects(
    createStory("not-a-project", { title: "无所属" }),
    /项目不存在/,
  );
});
test("draft chapters cannot be selected; edits reset confirmation and concurrent saves cannot overwrite", async () => {
  const f = await fixture();
  await assert.rejects(
    f.op("select-story", source(f.story, ["two"])),
    /已定稿/,
  );
  await assert.rejects(f.op("select-story", source(f.story, [])), /至少选择/);
  await assert.rejects(
    f.op("select-story", source(f.story, ["one", "one"])),
    /重复/,
  );
  await assert.rejects(
    f.op("select-story", source(f.story, ["alien"])),
    /不属于/,
  );
  const stale = structuredClone(f.story);
  const edited = structuredClone(f.story);
  edited.chapters[0].text = "阿遥认出了姐姐的字迹。";
  const results = await Promise.allSettled([
    saveStory(f.project.id, {
      content: edited,
      expected_revision: stale.revision,
    }),
    saveStory(f.project.id, {
      content: stale,
      expected_revision: stale.revision,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const current = await loadStory(f.project.id);
  assert.equal(current.chapters[0].status, "draft");
  await assert.rejects(f.op("select-story", source(stale, ["one"])), /已更新/);
  await assert.rejects(
    f.op("select-story", source(current, ["one"])),
    /已定稿/,
  );
  const ready = await confirm(current, "one");
  await f.op("select-story", source(ready, ["one"]));
  const history = await loadStoryRevision(ready.id, stale.revision);
  assert.equal(history.chapters[0].text, stale.chapters[0].text);
  await assert.rejects(
    saveStory(f.project.id, {
      expected_revision: ready.revision,
      content: {
        ...ready,
        chapters: [{ ...ready.chapters[0], text: "", status: "ready" }],
      },
      confirm_chapter_id: "one",
    }),
    /空章节/,
  );
});
test("selection follows story order, freezes content and settings, reuses across episodes, and checks concurrent source changes", async () => {
  const f = await fixture();
  let story = await confirm(f.story, "two");
  const first = await f.op("select-story", source(story, ["two", "one"]));
  let p = await loadProject(f.project.id);
  let r = p.episodes[0].runs[0];
  const snapshot = structuredClone(selected(r, "story")!);
  assert.deepEqual(snapshot.content.source.chapter_ids, ["one", "two"]);
  assert.equal(snapshot.content.context.world, story.world);
  assert.equal(status(p, r, "story"), "approved");
  const same = await f.op(
    "select-story",
    source(story, ["one", "two"], first.version_id),
  );
  assert.equal(same.version_id, first.version_id);
  const secondEpisode = await mutate(f.project.id, "episodes", {
    title: "另一种改编",
  });
  await mutate(f.project.id, "select-story", {
    ...secondEpisode,
    ...source(story, ["one"]),
  });
  story = (
    await saveStory(f.project.id, {
      expected_revision: story.revision,
      content: {
        ...story,
        world: "世界设定更新",
        chapters: story.chapters.map((c) =>
          c.id === "one" ? { ...c, text: "重写后的来信" } : c,
        ),
      },
      confirm_chapter_id: "one",
    })
  ).story;
  p = await loadProject(f.project.id);
  r = p.episodes[0].runs[0];
  assert.deepEqual(selected(r, "story"), snapshot);
  assert.equal(status(p, r, "story"), "approved");
  const updated = await f.op(
    "select-story",
    source(story, ["one"], first.version_id),
  );
  assert.notEqual(updated.version_id, first.version_id);
  await assert.rejects(
    f.op("select-story", source(story, ["two"], first.version_id)),
    /其他页面/,
  );
  p = await loadProject(f.project.id);
  r = p.episodes[0].runs[0];
  assert.deepEqual(
    r.steps.story.versions.find((v) => v.id === snapshot.id),
    snapshot,
  );
  assert.equal(
    p.episodes[1].runs[0].steps.story.versions[0].content.source.revision,
    snapshot.content.source.revision,
  );
});
test("story assistant uses only current project writing context, returns chapter plans and never saves or confirms", async () => {
  const f = await fixture();
  await storeConfig({ api_key: "test-key", agent_model: "test-story-agent" });
  const frozen = digest(await loadStory(f.project.id));
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    const context = JSON.parse(body.messages[1].content);
    assert.equal(context.story.id, f.story.id);
    assert.equal(context.story.world, "未保存的世界规则");
    assert(!Object.hasOwn(context, "video_model_capabilities"));
    if (body.tool_choice === "none")
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "已整理章节规划，等待应用。" },
          },
        ],
      });
    return Response.json({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: "story-proposal",
                type: "function",
                function: {
                  name: "propose_story_edit",
                  arguments: JSON.stringify({
                    outline: "收到信，寻岛，揭开真相",
                    chapter_plan: [
                      { title: "第三章", summary: "抵达失落的岛" },
                    ],
                  }),
                },
              },
            ],
          },
        },
      ],
    });
  };
  try {
    const result = await assistStory(f.project.id, {
      stage: "outline",
      content: { ...f.story, world: "未保存的世界规则" },
      messages: [{ role: "user", text: "完善大纲并规划下一章" }],
    });
    assert.equal(result.patch!.chapter_plan[0].title, "第三章");
    assert.equal(calls, 2);
    assert.equal(digest(await loadStory(f.project.id)), frozen);
    await assert.rejects(
      assistStory(f.project.id, {
        stage: "chapters",
        chapter_id: "missing",
        content: f.story,
        messages: [{ role: "user", text: "写正文" }],
      }),
      /先选择章节/,
    );
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: "bad",
                  type: "function",
                  function: {
                    name: "propose_story_edit",
                    arguments: JSON.stringify({
                      text: "试图在大纲阶段越权写正文",
                    }),
                  },
                },
              ],
            },
          },
        ],
      });
    await assert.rejects(
      assistStory(f.project.id, {
        stage: "outline",
        content: f.story,
        messages: [{ role: "user", text: "完善" }],
      }),
      /未授权字段/,
    );
    assert.equal(digest(await loadStory(f.project.id)), frozen);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
