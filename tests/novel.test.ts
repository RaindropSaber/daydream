import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrate, database } from "../src/lib/server/db";
import { createProject } from "../src/lib/server/studio";
import {
  projectStory,
  createStory,
  saveStory,
  loadStory,
  loadStoryRevision,
} from "../src/lib/server/stories";
import {
  assistNovelPlan,
  assistNovelTask,
  controlNovel,
  novelTask,
  runNovelTaskStep,
  novelContext,
  startNovelWorker,
  isManuscriptReady,
} from "../src/lib/server/novel";
import { defaultNovel, wordCount, manuscriptText } from "../src/lib/novel";
import { storeConfig } from "../src/lib/server/settings";
import { digest, type Json } from "../src/lib/domain";
import { validateSchema } from "../src/lib/server/creation-agent";
let dir: string;
const originalFetch = globalThis.fetch;
const memory = {
  recap: "主角收到信，决定调查。",
  characters: "阿遥尚不知道姐姐的去向。",
  threads: "旧信的来源尚未揭晓。",
  timeline: "出发第一日，港口。",
};
const prose = Array.from(
  { length: 70 },
  (_, i) =>
    `阿遥走过第${i + 1}座界碑，仔细核对海图上的标记。她从石缝里取出另一张旧纸，发现上面留下了新的坐标和不同的船名。`,
)
  .join("\n\n")
  .slice(0, 1600);
let inject:
  | ((schema: Json, context: Json) => Json | Promise<Json> | undefined)
  | undefined;
let contexts: Json[] = [];
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "daydream-novel-"));
  process.env.DATA_DIR = dir;
  process.env.SQLITE_PATH = path.join(dir, "novel.sqlite3");
  await migrate();
  await storeConfig({
    api_key: "fake",
    text_model: "fake-novelist",
    agent_model: "fake-workflow",
  });
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "fake-novelist");
    if (request.tool_choice === "none")
      return Response.json({
        choices: [
          { finish_reason: "stop", message: { content: "已完成本步骤。" } },
        ],
      });
    const context = JSON.parse(request.messages[1].content);
    contexts.push(context);
    const schema = request.tools[0].function.parameters;
    let result = await inject?.(schema, context);
    if (!result) {
      const p = schema.properties;
      if (p.volumes)
        result = {
          title: "失落航线",
          premise: "邮差寻找失踪姐姐",
          genre: "悬疑冒险",
          theme: "记忆与信任",
          world: "群岛依靠邮船通行",
          characters: "阿遥、姐姐与守塔人",
          outline: "发现旧信，逐卷调查，揭开群岛秘密，姐妹重逢。",
          ending: "阿遥救出姐姐，结束记忆交易。",
          volumes: [
            {
              title: "旧信",
              start: 1,
              end: 17,
              goal: "追查来信",
              climax: "发现姐姐仍在岛上",
              resolution: "启程寻找核心岛屿",
            },
            {
              title: "归途",
              start: 18,
              end: 34,
              goal: "救出姐姐",
              climax: "阻止记忆交易",
              resolution: "重逢并返回家乡",
            },
          ],
        };
      else if (p.chapters)
        result = {
          chapters: Array.from(
            { length: context.plan_end - context.plan_start + 1 },
            (_, i) => ({
              title: `航线${context.plan_start + i}`,
              summary: "调查新线索，遭遇阻碍，作出选择。",
            }),
          ),
        };
      else if (p.text)
        result = {
          text: `本章航程：第${context.chapter_number}段。\n\n${prose}`,
          summary: "阿遥向灯塔出发并获得新线索。",
          memory,
          review: "本章因果与知识边界自检通过。",
        };
      else if (p.memory)
        result = {
          summary: "阿遥调查来信的新事实。",
          memory,
          review: "按新正文重建记忆，未发现冲突。",
          issues: [],
        };
      else
        result = {
          report: "主线完成，人物成长和伏笔已收束；需作者审阅正文。",
          issues: [],
        };
    }
    return Response.json({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: "novel-result",
                type: "function",
                function: {
                  name: request.tools[0].function.name,
                  arguments: JSON.stringify(result),
                },
              },
            ],
          },
        },
      ],
    });
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  await database().end();
  await fs.rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const { project } = await createProject({ title: "小说测试" });
  await createStory(project.id, {
    title: "未命名",
    novel: {
      ...defaultNovel(),
      idea: "邮差寻找姐姐",
      target_words: 50000,
      chapter_words: 1500,
    },
  });
  return project.id;
}
async function command(id: string, action: string, extra: Json = {}) {
  const s = await loadStory(id);
  return controlNovel(id, { action, expected_revision: s.revision, ...extra });
}
async function drain(id: string) {
  for (let i = 0; i < 150; i++) {
    const task = await novelTask(id);
    if (task?.state !== "queued") return task;
    await runNovelTaskStep(id);
  }
  throw new Error("任务未能有界完成");
}
async function planned() {
  const id = await fixture();
  await command(id, "plan");
  await drain(id);
  return id;
}

test("one idea plans a book, writes to its ending in resumable steps, audits by volume and completes only after review", async () => {
  const id = await planned();
  let story = await loadStory(id);
  assert.equal(story.novel.volumes.at(-1)!.end, 34);
  assert.equal(story.chapters.length, 0);
  await assert.rejects(command(id, "complete"), /全书检查/);
  await command(id, "write", { count: 1 });
  assert.equal((await drain(id))!.state, "done");
  story = await loadStory(id);
  assert.equal(story.chapters.filter((c) => c.text).length, 1);
  assert.equal(story.chapters.length, 5);
  assert.equal(story.chapters[0].status, "draft");
  assert.equal(story.chapters[0].memory!.recap, memory.recap);
  await assert.rejects(command(id, "review"), /完成所有章节/);
  await command(id, "write", { count: "all" });
  const task = await drain(id);
  assert.equal(task!.state, "done");
  story = await loadStory(id);
  assert.equal(story.chapters.length, 34);
  assert(isManuscriptReady(story));
  assert.equal(wordCount(manuscriptText(story)) > 50000, true);
  await command(id, "review");
  await runNovelTaskStep(id);
  assert.equal((await novelTask(id))!.reviews!.length, 1);
  await drain(id);
  story = await loadStory(id);
  assert.equal(story.novel.audit!.revision, story.revision);
  await command(id, "complete");
  assert.equal((await loadStory(id)).novel.completed, true);
  assert.equal(
    contexts.filter((c) => c.chapter_number === 34 && c.is_final_chapter)
      .length,
    1,
  );
});

test("manual changes invalidate downstream memory and audit, rebuild memory without rewriting prose, and use bounded context", async () => {
  const id = await planned();
  await command(id, "write", { count: 5 });
  await drain(id);
  let s = await loadStory(id);
  const oldRevision = s.revision;
  const oldText = s.chapters[1].text;
  s.chapters[0].text += "阿遥发现了新的证据。";
  s = (await saveStory(id, { content: s, expected_revision: s.revision }))
    .story;
  assert(s.chapters.slice(0, 5).every((c) => c.needs_review && !c.memory));
  assert.equal(
    (await loadStoryRevision(s.id, oldRevision)).chapters[1].text,
    oldText,
  );
  await command(id, "write", { count: 1 });
  for (let i = 0; i < 5; i++) await runNovelTaskStep(id);
  s = await loadStory(id);
  assert(s.chapters.slice(0, 5).every((c) => c.memory && !c.needs_review));
  assert.equal(s.chapters[1].text, oldText);
  const context = novelContext(s, 5);
  const { previous_ending, ...withoutEnding } = context;
  assert(!JSON.stringify(withoutEnding).includes(prose));
  assert.equal(context.previous_ending, s.chapters[4].text);
  assert(!("text" in context.recent_chapters[0]));
  await command(id, "pause");
  const refs = (
    await database().query(
      "SELECT data FROM story_revisions WHERE story_id=$1 AND revision=$2",
      [s.id, s.revision],
    )
  ).rows[0].data;
  assert(refs.chapters[0].content_ref);
  assert(!refs.chapters[0].text);
  const payloads = (
    await database().query("SELECT hash FROM story_chapter_contents")
  ).rows.length;
  const before = await loadStory(id);
  await saveStory(id, { content: before, expected_revision: before.revision });
  assert.equal(
    (await database().query("SELECT hash FROM story_chapter_contents")).rows
      .length,
    payloads,
  );
});

test("pause discards in-flight output; active tasks block edits; failed steps preserve earlier chapters and can resume", async () => {
  const id = await planned();
  await command(id, "write", { count: 1 });
  let s = await loadStory(id);
  await assert.rejects(
    saveStory(id, { content: s, expected_revision: s.revision }),
    /先暂停/,
  );
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  inject = async (schema) => {
    if (schema.properties.chapters) {
      entered();
      await pending;
    }
    return undefined;
  };
  const running = runNovelTaskStep(id);
  await started;
  await command(id, "pause");
  release();
  await running;
  inject = undefined;
  assert.equal((await loadStory(id)).revision, s.revision);
  assert.equal((await novelTask(id))!.state, "paused");
  await command(id, "resume");
  await runNovelTaskStep(id); // near-term plan
  inject = () => {
    throw new Error("模拟网络中断");
  };
  await runNovelTaskStep(id);
  inject = undefined;
  assert.equal((await novelTask(id))!.state, "failed");
  assert.equal((await loadStory(id)).chapters.filter((c) => c.text).length, 0);
  await command(id, "resume");
  await drain(id);
  assert.equal((await loadStory(id)).chapters.filter((c) => c.text).length, 1);
});

test("memory conflicts pause writing with actionable issues, and restart recovery retains durable progress", async () => {
  const id = await planned();
  await command(id, "write", { count: 1 });
  await drain(id);
  let s = await loadStory(id);
  s.chapters[0].text += "修改了姐姐的去向。";
  await saveStory(id, { content: s, expected_revision: s.revision });
  await command(id, "write", { count: 1 });
  inject = (schema) =>
    schema.properties.memory && !schema.properties.text
      ? {
          summary: "发现新事实",
          memory,
          review: "人物知识冲突",
          issues: ["阿遥尚未收到消息却知道了姐姐的位置。"],
        }
      : undefined;
  await runNovelTaskStep(id);
  inject = undefined;
  assert.equal((await novelTask(id))!.state, "paused");
  assert.equal((await loadStory(id)).chapters[0].issues!.length, 1);
  await assert.rejects(command(id, "resume"), /一致性问题/);
  s = await loadStory(id);
  s.chapters[0].text += "她从来信得知了姐姐的位置。";
  await saveStory(id, { content: s, expected_revision: s.revision });
  await command(id, "resume");
  const stop = await startNovelWorker();
  await stop();
  assert.equal((await novelTask(id))!.state, "paused");
  assert.equal((await loadStory(id)).chapters.filter((c) => c.text).length, 1);
});

test("invalid lengths and chapter ranges cannot be committed; schema enforces integers", async () => {
  assert.throws(
    () => validateSchema(1.2, { type: "integer", minimum: 1 }),
    /数值无效/,
  );
  assert.throws(
    () => validateSchema("", { type: "string", minLength: 1, maxLength: 100 }),
    /文本无效/,
  );
  const id = await fixture();
  const previous = digest(await loadStory(id));
  await command(id, "plan");
  inject = (schema) =>
    schema.properties.volumes
      ? {
          title: "坏计划",
          premise: "构思",
          genre: "悬疑",
          theme: "主题",
          world: "世界",
          characters: "人物",
          outline: "大纲",
          ending: "结局",
          volumes: [
            {
              title: "第一卷",
              start: 2,
              end: 34,
              goal: "追信",
              climax: "发现真相",
              resolution: "回家",
            },
          ],
        }
      : undefined;
  await runNovelTaskStep(id);
  inject = undefined;
  assert.equal((await novelTask(id))!.state, "failed");
  assert.equal(digest(await loadStory(id)), previous);
  await command(id, "resume");
  await drain(id);
  await command(id, "write", { count: 1 });
  await runNovelTaskStep(id);
  inject = (schema) =>
    schema.properties.text
      ? { text: "只是梗概", summary: "摘要", memory, review: "通过" }
      : undefined;
  await runNovelTaskStep(id);
  inject = undefined;
  assert.equal((await novelTask(id))!.state, "failed");
  assert.equal((await loadStory(id)).chapters.filter((c) => c.text).length, 0);
});

test("duplicate chapters and repeated filler paragraphs cannot advance a manuscript", async () => {
  const id = await planned();
  await command(id, "write", { count: 1 });
  await drain(id);
  const first = (await loadStory(id)).chapters[0].text;
  await command(id, "write", { count: 1 });
  inject = (schema) =>
    schema.properties.text
      ? { text: first, summary: "重复上一章", memory, review: "通过" }
      : undefined;
  await runNovelTaskStep(id);
  inject = undefined;
  assert.equal((await novelTask(id))!.state, "failed");
  assert.equal((await loadStory(id)).chapters.filter((c) => c.text).length, 1);
  await command(id, "resume");
  const filler =
    "这是一段不断重复的情节，主角没有遇到任何新的阻碍，也没有作出任何不同的选择，只是为了填满章节的字数。";
  inject = (schema) =>
    schema.properties.text
      ? {
          text: Array(28).fill(filler).join("\n\n"),
          summary: "凑字数",
          memory,
          review: "通过",
        }
      : undefined;
  await runNovelTaskStep(id);
  inject = undefined;
  assert.equal((await novelTask(id))!.state, "failed");
  assert.equal((await loadStory(id)).chapters.filter((c) => c.text).length, 1);
});

test("global novel plan conversation prepares a complete candidate without saving or starting a task", async () => {
  const { project } = await createProject({
    title: "全局浮窗测试",
    brief: "邮差寻找姐姐",
  });
  const form = {
    idea: project.brief,
    target_words: 50000,
    chapter_words: 1500,
  };
  const result = await assistNovelPlan(project.id, {
    form,
    messages: [{ role: "user", text: "帮我生成全书方案" }],
  });
  assert.equal(result.skill, "story");
  assert.equal(await projectStory(project.id), null);
  assert.equal(await novelTask(project.id), null);
  const patch = result.patch as Json;
  assert.equal(patch.novel.idea, project.brief);
  assert.equal(patch.novel.volumes.at(-1).end, 34);
  const { story } = await createStory(project.id, patch);
  assert.equal(story.premise, patch.premise);
  assert.equal(story.world, patch.world);
  assert.equal(story.characters, patch.characters);
  assert.equal(story.outline, patch.outline);
  assert.equal(story.chapters.length, 0);
  assert.equal(await novelTask(project.id), null);
  await assert.rejects(
    assistNovelPlan(project.id, {
      form: { ...form, chapter_words: 1 },
      messages: [{ role: "user", text: "生成" }],
    }),
    /每章篇幅/,
  );
});

test("global writing task conversation returns an operation card and waits for application", async () => {
  const id = await planned();
  const before = await loadStory(id);
  inject = (schema) =>
    schema.properties.action ? { action: "write", count: 5 } : undefined;
  try {
    const result = await assistNovelTask(id, {
      form: { action: "write", count: 1 },
      messages: [{ role: "user", text: "改为连续写五章" }],
    });
    assert.deepEqual(result.patch, { action: "write", count: 5 });
    assert.deepEqual(await loadStory(id), before);
    assert.equal((await novelTask(id))!.state, "done");
  } finally {
    inject = undefined;
  }
});
