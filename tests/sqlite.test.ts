import { assetUsages } from "../src/lib/asset-library";
import { createStory, saveStory, loadStory } from "../src/lib/server/stories";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrate, database, transaction } from "../src/lib/server/db";
import { createProject, mutate, project } from "../src/lib/server/studio";
import {
  loadProject,
  loadJob,
  listJobs,
  saveJob,
} from "../src/lib/server/repository";
import {
  storeConfig,
  publicConfig,
  config,
  updateConfig,
  testConnection,
} from "../src/lib/server/settings";
import { executeJob, videoTask, startWorker } from "../src/lib/server/worker";
import { selected, locate, digest, inputs, type Json } from "../src/lib/domain";
import { ff } from "../src/lib/server/render";
import { conversationTimeline } from "../src/lib/conversation";
let temporary: string, video: Buffer;
const originalFetch = globalThis.fetch;
before(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "frameflow-node-test-"));
  process.env.DATA_DIR = temporary;
  process.env.SQLITE_PATH = path.join(temporary, "test.sqlite3");
  await migrate();
  await fs.mkdir(path.join(temporary, "media"), { recursive: true });
  await storeConfig({
    api_key: "test-only-key",
    wan_api_key: "wan-test-only",
    wan_region: "beijing",
    image_model: "doubao-seedream-5-0-pro-260628",
  });
  await ff([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=navy:s=320x180:r=24:d=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path.join(temporary, "fixture.mp4"),
  ]);
  video = await fs.readFile(path.join(temporary, "fixture.mp4"));
});
after(async () => {
  globalThis.fetch = originalFetch;
  await database().end();
  await fs.rm(temporary, { recursive: true, force: true });
});
test("episode target duration persists and rejects invalid seconds", async () => {
  const { project: p } = await createProject({ title: "分集预设时长" });
  const defaults = await mutate(p.id, "episodes", { title: "默认时长" });
  const custom = await mutate(p.id, "episodes", {
    title: "自定义时长",
    target_duration: 90,
  });
  let saved = await loadProject(p.id);
  assert.equal(
    saved.episodes.find((e) => e.id === defaults.episode_id)?.target_duration,
    60,
  );
  assert.equal(
    saved.episodes.find((e) => e.id === custom.episode_id)?.target_duration,
    90,
  );
  for (const target_duration of [0, -1, 1.5, "90", "", null]) {
    await assert.rejects(
      mutate(p.id, "episodes", { title: "无效时长", target_duration }),
      /预设时长需为大于 0 的整数秒数/,
    );
  }
  saved = await loadProject(p.id);
  assert.equal(saved.episodes.length, 2);
});

async function storyFixture(projectId: string, text = "完整故事") {
  let story = await loadStory(projectId).catch(() => null);
  if (!story) ({ story } = await createStory(projectId, { title: "测试故事" }));
  ({ story } = await saveStory(projectId, {
    expected_revision: story.revision,
    content: {
      ...story,
      chapters: [
        {
          id: "chapter-1",
          title: "第一章",
          summary: "本章提要",
          text,
          status: "draft",
        },
      ],
    },
    confirm_chapter_id: "chapter-1",
  }));
  return {
    story_id: story.id,
    story_revision: story.revision,
    chapter_ids: ["chapter-1"],
  };
}
async function selectFixture(
  f: {
    op: (action: string, b?: Json) => Promise<any>;
    read: () => Promise<any>;
  },
  text: string,
) {
  const { p, r } = await f.read();
  return f.op("select-story", {
    ...(await storyFixture(p.id, text)),
    expected_selected: r.steps.story.selected,
  });
}

async function setup() {
  const { project: p } = await createProject({ title: "Node test" });
  const ids = await mutate(p.id, "episodes", { title: "第1集" });
  const op = (action: string, b: Json = {}) =>
    mutate(p.id, action, { ...ids, ...b });
  await op("select-story", {
    ...(await storyFixture(p.id)),
    expected_selected: null,
  });
  await op("save-step", {
    step: "director",
    adopt: true,
    content: {
      prompt: "统一意图",
      beats: [
        {
          id: "b1",
          start: 0,
          end: 4,
          description: "开场",
          camera: "",
          dialogue: "你好",
        },
        {
          id: "b2",
          start: 4,
          end: 8,
          description: "结尾",
          camera: "",
          dialogue: "再见",
        },
      ],
      segments: [
        {
          id: "A",
          title: "开场",
          start: 0,
          end: 4,
          prompt: "完整片段A",
          beat_ids: ["b1"],
          references: [],
          depends_on: [],
          mode: "reference",
        },
        {
          id: "B",
          title: "结尾",
          start: 4,
          end: 8,
          prompt: "完整片段B",
          beat_ids: ["b2"],
          references: [],
          depends_on: [],
          mode: "reference",
        },
      ],
    },
  });
  await op("approve-step", { step: "director" });
  await op("save-step", {
    step: "characters",
    content: { world: { premise: "测试" }, characters: [] },
    adopt: true,
  });
  await op("approve-step", { step: "characters" });
  return {
    pid: p.id,
    ids,
    op,
    read: async () => {
      const loaded = await loadProject(p.id);
      return { p: loaded, ...locate(loaded, ids.episode_id, ids.run_id) };
    },
  };
}
function toolReply(value: Json, body: Json) {
  if (body.tools) {
    if (body.tool_choice === "none" || !value.proposal)
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: value.reply } }],
      });
    return Response.json({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: "call-test",
                type: "function",
                function: {
                  name: "save_stage_draft",
                  arguments: JSON.stringify({
                    target_step: value.target_step,
                    proposal: value.proposal,
                  }),
                },
              },
            ],
          },
        },
      ],
    });
  }
  return Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(value) } },
    ],
  });
}
function mockText(value: Json) {
  globalThis.fetch = async (_url, init) =>
    toolReply(value, JSON.parse(String(init?.body)));
}

test("model roles and service connections save independently, route calls, and apply video defaults only to new schemes", async () => {
  const original = await config();
  try {
    const f = await setup();
    const existingModel = (await f.read()).r.model;
    await Promise.all([
      updateConfig({
        section: "models",
        model: "wan2.6-t2v",
        text_provider: "compatible",
        text_model: "copy-test-model",
        agent_provider: "ark",
        agent_model: "agent-test-model",
        image_model: "doubao-seedream-5-0-flash-260915",
      }),
      updateConfig({
        section: "connections",
        llm_api_key: "compatible-test-key",
        llm_base_url: "https://text.test/v1/",
        api_key: "test-only-key",
      }),
    ]);
    const saved = await config();
    assert.equal(saved.text_model, "copy-test-model");
    assert.equal(saved.llm_base_url, "https://text.test/v1");
    assert.equal(saved.api_key, "test-only-key");
    assert.equal(saved.llm_api_key, "compatible-test-key");
    assert.equal(saved.image_model, "doubao-seedream-5-0-flash-260915");
    await storeConfig({
      ...saved,
      storyboard_model: "unused-storyboard-model",
      storyboard_provider: "wan",
      resource_model: "unused-resource-model",
      resource_provider: "wan",
    });
    const resolved = await config();
    const visible = await publicConfig();
    for (const field of [
      "storyboard_model",
      "storyboard_provider",
      "resource_model",
      "resource_provider",
    ]) {
      assert.equal(Object.hasOwn(resolved, field), false);
      assert.equal(Object.hasOwn(visible, field), false);
    }
    assert(
      visible.text_configured &&
        visible.agent_configured &&
        visible.compatible_configured,
    );
    assert(!JSON.stringify(visible).includes("compatible-test-key"));
    await updateConfig({
      section: "models",
      text_model: "copy-test-model",
      api_key: "ignored-key",
    });
    await updateConfig({
      section: "connections",
      api_key: "",
      agent_model: "ignored-model",
    });
    assert.equal((await config()).api_key, "test-only-key");
    assert.equal((await config()).agent_model, "agent-test-model");
    for (const body of [
      { model: "unsupported" },
      { text_provider: "unknown" },
      { agent_model: " " },
      { llm_base_url: "https://user:pass@service.test/v1" },
    ]) {
      await assert.rejects(updateConfig(body));
    }
    const calls: { url: string; model: string; auth: string }[] = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push({
        url: String(url),
        model: body.model,
        auth: (init?.headers as Json).Authorization,
      });
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                reply: "已整理",
                target_step: "director",
                proposal: selected((await f.read()).r, "director")!.content,
              }),
            },
          },
        ],
      });
    };
    const copyJob = await f.op("generate-text", { step: "director" });
    await executeJob(await loadJob(copyJob.job_id));
    const assistantJob = await f.op("chat", {
      step: "assistant",
      message: "改写故事",
    });
    await executeJob(await loadJob(assistantJob.job_id));
    assert.deepEqual(calls, [
      {
        url: "https://text.test/v1/chat/completions",
        model: "copy-test-model",
        auth: "Bearer compatible-test-key",
      },
      {
        url: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
        model: "agent-test-model",
        auth: "Bearer test-only-key",
      },
    ]);
    assert.equal((await f.read()).r.model, existingModel);
    const freshEpisode = await mutate(f.pid, "episodes", { title: "新的分集" });
    const freshRun = await f.op("runs", { inherit: "empty", name: "新的方案" });
    const loaded = await loadProject(f.pid);
    assert.equal(
      locate(loaded, freshEpisode.episode_id, freshEpisode.run_id).r.model,
      "wan2.6-t2v",
    );
    assert.equal(
      locate(loaded, f.ids.episode_id, freshRun.run_id).r.model,
      "wan2.6-t2v",
    );
  } finally {
    globalThis.fetch = originalFetch;
    await storeConfig(original);
  }
});
test("connection tests use unsaved or stored credentials without saving, generating, or exposing upstream secrets", async () => {
  const original = await config();
  try {
    const requests: { url: string; options?: RequestInit }[] = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({ data: [{ id: "test" }] });
    };
    const checked = await testConnection({
      provider: "ark",
      api_key: "unsaved-test-key",
    });
    assert(checked.ok);
    assert.equal(checked.model_count, 1);
    assert.equal(
      requests[0].url,
      "https://ark.cn-beijing.volces.com/api/v3/models",
    );
    assert.equal(
      (requests[0].options!.headers as Json).Authorization,
      "Bearer unsaved-test-key",
    );
    await testConnection({ provider: "wan", wan_region: "singapore" });
    await testConnection({
      provider: "compatible",
      api_key: "compatible-unsaved-key",
      base_url: "https://unsaved.test/v1/",
    });
    assert.equal(
      requests[1].url,
      "https://dashscope-intl.aliyuncs.com/api/v1/models",
    );
    assert.equal(requests[2].url, "https://unsaved.test/v1/models");
    assert(
      requests.every(
        (r) =>
          !r.options?.body &&
          !r.options?.method &&
          r.options?.redirect === "error",
      ),
    );
    assert.deepEqual(await config(), original);
    for (const status of [401, 403, 404, 500]) {
      globalThis.fetch = async () =>
        new Response("upstream-secret-test-only-key", { status });
      await assert.rejects(
        testConnection({ provider: "ark" }),
        (e: Error) =>
          e.message.includes(String(status)) &&
          !e.message.includes("test-only-key"),
      );
    }
    globalThis.fetch = async () =>
      Response.json({ message: "not a model list" });
    await assert.rejects(testConnection({ provider: "ark" }), /有效的模型列表/);
    globalThis.fetch = async () => {
      throw new Error("request containing test-only-key failed");
    };
    await assert.rejects(
      testConnection({ provider: "ark" }),
      (e: Error) =>
        /连接失败或超时/.test(e.message) &&
        !e.message.includes("test-only-key"),
    );
    await assert.rejects(testConnection({ provider: "unknown" }), /服务不支持/);
    await assert.rejects(
      testConnection({
        provider: "compatible",
        base_url: "https://service.test/v1?api_key=secret",
        api_key: "test",
      }),
      /服务地址/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("SQLite stores relational entities, serializes concurrent edits and supports copied version IDs", async () => {
  const f = await setup();
  await Promise.all([
    f.op("save-step", {
      step: "director",
      content: {
        ...selected((await f.read()).r, "director")!.content,
        prompt: "候选A",
      },
    }),
    f.op("save-step", {
      step: "director",
      content: {
        ...selected((await f.read()).r, "director")!.content,
        prompt: "候选B",
      },
    }),
  ]);
  const { r } = await f.read();
  assert.equal(r.steps.director.versions.length, 3);
  assert.equal(new Set(r.steps.director.versions.map((v) => v.number)).size, 3);
  const fork = await f.op("runs", { inherit: "all", name: "另一方案" });
  const p = await loadProject(f.pid);
  const copied = locate(p, f.ids.episode_id, fork.run_id).r;
  assert.equal(copied.steps.director.selected, r.steps.director.selected);
  assert.equal(copied.steps.director.versions.length, 3);
  assert.equal(
    (
      await database().query(
        "SELECT count(*) n FROM production_runs WHERE project_id=$1",
        [f.pid],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await database().query(
        "SELECT count(*) n FROM content_versions WHERE run_id=$1",
        [copied.id],
      )
    ).rows[0].n,
    5,
  );
});
test("discussion does not create a version and late proposals do not override a newer selection", async () => {
  const f = await setup();
  const content = selected((await f.read()).r, "director")!.content;
  const discussion = await f.op("chat", {
    step: "director",
    message: "讨论方向",
  });
  mockText({ reply: "讨论建议", proposal: null });
  await executeJob(await loadJob(discussion.job_id));
  assert.equal((await f.read()).r.steps.director.versions.length, 1);
  const draft = await f.op("chat", { step: "director", message: "整理新稿" });
  const edited = await f.op("save-step", {
    step: "director",
    content: { ...content, prompt: "用户的新版本" },
    adopt: true,
  });
  mockText({ reply: "草稿已整理", proposal: { ...content, prompt: "AI候选" } });
  await executeJob(await loadJob(draft.job_id));
  const { r } = await f.read();
  assert.equal(r.steps.director.selected, edited.version_id);
  assert.equal(r.steps.director.versions.at(-1)!.content.prompt, "AI候选");
  assert.equal(r.conversations.director.length, 4);
  globalThis.fetch = originalFetch;
});

test("shared video assistant reads selected story sources and routes only production drafts", async () => {
  const f = await setup();
  const before = (await f.read()).r;
  const queued = await f.op("chat", {
    step: "assistant",
    page_context: "characters",
    message: "根据故事修改分镜",
  });
  let context: Json = {};
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    context = JSON.parse(body.messages[1].content);
    assert(!context.available_draft_targets.includes("story"));
    assert(!Object.hasOwn(context.output_shape, "story"));
    return toolReply(
      {
        reply: "分镜草稿已整理",
        target_step: "director",
        proposal: {
          ...selected(before, "director")!.content,
          prompt: "改编分镜候选",
        },
      },
      body,
    );
  };
  await executeJob(await loadJob(queued.job_id));
  const { r } = await f.read();
  assert.equal(context.current_page, "characters");
  assert(context.approved_story.source.story_id);
  assert.deepEqual(r.steps.story, before.steps.story);
  assert.equal(r.steps.director.selected, before.steps.director.selected);
  assert.equal(
    r.steps.director.versions.at(-1)!.content.prompt,
    "改编分镜候选",
  );
  globalThis.fetch = originalFetch;
});

test("shared discussion works before approvals but proposals still enforce prerequisites and valid destinations", async () => {
  const { project: p } = await createProject({ title: "空白创作" });
  const ids = await mutate(p.id, "episodes", { title: "新分集" });
  const chat = () =>
    mutate(p.id, "chat", {
      ...ids,
      step: "assistant",
      page_context: "characters",
      message: "讨论角色和故事",
    });
  const discussion = await chat();
  mockText({ reply: "先讨论创意", target_step: null, proposal: null });
  await executeJob(await loadJob(discussion.job_id));
  assert.equal((await loadJob(discussion.job_id)).message, "回复已完成");
  let r = locate(await loadProject(p.id), ids.episode_id, ids.run_id).r;
  assert.equal(r.steps.story.versions.length, 0);
  assert.equal(r.conversations.assistant.length, 2);
  for (const target of [
    "director",
    "characters",
    "generation",
    "assistant",
    null,
  ]) {
    const queued = await chat();
    mockText({
      reply: "尝试生成",
      target_step: target,
      proposal: { text: "不应保存" },
    });
    await assert.rejects(
      executeJob(await loadJob(queued.job_id)),
      /请先更新并确认|有效的目标阶段|不支持此值|文本无效/,
    );
    const job = await loadJob(queued.job_id);
    job.state = "failed";
    await saveJob(job);
  }
  r = locate(await loadProject(p.id), ids.episode_id, ids.run_id).r;
  assert.equal(Object.values(r.steps).flatMap((s) => s.versions).length, 0);
  globalThis.fetch = originalFetch;
});
test("shared plan and settings drafts keep their target dependencies without changing adopted versions", async () => {
  const f = await setup();
  for (const step of ["director", "characters"]) {
    const { p, r } = await f.read();
    const adopted = selected(r, step)!;
    const queued = await f.op("chat", {
      step: "assistant",
      page_context: "finish",
      message: `整理${step}草稿`,
    });
    mockText({
      reply: "已整理草稿",
      target_step: step,
      proposal: structuredClone(adopted.content),
    });
    await executeJob(await loadJob(queued.job_id));
    const latest = (await f.read()).r;
    assert.equal(latest.steps[step].selected, adopted.id);
    assert.equal(latest.steps[step].versions.length, 2);
    assert.deepEqual(
      latest.steps[step].versions.at(-1)!.inputs,
      inputs(p, r, step),
    );
    assert.equal(latest.conversations.assistant.at(-1)!.target_step, step);
  }
  globalThis.fetch = originalFetch;
});
test("uncertain video creation is recorded and never submitted twice", async () => {
  const f = await setup();
  const result = await f.op("generate-video", { segment_id: "A" });
  const j = await loadJob(result.job_id);
  let posts = 0;
  globalThis.fetch = async () => {
    posts++;
    throw new Error("simulated timeout");
  };
  await assert.rejects(videoTask(j));
  const saved = await loadJob(j.id);
  assert(saved.submit_attempted);
  await assert.rejects(videoTask(saved));
  assert.equal(posts, 1);
  saved.state = "failed";
  await saveJob(saved);
  await assert.rejects(f.op("resume", { job_id: j.id }));
  globalThis.fetch = originalFetch;
});
test("full Node workflow creates candidates, explicitly adopts them and exports with real FFmpeg and aligned subtitles", async () => {
  const f = await setup();
  let submitted = 0;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/contents/generations/tasks")) {
      submitted++;
      return Response.json({ id: "remote_" + submitted });
    }
    if (target.includes("/contents/generations/tasks/"))
      return Response.json({
        status: "succeeded",
        content: { video_url: "https://provider.example/video.mp4" },
        duration: 4,
      });
    if (target.endsWith("/video.mp4"))
      return new Response(new Uint8Array(video));
    if (target.endsWith("/responses")) {
      const body = JSON.parse(String(options?.body));
      const prompt = body.input[0].content.find(
        (c: Json) => c.type === "input_text",
      ).text;
      assert(
        body.input[0].content[0].audio_url.startsWith(
          "data:audio/mpeg;base64,",
        ),
      );
      return Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  cues: [
                    {
                      start: 0,
                      end: 1,
                      text: prompt.includes("再见") ? "再见" : "你好",
                    },
                  ],
                }),
              },
            ],
          },
        ],
      });
    }
    throw Error("unexpected test request");
  };
  for (const sid of ["A", "B"]) {
    const result = await f.op("generate-video", { segment_id: sid });
    await executeJob(await loadJob(result.job_id));
    let { r } = await f.read();
    assert.equal(r.media_selection[sid], undefined);
    await f.op("adopt-media", {
      segment_id: sid,
      version_id: r.media[sid][0].id,
    });
  }
  assert.equal(
    (await project(f.pid)).project.episodes[0].runs[0].statuses!.generation,
    "approved",
  );
  const output = await f.op("finish", { caption_mode: "none" });
  await executeJob(await loadJob(output.job_id));
  const old = (await f.read()).r.exports[0];
  assert(
    (await fs.stat(path.join(temporary, "media", old.content.file))).size > 32,
  );
  const subtitles = await f.op("finish", { caption_mode: "align" });
  await executeJob(await loadJob(subtitles.job_id));
  const { r } = await f.read();
  assert.equal(r.exports.length, 2);
  const final = r.exports[1];
  assert.equal(final.content.cues[1].start, 4);
  const srt = await fs
    .readFile(path.join(temporary, final.content.srt_url), "utf8")
    .catch(() =>
      fs.readFile(
        path.join(temporary, final.content.srt_url.replace(/^\//, "")),
        "utf8",
      ),
    );
  assert(srt.includes("00:00:04,000"));
  assert(final.content.master_url);
  assert.equal(submitted, 2);
  globalThis.fetch = originalFetch;
});
test("API projections exclude credentials and private task snapshots", async () => {
  const f = await setup();
  const j = await f.op("chat", { step: "director", message: "讨论" });
  const jobs = await listJobs(f.pid);
  assert.equal(jobs[0].snapshot, undefined);
  assert.equal(jobs[0].payload, undefined);
  const raw = (
    await database().query("SELECT encrypted FROM settings WHERE id='models'")
  ).rows[0].encrypted;
  assert(!raw.includes("test-only-key"));
  const config = await publicConfig();
  assert(config.video_configured);
  assert(!JSON.stringify(config).includes("test-only-key"));
});

test("a failed batch resumes its remote child and preserves completed candidates without resubmission", async () => {
  const f = await setup();
  const preview = await f.op("preview-video-batch");
  const queued = await f.op("generate-all-videos", {
    preview_token: preview.token,
  });
  let posts = 0;
  let interrupt = true;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/contents/generations/tasks"))
      return Response.json({ id: "batch_" + ++posts });
    if (target.endsWith("/batch_2") && interrupt)
      throw Error("simulated query interruption");
    if (target.includes("/contents/generations/tasks/"))
      return Response.json({
        status: "succeeded",
        content: { video_url: "https://provider.example/batch.mp4" },
      });
    if (target.endsWith("/batch.mp4"))
      return new Response(new Uint8Array(video));
    throw Error("unexpected test request");
  };
  const initial = await loadJob(queued.job_id);
  await assert.rejects(executeJob(initial));
  initial.state = "failed";
  await saveJob(initial);
  assert.equal(Object.keys(initial.results).length, 1);
  assert.equal((await f.read()).r.media_selection.A, undefined);
  interrupt = false;
  await f.op("resume-video-batch", { job_id: initial.id });
  await executeJob(await loadJob(initial.id));
  assert.equal(posts, 2);
  const done = await loadJob(initial.id);
  assert.equal(done.state, "done");
  assert.equal((await f.read()).r.media_selection.A, undefined);
  await f.op("adopt-video-batch", { job_id: done.id });
  assert.equal(
    (await project(f.pid)).project.episodes[0].runs[0].statuses!.generation,
    "approved",
  );
  globalThis.fetch = originalFetch;
});

test("worker recovers interruptions, has a single lease and completes a queued job once", async () => {
  await database().query(
    "UPDATE jobs SET state='failed' WHERE state IN ('queued','running')",
  );
  const f = await setup();
  const interrupted = await f.op("chat", {
    step: "director",
    message: "旧任务",
  });
  const j = await loadJob(interrupted.job_id);
  j.state = "running";
  await saveJob(j);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({ reply: "建议", proposal: null }),
          },
        },
      ],
    });
  };
  const stop = await startWorker();
  const stopOther = await startWorker();
  try {
    assert.equal((await loadJob(j.id)).state, "failed");
    const queued = await f.op("chat", { step: "director", message: "新任务" });
    const deadline = Date.now() + 5000;
    while (
      (await loadJob(queued.job_id)).state !== "done" &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await loadJob(queued.job_id)).state, "done");
    assert.equal(calls, 1);
  } finally {
    await stopOther();
    await stop();
    globalThis.fetch = originalFetch;
  }
});

test("an uncertain single image submission cannot be silently resubmitted", async () => {
  const f = await setup();
  await f.op("save-step", {
    step: "characters",
    adopt: true,
    content: {
      world: { premise: "测试" },
      characters: [
        {
          asset_id: "hero",
          version: "hero-v1",
          kind: "character",
          name: "主角",
          description: "蓝衣少年",
          images: [],
          url: "",
          segment_ids: ["A"],
        },
      ],
    },
  });
  await f.op("character-image", { asset_id: "hero" });
  const j = (await listJobs(f.pid, database(), true))[0];
  let submitted = 0;
  globalThis.fetch = async () => {
    submitted++;
    throw Error("simulated image timeout");
  };
  await assert.rejects(executeJob(j));
  const partial = await loadJob(j.id);
  partial.state = "failed";
  await saveJob(partial);
  assert.equal(partial.images.length, 0);
  assert.deepEqual(partial.attempted_poses, ["character-sheet"]);
  await assert.rejects(
    f.op("character-image", { asset_id: "hero", resume_job_id: j.id }),
  );
  await assert.rejects(executeJob(await loadJob(j.id)), /结果不确定/);
  assert.equal(submitted, 1);
  assert.equal(
    (await f.read()).r.steps.characters.versions.at(-1)!.content.characters[0]
      .images.length,
    0,
  );
  globalThis.fetch = originalFetch;
});

function formToolReply(body: Json, patch: Json, name?: string) {
  return Response.json({
    choices: [
      {
        finish_reason: body.tool_choice === "none" ? "stop" : "tool_calls",
        message:
          body.tool_choice === "none"
            ? { content: "已整理候选稿，请检查后应用。" }
            : {
                content: null,
                tool_calls: [
                  {
                    id: "form-call",
                    type: "function",
                    function: {
                      name: name || body.tools[0].function.name,
                      arguments: JSON.stringify(patch),
                    },
                  },
                ],
              },
      },
    ],
  });
}

test("project assistant creates only name and description cards and does not save them", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const count = (await database().query("SELECT count(*) AS n FROM projects"))
    .rows[0].n;
  const sent: Json[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    return formToolReply(body, {
      title: "未来武侠",
      brief: "一部以未来江湖为背景的作品。",
    });
  };
  try {
    const result = await assistForm({
      skill: "project",
      form: { title: "", brief: "未来武侠" },
      messages: [{ role: "user", text: "完善项目名称和简介" }],
    });
    assert.equal(result.tool, "update_project_form");
    assert.deepEqual(
      Object.keys(sent[0].tools[0].function.parameters.properties),
      ["title", "brief"],
    );
    assert.equal(
      (await database().query("SELECT count(*) AS n FROM projects")).rows[0].n,
      count,
    );
    const { project: created } = await createProject(result.patch!);
    const loaded = await loadProject(created.id);
    assert.equal(loaded.brief, result.patch!.brief);
    assert.deepEqual(loaded.production, {
      style: "电影写实",
      ratio: "16:9",
      prompt: "",
      adaptation: "",
      revision: 0,
    });
    assert.equal(Object.hasOwn(loaded, "style"), false);
    assert.equal(Object.hasOwn(loaded, "creative_prompt"), false);
    globalThis.fetch = async (_url, init) =>
      formToolReply(JSON.parse(String(init?.body)), { style: "不应混入项目" });
    await assert.rejects(
      assistForm({
        skill: "project",
        form: {},
        messages: [{ role: "user", text: "完善" }],
      }),
      /未授权字段/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("project-level production cards recover from missing episode reads without saving", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const { project: p } = await createProject({ title: "无需分集的制作设置" });
  const frozen = digest(await loadProject(p.id));
  const patch = {
    prompt: "柔和侧光与低饱和色彩",
    adaptation: "以人物视角叙事",
  };
  try {
    for (const mode of ["prompt", "form"]) {
      let calls = 0;
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        calls++;
        if (calls === 1) return formToolReply(body, {}, "get_workflow_status");
        if (calls === 2) {
          const failed = JSON.parse(body.messages.at(-1).content);
          assert.equal(failed.executed, false);
          assert.match(failed.error, /请指定要读取的分集/);
          return formToolReply(body, {}, "get_project_context");
        }
        if (calls === 3) {
          const context = JSON.parse(body.messages.at(-1).content);
          assert.deepEqual(context.episodes, []);
          assert.deepEqual(context.production, p.production);
          return formToolReply(body, patch, "update_production_form");
        }
        return formToolReply(body, {});
      };
      const result = await assistForm({
        ...(mode === "prompt"
          ? {
              mode,
              context_scope: { project_id: p.id },
              form_source: { skill: "production", form: p.production },
            }
          : { project_id: p.id, skill: "production", form: p.production }),
        messages: [
          { role: "user", text: "使用 @skill:production，完善制作设置" },
        ],
      });
      assert.equal(calls, 4);
      assert.deepEqual(result.patch, patch);
      assert.equal(result.tool, "update_production_form");
      assert.equal(digest(await loadProject(p.id)), frozen);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed creation reads consume the budget and unexpected errors still propagate", async () => {
  const { runCreationAgent } = await import("../src/lib/server/creation-agent");
  const { AppError } = await import("../src/lib/domain");
  let reads = 0;
  let failure: Error = new AppError("缺少分集");
  const request = {
    instructions: "生成卡片",
    context: {},
    messages: [{ role: "user", text: "生成" }],
    maxReads: 1,
    tools: [
      {
        name: "read",
        readOnly: true,
        description: "读取",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute() {
          reads++;
          throw failure;
        },
      },
    ],
  };
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.tool_choice === "none") {
        assert.equal(JSON.parse(body.messages.at(-1).content).executed, false);
        return formToolReply(body, {});
      }
      return formToolReply(body, {}, "read");
    };
    await runCreationAgent(request);
    assert.equal(reads, 1);
    for (failure of [
      new Error("database unavailable"),
      new AppError("forbidden", 403),
    ]) {
      await assert.rejects(
        runCreationAgent(request),
        (error) => error === failure,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("production cards feed video, storyboard and image requests without editing project descriptions", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const { projectPrompt } = await import("../src/lib/creative-spec");
  const { videoPayload } = await import("../src/lib/server/providers");
  const f = await setup();
  let { p, r } = await f.read();
  const patch = {
    style: "水彩插画",
    ratio: "9:16",
    prompt: "暖橙色夕光与手绘纸张纹理",
    adaptation: "保留来信情节，以人物视角展开",
  };
  const frozen = digest(p);
  globalThis.fetch = async (_url, init) =>
    formToolReply(JSON.parse(String(init?.body)), patch);
  try {
    const result = await assistForm({
      project_id: p.id,
      skill: "production",
      form: p.production,
      messages: [{ role: "user", text: "完善制作设置" }],
    });
    assert.deepEqual(result.patch, patch);
    assert.equal(digest(await loadProject(p.id)), frozen);
    await mutate(p.id, "production-settings", {
      ...patch,
      base_revision: p.production.revision,
    });
    const saved = await loadProject(p.id);
    assert.equal(saved.title, p.title);
    assert.equal(saved.brief, p.brief);
    // Fresh ready stages use the saved settings in every downstream request.
    const ready = await setup();
    ({ p, r } = await ready.read());
    const { saveProject } = await import("../src/lib/server/repository");
    p.production = { ...patch, revision: 0 };
    await saveProject(p);
    const expected = projectPrompt(p);
    for (const skill of [
      "episode",
      "run",
      "asset",
      "director",
      "settings",
      "beat",
      "segment",
      "world",
      "entry",
      "finish",
    ]) {
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(
          JSON.parse(body.messages[1].content).project.production_prompt,
          expected,
        );
        return Response.json({
          choices: [
            { finish_reason: "stop", message: { content: "讨论制作要求" } },
          ],
        });
      };
      await assistForm({
        project_id: p.id,
        ...ready.ids,
        skill,
        form: {},
        messages: [{ role: "user", text: "讨论当前制作要求" }],
      });
    }
    const payload = JSON.stringify(
      (await videoPayload(p, r, selected(r, "director")!.content.segments[0]))
        .payload,
    );
    for (const value of Object.values(patch)) assert(payload.includes(value));
    const { asset_id } = await mutate(p.id, "asset", {
      kind: "prop",
      name: "信封",
      description: "旧信封",
    });
    const { job_id } = await mutate(p.id, "asset-image", { asset_id });
    const job = await loadJob(job_id);
    assert.equal(job.snapshot.project_prompt, expected);
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert(body.prompt.includes(expected));
      return Response.json({
        data: [
          { b64_json: Buffer.from([255, 216, 255, 217]).toString("base64") },
        ],
      });
    };
    await executeJob(job);
    assert.equal((await loadJob(job_id)).state, "done");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creation form cards remain available when the selected source scheme has ended", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const { saveProject } = await import("../src/lib/server/repository");
  const f = await setup();
  const { p, r } = await f.read();
  r.finished_at = Date.now() / 1000;
  await saveProject(p);
  const frozen = digest(await loadProject(p.id));
  let calls = 0;
  try {
    for (const [skill, patch] of [
      ["episode", { title: "第二集", brief: "新的冒险" }],
      ["run", { name: "继续创作" }],
      ["asset", { name: "新角色", description: "一位旅人" }],
      ["project", { title: "新的项目" }],
    ] as const) {
      globalThis.fetch = async (_url, init) => {
        calls++;
        return formToolReply(JSON.parse(String(init?.body)), patch);
      };
      const result = await assistForm({
        project_id: p.id,
        ...f.ids,
        skill,
        form: {},
        messages: [{ role: "user", text: "生成结果卡片" }],
      });
      assert.deepEqual(result.patch, patch);
      assert.equal(result.tool, `update_${skill}_form`);
    }
    // New episodes only need project context, with no existing episode/run.
    globalThis.fetch = async (_url, init) =>
      formToolReply(JSON.parse(String(init?.body)), {
        title: "第二集",
        brief: "新的冒险",
      });
    const episode = await assistForm({
      project_id: p.id,
      skill: "episode",
      form: { title: "", brief: "" },
      messages: [{ role: "user", text: "生成分集大纲" }],
    });
    assert.equal(episode.patch?.title, "第二集");
    await assert.rejects(
      assistForm({
        project_id: p.id,
        ...f.ids,
        skill: "story",
        form: { text: "原文" },
        messages: [{ role: "user", text: "改写已结束方案" }],
      }),
      /故事创作已独立/,
    );
    assert(calls > 0);
    assert.equal(digest(await loadProject(p.id)), frozen);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creation agent reads workflow and selected chapters before preparing a director card", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const f = await setup();
  const { r } = await f.read();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls++;
    if (calls === 1) return formToolReply(body, {}, "get_workflow_status");
    if (calls === 2) {
      assert.equal(
        JSON.parse(body.messages.at(-1).content).stages.story.status,
        "approved",
      );
      return formToolReply(body, { stage: "story" }, "get_stage_content");
    }
    if (calls === 3) {
      assert(
        JSON.parse(body.messages.at(-1).content).approved_version.content.source
          .story_id,
      );
      return formToolReply(
        body,
        { prompt: "根据选章改编的分镜" },
        "update_director_form",
      );
    }
    return formToolReply(body, {});
  };
  try {
    const result = await assistForm({
      skill: "director",
      project_id: f.pid,
      ...f.ids,
      form: selected(r, "director")!.content,
      messages: [{ role: "user", text: "根据已有章节改编" }],
    });
    assert.equal(calls, 4);
    assert.equal(result.patch!.prompt, "根据选章改编的分镜");
    assert.equal(
      selected((await f.read()).r, "director")!.content.prompt,
      "统一意图",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creation agent handles batched tool calls sequentially and enforces read/write limits", async () => {
  const { runCreationAgent } = await import("../src/lib/server/creation-agent");
  const executed: string[] = [];
  const requests: Json[] = [];
  let batch: string[] = [];
  const tools = ["read", "write"].map((name) => ({
    name,
    description: name,
    readOnly: name === "read",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      additionalProperties: false,
    },
    async execute(value: Json) {
      executed.push(`${name}:${value.text}`);
      return { text: value.text };
    },
  }));
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    assert.equal(body.parallel_tool_calls, false);
    return Response.json({
      choices: [
        requests.length === 1
          ? {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: batch.map((name, index) => ({
                  id: `batch-${index}`,
                  type: "function",
                  function: {
                    name,
                    arguments: JSON.stringify({ text: String(index) }),
                  },
                })),
              },
            }
          : {
              finish_reason: "stop",
              message: { content: "已准备好结果卡片。" },
            },
      ],
    });
  };
  try {
    for (const names of [
      ["read", "read", "write", "write", "read"],
      [...Array(7).fill("read"), "write"],
    ]) {
      batch = names;
      executed.length = 0;
      requests.length = 0;
      const result = await runCreationAgent({
        instructions: "生成结果卡片",
        context: {},
        messages: [{ role: "user", text: "生成" }],
        tools,
      });
      const readCount = Math.min(batch.indexOf("write"), 6);
      assert.deepEqual(executed, [
        ...Array.from({ length: readCount }, (_, i) => `read:${i}`),
        `write:${batch.indexOf("write")}`,
      ]);
      assert.equal(result.results.length, 1);
      assert.equal(requests[1].tool_choice, "none");
      const replies = requests[1].messages.filter(
        (message: Json) => message.role === "tool",
      );
      assert.deepEqual(
        replies.map((message: Json) => message.tool_call_id),
        batch.map((_, i) => `batch-${i}`),
      );
      assert(
        replies.some((message: Json) =>
          message.content.includes('"executed":false'),
        ),
      );
    }
    // Validate the complete batch before executing even the first write.
    batch = ["write", "unauthorized"];
    executed.length = 0;
    requests.length = 0;
    await assert.rejects(
      runCreationAgent({ instructions: "", context: {}, messages: [], tools }),
      /未授权工具/,
    );
    assert.deepEqual(executed, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("prompt conversations use sent skills without loading hidden page context", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const sent: Json[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    sent.push(body);
    return body.tools?.some(
      (tool: Json) => tool.function.name === "update_episode_form",
    ) && body.tool_choice !== "none"
      ? formToolReply(
          body,
          { title: "旅行", brief: "太空旅行" },
          "update_episode_form",
        )
      : Response.json({
          choices: [
            { finish_reason: "stop", message: { content: "聊聊吧。" } },
          ],
        });
  };
  try {
    // Invalid IDs and legacy fields must not be read or used as instructions.
    const hidden = {
      skill: "episode",
      project_id: "nonexistent-project",
      episode_id: "nonexistent-episode",
      run_id: "nonexistent-run",
      form: { brief: "隐藏剧情，不应发送" },
      local_context: { text: "隐藏上下文，不应发送" },
    };
    const plain = await assistForm({
      ...hidden,
      mode: "prompt",
      messages: [{ role: "user", text: "只聊星空，不生成表单" }],
    });
    assert.equal(plain.patch, null);
    assert.deepEqual(plain.prompt_trace.loaded_skills, []);
    assert(
      !sent[0].tools.some((tool: Json) =>
        tool.function.name.startsWith("update_"),
      ),
    );
    assert.deepEqual(JSON.parse(sent[0].messages[1].content), {});
    const story = await assistForm({
      ...hidden,
      mode: "prompt",
      messages: [{ role: "user", text: "使用 @skill:episode，写太空旅行故事" }],
    });
    assert.equal(story.skill, "episode");
    assert.deepEqual(story.patch, { title: "旅行", brief: "太空旅行" });
    assert.deepEqual(story.prompt_trace.loaded_skills, ["episode"]);
    assert.deepEqual(
      sent[1].tools
        .filter((tool: Json) => tool.function.name.startsWith("update_"))
        .map((tool: Json) => tool.function.name),
      ["update_episode_form"],
    );
    assert(!JSON.stringify(sent).includes("隐藏剧情，不应发送"));
    assert(!JSON.stringify(sent).includes("隐藏上下文，不应发送"));
    assert(!JSON.stringify(sent).includes("nonexistent-project"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("episode generation reads drafts and previous episodes without asking for a summary, then supports follow-ups", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const { saveProject } = await import("../src/lib/server/repository");
  const f = await setup();
  const { p, r } = await f.read();
  p.brief = "未来武侠";
  r.finished_at = Date.now() / 1000;
  await saveProject(p);
  const frozen = digest(await loadProject(p.id));
  const requests: Json[] = [];
  const initial = {
    role: "user",
    text: "使用 @skill:episode，完善集名与本集剧情，生成结果卡片",
  };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (requests.length === 1) {
      assert.equal(body.tool_choice, "required");
      return formToolReply(body, {}, "get_current_form");
    }
    if (requests.length === 2) {
      const draft = JSON.parse(body.messages.at(-1).content);
      assert.equal(draft.current_form.target_duration, 45);
      assert.equal(draft.current_form.title, "待完善集名");
      return formToolReply(body, {}, "get_project_context");
    }
    if (requests.length === 3) {
      const context = JSON.parse(body.messages.at(-1).content);
      assert.equal(context.brief, "未来武侠");
      assert(context.episodes[0].runs[0].finished_at);
      return formToolReply(
        body,
        { ...f.ids, stage: "story" },
        "get_stage_content",
      );
    }
    if (requests.length === 4) {
      const story = JSON.parse(body.messages.at(-1).content);
      assert.equal(story.approved_version.content.text, "第一章\n\n完整故事");
      return formToolReply(
        body,
        { title: "第二集：追踪", brief: "承接前集的追踪行动" },
        "update_episode_form",
      );
    }
    assert.equal(body.tool_choice, "none");
    return formToolReply(body, {});
  };
  try {
    const first = await assistForm({
      mode: "prompt",
      context_scope: { project_id: p.id },
      form_source: {
        skill: "episode",
        form: { title: "待完善集名", brief: "", target_duration: 45 },
        context: {},
      },
      messages: [initial],
    });
    assert.equal(first.skill, "episode");
    assert.equal(first.patch?.title, "第二集：追踪");
    assert.equal(requests.length, 5);
    assert.deepEqual(JSON.parse(requests[0].messages[1].content), {});
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.tool_choice === "none") return formToolReply(body, {});
      assert.equal(body.tool_choice, "required");
      assert(
        body.tools.some(
          (tool: Json) => tool.function.name === "update_episode_form",
        ),
      );
      assert(
        body.messages.some((message: Json) =>
          String(message.content).includes("承接前集的追踪行动"),
        ),
      );
      return formToolReply(
        body,
        { brief: "更紧凑的追踪行动" },
        "update_episode_form",
      );
    };
    const followup = await assistForm({
      mode: "prompt",
      context_scope: { project_id: p.id },
      messages: [
        initial,
        { role: "assistant", text: JSON.stringify(first.patch) },
        { role: "user", text: "剧情再紧凑一点" },
      ],
    });
    assert.deepEqual(followup.prompt_trace.loaded_skills, ["episode"]);
    assert.equal(followup.patch?.brief, "更紧凑的追踪行动");
    assert.equal(digest(await loadProject(p.id)), frozen);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("untagged generation can load a matching skill and expose its result tool during the agent loop", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls++;
    if (calls === 1) {
      assert(
        !body.tools.some((tool: Json) =>
          tool.function.name.startsWith("update_"),
        ),
      );
      return formToolReply(body, { skill: "episode" }, "load_creation_skill");
    }
    if (calls === 2) {
      assert.match(body.messages.at(-1).content, /分集大纲/);
      assert(
        body.tools.some(
          (tool: Json) => tool.function.name === "update_episode_form",
        ),
      );
      return formToolReply(body, {}, "get_project_context");
    }
    if (calls === 3) {
      assert.equal(JSON.parse(body.messages.at(-1).content).exists, false);
      return formToolReply(body, {}, "get_current_form");
    }
    if (calls === 4) {
      assert.equal(JSON.parse(body.messages.at(-1).content).exists, false);
      return formToolReply(
        body,
        { title: "第一集", brief: "新的冒险" },
        "update_episode_form",
      );
    }
    assert.equal(body.tool_choice, "none");
    return formToolReply(body, {});
  };
  try {
    const result = await assistForm({
      mode: "prompt",
      messages: [{ role: "user", text: "生成一个太空冒险的分集大纲" }],
    });
    assert.equal(result.skill, "episode");
    assert.deepEqual(result.prompt_trace.loaded_skills, ["episode"]);
    assert.equal(result.patch?.title, "第一集");
    assert.equal(calls, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("prompt conversations can read explicitly referenced stages without injecting the page", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const f = await setup();
  const requests: Json[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    if (requests.length === 1)
      return formToolReply(body, { stage: "story" }, "get_stage_content");
    const stage = JSON.parse(body.messages.at(-1).content);
    assert.equal(stage.approved_version.content.text, "第一章\n\n完整故事");
    return Response.json({
      choices: [
        { finish_reason: "stop", message: { content: "已查阅引用的故事。" } },
      ],
    });
  };
  try {
    const result = await assistForm({
      mode: "prompt",
      reference_scope: { project_id: f.pid, ...f.ids },
      messages: [{ role: "user", text: "请点评 @stage:story" }],
    });
    assert.equal(result.patch, null);
    assert.deepEqual(JSON.parse(requests[0].messages[1].content), {});
    assert(
      !requests[0].tools.some((tool: Json) =>
        tool.function.name.startsWith("update_"),
      ),
    );
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("context tools distinguish stale selections from approved content and enforce project scope", async () => {
  const { creationReadTools } =
    await import("../src/lib/server/creation-context");
  const f = await setup();
  const { p, r } = await f.read();
  const tools = creationReadTools({
    load: async () => p,
    episodeId: f.ids.episode_id,
    runId: r.id,
  });
  const stage = tools.find((t) => t.name === "get_stage_content")!;
  r.project_config_revision = 99;
  const stale = (await stage.execute({ stage: "director" })) as Json;
  assert.equal(stale.status, "stale");
  assert.equal(stale.selected_version.content.prompt, "统一意图");
  assert.equal(stale.approved_version, null);
  await assert.rejects(
    () =>
      stage.execute({ stage: "story", episode_id: "another-project-episode" }),
    /不属于当前项目/,
  );
  await assert.rejects(
    () => stage.execute({ stage: "story", version_id: "nonexistent-version" }),
    /版本不属于/,
  );
  const { validateSchema } = await import("../src/lib/server/creation-agent");
  assert.throws(
    () =>
      validateSchema(
        { stage: "story", project_id: "another-project" },
        stage.parameters,
      ),
    /未授权字段/,
  );
});

test("form assistant discussions do not write; wrong tools, unexpected fields and incomplete output are rejected", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const request = {
    skill: "project",
    form: { title: "构思", brief: "科幻" },
    messages: [{ role: "user", text: "帮我讨论方向" }],
  };
  try {
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "想用怎样的视觉风格？" },
          },
        ],
      });
    const response = await assistForm(request);
    assert.equal(response.patch, null);
    assert.equal(response.tool, null);
    assert.match(response.reply, /风格/);
    globalThis.fetch = async (_url, init) =>
      formToolReply(
        JSON.parse(String(init?.body)),
        { title: "越界" },
        "delete_project",
      );
    await assert.rejects(() => assistForm(request), /未授权工具/);
    globalThis.fetch = async (_url, init) =>
      formToolReply(JSON.parse(String(init?.body)), { base_updated: 0 });
    await assert.rejects(() => assistForm(request), /未授权字段/);
    globalThis.fetch = async (_url, init) =>
      formToolReply(JSON.parse(String(init?.body)), { ratio: "4:3" });
    await assert.rejects(
      () => assistForm({ ...request, skill: "production" }),
      /不支持此值/,
    );
    await assert.rejects(
      () => assistForm({ ...request, skill: "../../secret" }),
      /未知创作模块/,
    );
    await assert.rejects(
      () => assistForm({ ...request, skill: "story" }),
      /故事创作已独立/,
    );
    globalThis.fetch = async () =>
      Response.json({
        choices: [{ finish_reason: "length", message: { content: "不完整" } }],
      });
    await assert.rejects(() => assistForm(request), /输出不完整/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stage form tools validate plans and settings without changing adopted versions or creating resources", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const f = await setup();
  const { p, r } = await f.read();
  const base = {
    project_id: p.id,
    episode_id: f.ids.episode_id,
    run_id: f.ids.run_id,
    messages: [{ role: "user", text: "完善当前内容并回填" }],
  };
  try {
    globalThis.fetch = async (_url, init) =>
      formToolReply(JSON.parse(String(init?.body)), {
        prompt: "新的整体导演意图",
      });
    const result = await assistForm({
      ...base,
      skill: "director",
      form: selected(r, "director")!.content,
    });
    assert(result.patch);
    assert.equal(result.patch.prompt, "新的整体导演意图");
    assert.equal((await f.read()).r.steps.director.versions.length, 1);
    globalThis.fetch = async (_url, init) =>
      formToolReply(JSON.parse(String(init?.body)), { beats: [] });
    await assert.rejects(
      () =>
        assistForm({
          ...base,
          skill: "director",
          form: selected(r, "director")!.content,
        }),
      /分镜时间表/,
    );
    globalThis.fetch = async (_url, init) =>
      formToolReply(JSON.parse(String(init?.body)), {
        world: { premise: "未来" },
        characters: [
          {
            asset_id: "",
            version: "",
            kind: "character",
            name: "主角",
            description: "灰色功能材料长衣",
            reason: "主角",
            appearance_changed: true,
            segment_ids: ["A"],
          },
        ],
      });
    const settings = await assistForm({
      ...base,
      skill: "settings",
      form: { world: {}, characters: [] },
    });
    assert(settings.patch);
    assert(settings.patch.characters[0].asset_id);
    assert.equal((await loadProject(p.id)).assets.length, p.assets.length);
    assert.equal(
      (await f.read()).r.steps.characters.selected,
      r.steps.characters.selected,
    );
    globalThis.fetch = async (_url, init) =>
      formToolReply(JSON.parse(String(init?.body)), { prompt: "片段镜头细节" });
    const segment = await assistForm({
      ...base,
      skill: "segment",
      form: { prompt: "原文" },
      local_context: { current_segment: { id: "A" } },
    });
    assert.deepEqual(segment.patch, { prompt: "片段镜头细节" });
    assert.equal(segment.tool, "update_segment_form");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("editing tool only accepts available fresh clips and valid trim ranges", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const { saveProject } = await import("../src/lib/server/repository");
  const { mediaHash } = await import("../src/lib/domain");
  const f = await setup();
  const { p, r } = await f.read();
  const segment = selected(r, "director")!.content.segments[0];
  const clipId = "clip-form-test";
  r.media.A = [
    {
      id: clipId,
      number: 1,
      created: Date.now() / 1000,
      inputs: {},
      input_hash: mediaHash(r, segment),
      content: { duration: 4, url: "/media/test.mp4" },
    },
  ];
  r.media_selection.A = clipId;
  await saveProject(p);
  const request = {
    skill: "finish",
    project_id: p.id,
    episode_id: f.ids.episode_id,
    run_id: f.ids.run_id,
    form: { items: [{ segment_id: "A", in: 0, out: 4 }] },
    messages: [{ role: "user", text: "建议剪辑顺序和裁切" }],
  };
  try {
    for (const item of [
      { segment_id: "A", in: 0, out: 5 },
      { segment_id: "missing", in: 0, out: 2 },
      { segment_id: "A", in: 3, out: 2 },
    ]) {
      globalThis.fetch = async (_url, init) =>
        formToolReply(JSON.parse(String(init?.body)), { items: [item] });
      await assert.rejects(() => assistForm(request), /无效片段或裁切范围/);
    }
    globalThis.fetch = async (_url, init) =>
      formToolReply(JSON.parse(String(init?.body)), {
        items: [{ segment_id: "A", in: 0.5, out: 3.5 }],
      });
    const result = await assistForm(request);
    assert.deepEqual(result.patch, {
      items: [{ segment_id: "A", in: 0.5, out: 3.5 }],
    });
    assert.equal((await f.read()).r.exports.length, 0);
    const current = await f.read();
    selected(current.r, "director")!.content.segments[0].prompt =
      "已变更的镜头";
    // Existing versions are immutable in storage; a new plan makes the old clip stale.
    await f.op("save-step", {
      step: "director",
      content: selected(current.r, "director")!.content,
      adopt: true,
    });
    await assert.rejects(() => assistForm(request), /无效片段或裁切范围/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Qwen generates one character sheet and can reuse its PNG for regeneration", async () => {
  const savedConfig = await config();
  const arkEnvironment = process.env.ARK_API_KEY;
  try {
    process.env.ARK_API_KEY = "";
    await storeConfig({
      ...savedConfig,
      api_key: "",
      wan_api_key: "qwen-test-key",
      wan_region: "beijing",
      wan_workspace: "qwen-workspace",
    });
    await updateConfig({
      section: "models",
      image_model: "qwen-image-2.1-pro",
    });
    const visible = await publicConfig();
    assert.equal(visible.ark_configured, false);
    assert.equal(visible.image_configured, true);
    const f = await setup();
    await f.op("save-step", {
      step: "characters",
      adopt: true,
      content: {
        world: { premise: "测试" },
        characters: [
          {
            asset_id: "hero",
            version: "hero-v1",
            kind: "character",
            name: "主角",
            description: "蓝衣少年",
            images: [],
            url: "",
            segment_ids: ["A"],
          },
        ],
      },
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/N8AAAAASUVORK5CYII=",
      "base64",
    );
    let submitted = 0;
    globalThis.fetch = async (url, options) => {
      if (String(url) === "https://image.example.com/generated.png")
        return new Response(png);
      assert.equal(
        String(url),
        "https://qwen-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      );
      assert.equal(
        (options?.headers as Json).Authorization,
        "Bearer qwen-test-key",
      );
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, "qwen-image-2.1-pro");
      const content = body.input.messages[0].content;
      assert.equal(body.parameters.n, 1);
      assert.match(content.at(-1).text, /2×2四区布局/);
      if (submitted++ === 0) assert.equal(content.length, 1);
      else
        assert.equal(
          content[0].image,
          `data:image/png;base64,${png.toString("base64")}`,
        );
      return Response.json({
        output: {
          choices: [
            {
              message: {
                content: [{ image: "https://image.example.com/generated.png" }],
              },
            },
          ],
        },
      });
    };
    await f.op("character-image", { asset_id: "hero" });
    const job = (await listJobs(f.pid, database(), true))[0];
    assert.equal(job.key_fingerprint, digest("qwen-test-key"));
    await executeJob(job);
    assert.equal(submitted, 1);
    const result = await f.read();
    const asset = result.p.assets.find((a) => a.id === "hero")!;
    const generated = asset.versions.at(-1)!;
    assert.equal(generated.source, "qwen-image");
    assert.equal(generated.images.length, 1);
    assert.equal(generated.images[0].pose, "character-sheet");
    assert.equal(
      selected(result.r, "characters")!.content.characters[0].images.length,
      0,
    );
    await f.op("asset-adopt", {
      asset_id: "hero",
      version_id: generated.id,
      expected_adopted: null,
    });
    await f.op("asset-update-references", {
      asset_id: "hero",
      version_id: generated.id,
      targets: assetUsages((await f.read()).p, "hero", "default"),
    });
    await f.op("character-image", { asset_id: "hero" });
    const regeneration = (await listJobs(f.pid, database(), true)).find(
      (candidate) =>
        candidate.id !== job.id && candidate.kind === "character-image",
    )!;
    await executeJob(regeneration);
    assert.equal(submitted, 2);
    assert.equal((await loadJob(regeneration.id)).images.length, 1);
    assert(
      generated.images.every((image: Json) => image.file.endsWith(".png")),
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (arkEnvironment === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = arkEnvironment;
    await storeConfig(savedConfig);
  }
});

test("video references treat a character sheet as one identity reference", async () => {
  const f = await setup();
  await f.op("save-step", {
    step: "characters",
    adopt: true,
    content: {
      world: {},
      characters: [
        {
          asset_id: "hero",
          version: "hero-v1",
          kind: "character",
          name: "机器人",
          description: "小机器人",
          segment_ids: ["A"],
          url: "",
          images: [
            { url: "https://example.com/sheet.png", pose: "character-sheet" },
          ],
        },
      ],
    },
  });
  const { p, r } = await f.read();
  const { videoPayload } = await import("../src/lib/server/providers");
  const request = await videoPayload(
    p,
    r,
    selected(r, "director")!.content.segments[0],
  );
  assert.match(request.payload.content[0].text, /同一个角色.*四视图设定板/);
  assert.match(request.payload.content[0].text, /不把各视图生成为多个角色/);
  assert.equal(
    request.payload.content.filter((item: Json) => item.type === "image_url")
      .length,
    1,
  );
});

test("ending a scheme requires a current export and idle jobs, locks every write, and allows an editable inherited scheme", async () => {
  const { saveProject } = await import("../src/lib/server/repository");
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const { mediaHash, segments, status, uid, now, view } =
    await import("../src/lib/domain");
  const f = await setup();
  await assert.rejects(f.op("complete-run"), /导出有效成片/);
  const { p, r } = await f.read();
  for (const segment of segments(r)) {
    const id = uid();
    r.media[segment.id] = [
      {
        id,
        number: 1,
        inputs: {},
        input_hash: mediaHash(r, segment),
        content: {
          quality: "standard",
          duration: 4,
          url: "/media/fixture.mp4",
        },
        created: now(),
      },
    ];
    r.media_selection[segment.id] = id;
  }
  r.exports.push({
    id: uid(),
    kind: "finish",
    inputs: inputs(p, r, "finish"),
    content: { url: "/media/fixture.mp4" },
    created: now(),
  });
  assert.equal(status(p, r, "finish"), "approved");
  await saveProject(p);
  const pending = {
    id: uid(),
    project_id: p.id,
    episode_id: f.ids.episode_id,
    run_id: r.id,
    kind: "text",
    step: "story",
    state: "queued",
    message: "等待",
    created: now(),
  };
  await saveJob(pending);
  await assert.rejects(f.op("complete-run"), /还有任务/);
  pending.state = "done";
  await saveJob(pending);
  await f.op("complete-run");
  const ended = (await f.read()).r;
  assert(ended.finished_at);
  assert.equal(status(p, ended, "complete"), "approved");
  assert.equal(
    view((await f.read()).p).episodes[0].runs[0].statuses?.complete,
    "approved",
  );
  const frozen = digest(ended);
  for (const [action, body] of [
    ["save-step", { step: "story", content: { text: "改写" } }],
    ["adopt-step", { step: "story" }],
    ["approve-step", { step: "story" }],
    ["model", { model: "wan2.6-t2v" }],
    ["generate-text", { step: "story" }],
    ["chat", { step: "assistant", message: "改写" }],
    ["character-image", {}],
    ["video-options", {}],
    ["generate-video", {}],
    ["generate-all-videos", {}],
    ["adopt-media", {}],
    ["finish", {}],
    ["resume", {}],
    ["complete-run", {}],
  ] as [string, Json][]) {
    await assert.rejects(f.op(action, body), /此方案已结束/);
  }
  await assert.rejects(
    assistForm({
      project_id: p.id,
      ...f.ids,
      skill: "director",
      form: { prompt: "原文" },
      messages: [{ role: "user", text: "改写" }],
    }),
    /此方案已结束/,
  );
  await assert.rejects(executeJob(pending), /此方案已结束/);
  assert.equal(digest((await f.read()).r), frozen);
  await f.op("switch-run");
  const fork = await f.op("runs", { name: "继续创作", inherit: "all" });
  const copy = (await loadProject(p.id)).episodes[0].runs.find(
    (run) => run.id === fork.run_id,
  )!;
  assert.equal(copy.finished_at, undefined);
  assert.equal(status(p, copy, "complete"), "empty");
  assert.deepEqual(copy.media_selection, ended.media_selection);
  await mutate(p.id, "select-story", {
    episode_id: f.ids.episode_id,
    run_id: copy.id,
    ...(await storyFixture(p.id, "新方案可以编辑")),
    expected_selected: copy.steps.story.selected,
  });
  const original = (await loadProject(p.id)).episodes[0].runs.find(
    (run) => run.id === r.id,
  )!;
  assert.equal(digest(original), frozen);
  assert.equal(
    selected(
      (await loadProject(p.id)).episodes[0].runs.find(
        (run) => run.id === copy.id,
      )!,
      "story",
    )?.content.text,
    "第一章\n\n新方案可以编辑",
  );

  // Finishing a replacement transfers only the final node, preserving A's content.
  await assert.rejects(
    f.op("complete-run", { run_id: copy.id }),
    /导出有效成片/,
  );
  assert.equal(digest((await f.read()).r), frozen);
  const replacement = await f.op("runs", {
    name: "替代完成方案",
    inherit: "all",
  });
  await f.op("complete-run", { run_id: replacement.run_id });
  const episode = (await loadProject(p.id)).episodes[0];
  assert.deepEqual(
    episode.runs.filter((run) => run.finished_at).map((run) => run.id),
    [replacement.run_id],
  );
  const previous = episode.runs.find((run) => run.id === r.id)!;
  assert.equal(status(p, previous, "complete"), "empty");
  const { finished_at: _finished, ...previousContent } = previous;
  const {
    finished_at: _originalFinished,
    production_snapshot: _originalProductionSnapshot,
    ...originalContent
  } = ended;
  assert.equal(previous.production_snapshot, undefined);
  assert.deepEqual(previousContent, originalContent);
  await selectFixture(f, "原方案重新可编辑");
});

test("shared character, scene and prop resources generate versioned images without an episode", async () => {
  const { project: p } = await createProject({ title: "共享资源出图" });
  const png = Buffer.from([255, 216, 255, 217]).toString("base64");
  let submitted = 0;
  const prompts: string[] = [];
  globalThis.fetch = async (_url, init) => {
    submitted++;
    prompts.push(JSON.parse(String(init?.body)).prompt);
    return Response.json({ data: [{ b64_json: png }] });
  };
  try {
    for (const [kind, pose] of [
      ["character", "character-sheet"],
      ["scene", "establishing"],
      ["prop", "object"],
    ] as const) {
      const count = 1;
      const { asset_id } = await mutate(p.id, "asset", {
        kind,
        name: kind,
        description: "蓝色未来科技设定",
      });
      const { job_id } = await mutate(p.id, "asset-image", { asset_id });
      await assert.rejects(
        mutate(p.id, "asset-image", { asset_id }),
        /正在出图/,
      );
      const j = await loadJob(job_id);
      assert.equal(j.episode_id, null);
      assert.equal(j.run_id, null);
      const before = submitted;
      await executeJob(j);
      assert.equal(submitted - before, count);
      const saved = await loadProject(p.id);
      assert.equal(saved.episodes.length, 0);
      const a = saved.assets.find((a) => a.id === asset_id)!;
      assert.equal(a.versions.length, 2);
      assert.equal(a.selected, a.versions[0].id);
      await mutate(p.id, "asset-adopt", {
        asset_id: a.id,
        version_id: a.versions[1].id,
        expected_adopted: null,
      });
      assert.equal(a.versions[1].images.length, count);
      assert.equal(a.versions[1].images[0].pose, pose);
      const prompt = prompts.at(-1)!;
      assert.match(prompt, /只输出一张图片/);
      if (kind === "character") {
        for (const view of ["正面全身", "侧面全身", "背面全身", "正面半身特写"])
          assert(prompt.includes(view));
        assert.match(prompt, /2×2/);
        assert(!prompt.includes("不要拼图"));
      } else if (kind === "scene") {
        assert.match(prompt, /场景空间全景/);
        assert.match(prompt, /单一连续画面/);
        assert.match(prompt, /不生成额外的细节图/);
      } else {
        assert.match(prompt, /完整三分之四视角/);
      }
      assert.equal((await loadJob(job_id)).state, "done");
    }
    const { asset_id } = await mutate(p.id, "asset", {
      kind: "voice",
      name: "旁白",
      description: "清晰",
    });
    await assert.rejects(
      mutate(p.id, "asset-image", { asset_id }),
      /人物、场景或道具/,
    );
    // A newer manual edit must remain selected when an older image job completes.
    const original = (await loadProject(p.id)).assets.find(
      (a) => a.kind === "prop",
    )!;
    const { job_id } = await mutate(p.id, "asset-image", {
      asset_id: original.id,
    });
    await mutate(p.id, "asset", {
      asset_id: original.id,
      kind: "prop",
      name: "新版道具",
      description: "红色",
    });
    const edited = (await loadProject(p.id)).assets.find(
      (a) => a.id === original.id,
    )!;
    assert.deepEqual(
      edited.versions.at(-1)!.reference_images,
      original.versions.at(-1)!.images,
    );
    await executeJob(await loadJob(job_id));
    const final = (await loadProject(p.id)).assets.find(
      (a) => a.id === original.id,
    )!;
    assert.equal(final.selected, edited.selected);
    assert.equal(final.versions.length, edited.versions.length + 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("project descriptions do not invalidate production; production settings validate revisions and invalidate only unfinished schemes", async () => {
  const { saveProject } = await import("../src/lib/server/repository");
  const { status } = await import("../src/lib/domain");
  const f = await setup();
  let { p, r } = await f.read();
  const original = digest(r);
  const production = structuredClone(p.production);
  await mutate(p.id, "project-settings", {
    title: "新的项目名称",
    brief: "这是项目简介，不是剧情指令",
    base_updated: p.updated,
  });
  ({ p, r } = await f.read());
  assert.equal(digest(r), original);
  assert.deepEqual(p.production, production);
  await assert.rejects(
    mutate(p.id, "project-settings", {
      title: p.title,
      brief: p.brief,
      style: "不能混入项目",
      base_updated: p.updated,
    }),
    /制作设置/,
  );
  await assert.rejects(
    mutate(p.id, "project-settings", {
      title: p.title,
      brief: p.brief,
      base_updated: 0,
    }),
    /重新载入/,
  );
  const { revision, ...fields } = production;
  await assert.rejects(
    mutate(p.id, "production-settings", {
      ...fields,
      ratio: "bad",
      base_revision: revision,
    }),
    /画幅/,
  );
  const copy = await f.op("runs", { name: "历史方案", inherit: "all" });
  p = await loadProject(p.id);
  p.episodes[0].runs.find((run) => run.id === copy.run_id)!.finished_at =
    Date.now() / 1000;
  await saveProject(p);
  await mutate(p.id, "production-settings", {
    ...fields,
    style: "国风水墨",
    ratio: "9:16",
    prompt: "统一冷色调",
    adaptation: "优先保留人物关系",
    base_revision: revision,
  });
  p = await loadProject(p.id);
  const active = p.episodes[0].runs.find((run) => run.id === f.ids.run_id)!;
  const locked = p.episodes[0].runs.find((run) => run.id === copy.run_id)!;
  assert.equal(p.production.ratio, "9:16");
  assert.equal(p.production.revision, revision + 1);
  assert.equal(status(p, active, "story"), "approved");
  assert.equal(status(p, active, "director"), "stale");
  assert.equal(status(p, locked, "director"), "approved");
  assert.deepEqual(active.steps.story, r.steps.story);
  await assert.rejects(
    mutate(p.id, "production-settings", { ...fields, base_revision: revision }),
    /其他页面更新/,
  );
  const currentRevision = p.production.revision;
  await mutate(p.id, "production-settings", {
    ...p.production,
    revision: undefined,
    base_revision: currentRevision,
  }).then(
    () => assert.fail("unexpected field must be rejected"),
    (error) => assert.match(error.message, /未知字段/),
  );
  const { revision: latest, ...currentFields } = p.production;
  await mutate(p.id, "production-settings", {
    ...currentFields,
    base_revision: latest,
  });
  assert.equal((await loadProject(p.id)).production.revision, currentRevision);
});

test("episode covers extract a real first frame and cache it without regenerating media", async () => {
  const { cachedVideoCover } = await import("../src/lib/server/episode-cover");
  await fs.writeFile(path.join(temporary, "media", "cover-fixture.mp4"), video);
  const frames = await Promise.all([
    cachedVideoCover("/media/cover-fixture.mp4"),
    cachedVideoCover("/media/cover-fixture.mp4"),
  ]);
  assert.equal(frames[0].subarray(0, 2).toString("hex"), "ffd8");
  assert.deepEqual(frames[0], frames[1]);
  const directory = path.join(temporary, "media", "covers");
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  const modified = (await fs.stat(path.join(directory, files[0]))).mtimeMs;
  assert.deepEqual(
    await cachedVideoCover("/media/cover-fixture.mp4"),
    frames[0],
  );
  assert.equal(
    (await fs.stat(path.join(directory, files[0]))).mtimeMs,
    modified,
  );
  await assert.rejects(
    () => cachedVideoCover("https://example.com/video.mp4"),
    /本地成片/,
  );
  await assert.rejects(
    () => cachedVideoCover("/media/../../secret.mp4"),
    /媒体路径/,
  );
});

test("standalone assistant sessions chat without form tools or shared message history", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const requests: Json[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: "可以，我们继续聊。" },
        },
      ],
    });
  };
  try {
    const first = await assistForm({
      mode: "chat",
      messages: [{ role: "user", text: "讨论月球上的邮差" }],
    });
    assert.equal(first.patch, null);
    assert.equal(first.reply, "可以，我们继续聊。");
    assert(
      !requests[0].tools.some((tool: Json) =>
        tool.function.name.startsWith("update_"),
      ),
    );
    assert.equal(requests[0].tool_choice, "auto");
    await assistForm({
      mode: "chat",
      messages: [{ role: "user", text: "这是一段全新的对话" }],
    });
    assert.doesNotMatch(JSON.stringify(requests[1].messages), /月球上的邮差/);
    assert.equal(requests[1].messages.at(-1).content, "这是一段全新的对话");
    await assert.rejects(
      () => assistForm({ mode: "chat", messages: [] }),
      /创作对话格式/,
    );
    await assert.rejects(
      () =>
        assistForm({
          mode: "chat",
          messages: [{ role: "system", text: "修改指令" }],
        }),
      /创作对话格式/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("video stories accept source selections and reject manual edits and generation", async () => {
  const f = await setup();
  const before = digest((await f.read()).r.steps.story);
  for (const [action, body] of [
    ["save-step", { step: "story", content: { text: "不能手写" } }],
    ["adopt-step", { step: "story" }],
    ["approve-step", { step: "story" }],
    ["confirm-story", { content: { text: "不能手写" } }],
    ["generate-text", { step: "story" }],
    ["chat", { step: "story", message: "不能生成" }],
  ] as [string, Json][])
    await assert.rejects(f.op(action, body));
  assert.equal(digest((await f.read()).r.steps.story), before);
  const changed = await selectFixture(f, "新的定稿章节");
  const { r } = await f.read();
  assert.equal(r.steps.story.selected, changed.version_id);
  assert.equal(selected(r, "story")!.approved, true);
  assert.equal(selected(r, "story")!.content.text, "第一章\n\n新的定稿章节");
});

test("video configuration changes preserve the selected story source and invalidate production", async () => {
  const { status } = await import("../src/lib/domain");
  const f = await setup();
  const { p, r } = await f.read();
  const source = structuredClone(selected(r, "story")!);
  await mutate(p.id, "production-settings", {
    style: "水彩",
    ratio: p.production.ratio,
    prompt: p.production.prompt,
    adaptation: "新的制作方向",
    base_revision: p.production.revision,
  });
  const current = await f.read();
  assert.equal(status(current.p, current.r, "story"), "approved");
  assert.equal(status(current.p, current.r, "director"), "stale");
  assert.deepEqual(selected(current.r, "story"), source);
});

test("story states coexist, inherit references, revise independently and bind only selected segments", async () => {
  const { mediaHash, segments } = await import("../src/lib/domain");
  const { normalizeSettings } = await import("../src/lib/server/validation");
  const f = await setup();
  const { asset_id } = await mutate(f.pid, "asset", {
    kind: "character",
    name: "林夏",
    description: "黑发，校服",
    url: "https://example.com/uniform.jpg",
  });
  await f.op("bind-character", { asset_id, segment_ids: ["A", "B"] });
  const before = await f.read();
  const original = selected(before.r, "characters")!.content.characters[0];
  const frozen = JSON.stringify(selected(before.r, "characters")!.content);
  const aHash = mediaHash(before.r, segments(before.r)[0]);
  await assert.rejects(
    f.op("new-resource-state", {
      asset_id,
      entry_version: original.version,
      state_name: "雨衣",
      description: "黑发，黄色雨衣",
      tags: [],
      segment_ids: [],
    }),
    /请选择/,
  );
  await f.op("new-resource-state", {
    asset_id,
    entry_version: original.version,
    state_name: "雨衣",
    description: "黑发，黄色雨衣",
    tags: ["雨夜", "第2集"],
    segment_ids: ["B"],
  });
  let current = await f.read();
  const items = selected(current.r, "characters")!.content.characters;
  assert.equal(items.length, 2);
  assert.deepEqual(items[0].segment_ids, ["A"]);
  const rain = items[1];
  assert.equal(rain.asset_id, asset_id);
  assert.notEqual(rain.version, original.version);
  assert.equal(rain.base_version, original.version);
  assert.deepEqual(rain.reference_images, [
    { url: "https://example.com/uniform.jpg" },
  ]);
  assert.deepEqual(rain.images, []);
  assert.equal(mediaHash(current.r, segments(current.r)[0]), aHash);
  assert.equal(
    JSON.stringify(
      current.r.steps.characters.versions.find(
        (v) => v.id === before.r.steps.characters.selected,
      )!.content,
    ),
    frozen,
  );
  assert.equal(current.p.assets.length, 1);
  assert.equal(current.p.assets[0].versions.length, 2);

  await f.op("edit-character", {
    asset_id,
    entry_version: rain.version,
    description: "黑发，深黄色雨衣",
    segment_ids: ["B"],
  });
  current = await f.read();
  const revised = selected(current.r, "characters")!.content.characters.find(
    (e: Json) => e.state_id === rain.state_id,
  );
  assert.equal(revised.state_id, rain.state_id);
  assert.notEqual(revised.version, rain.version);
  assert.equal(
    selected(current.r, "characters")!.content.characters[0].version,
    original.version,
  );
  globalThis.fetch = async () =>
    Response.json({
      data: [
        { b64_json: Buffer.from([255, 216, 255, 217]).toString("base64") },
      ],
    });
  try {
    await f.op("character-image", { asset_id, entry_version: revised.version });
    const j = (await listJobs(f.pid, database(), true)).find(
      (j) => j.kind === "character-image",
    )!;
    assert.equal(j.snapshot.entry.state_id, rain.state_id);
    await executeJob(j);
  } finally {
    globalThis.fetch = originalFetch;
  }
  current = await f.read();
  const generated = selected(current.r, "characters")!.content.characters;
  assert.equal(
    generated.find((e: Json) => e.state_id === rain.state_id).images.length,
    0,
  );
  const imageVersion = current.p.assets
    .find((a) => a.id === asset_id)!
    .versions.at(-1)!;
  assert.equal(imageVersion.images.length, 1);
  assert.equal(imageVersion.state_id, rain.state_id);
  assert.equal(
    generated.find((e: Json) => !e.state_id || e.state_id === "default").url,
    original.url,
  );
  assert.equal(mediaHash(current.r, segments(current.r)[0]), aHash);

  // Assistant normalization retains both state identities rather than merging by asset id.
  const normalized = normalizeSettings(current.p, current.r, {
    world: selected(current.r, "characters")!.content.world,
    characters: generated.map((e: Json) => ({
      ...e,
      appearance_changed: false,
    })),
  });
  assert.equal(normalized.characters.length, 2);
  assert.equal(normalized.characters[1].state_id, rain.state_id);
  const proposal = normalizeSettings(current.p, current.r, {
    world: selected(current.r, "characters")!.content.world,
    characters: [
      { ...original, segment_ids: ["A"], appearance_changed: false },
      {
        ...original,
        segment_ids: ["B"],
        description: "黑发，冬季大衣",
        new_state: true,
        state_name: "冬装",
        tags: ["冬季"],
      },
    ],
  });
  assert.equal(proposal.characters.length, 2);
  assert.notEqual(proposal.characters[1].state_id, rain.state_id);
  assert.equal(proposal.characters[1].state_name, "冬装");
  assert.equal(proposal.characters[1].base_version, original.version);
  await assert.rejects(
    f.op("edit-character", {
      asset_id,
      entry_version: generated[1].version,
      description: "重叠",
      segment_ids: ["A"],
    }),
    /多个状态/,
  );

  await f.op("bind-character", {
    asset_id,
    version_id: original.version,
    segment_ids: ["B"],
  });
  current = await f.read();
  assert.equal(selected(current.r, "characters")!.content.characters.length, 1);
  assert.deepEqual(
    selected(current.r, "characters")!.content.characters[0].segment_ids.sort(),
    ["A", "B"],
  );
  assert(
    current.p.assets[0].versions.some((v) => v.state_id === rain.state_id),
  );
});

test("permanent episode locks reject edits and new versions and preserve viewing state", async () => {
  const { project: p } = await createProject({ title: "锁定测试" });
  const ids = await mutate(p.id, "episodes", { title: "锁定集" });
  const op = (action: string, body: Json = {}) =>
    mutate(p.id, action, { ...ids, ...body });
  await op("select-story", {
    ...(await storyFixture(p.id, "锁定前故事")),
    expected_selected: null,
  });
  const before = (await project(p.id)).project.episodes[0].runs[0];
  await op("lock-episode");
  const locked = await loadProject(p.id);
  assert(locked.episodes[0].locked_at);
  for (const [action, body] of [
    ["runs", { inherit: "all" }],
    ["save-step", { step: "story", content: { text: "禁止修改" } }],
    ["complete-run", {}],
    ["lock-episode", {}],
    ["unlock-episode", {}],
  ] as [string, Json][])
    await assert.rejects(op(action, body), /永久锁定/);
  await mutate(p.id, "production-settings", {
    style: "水彩",
    ratio: p.production.ratio,
    prompt: "新的美术规范",
    adaptation: "",
    base_revision: p.production.revision,
  });
  const after = (await project(p.id)).project.episodes[0].runs[0];
  assert.deepEqual(after.statuses, before.statuses);
  assert.deepEqual(after.current_export, before.current_export);
  assert.equal((await loadProject(p.id)).episodes[0].runs.length, 1);
});

test("episode deletion removes all versions and jobs and keeps episode numbering unique", async () => {
  const f = await setup();
  const p = await loadProject(f.pid);
  const e = p.episodes[0];
  const ids = { episode_id: e.id, run_id: e.active_run };
  await mutate(p.id, "episodes", { title: "保留集" });
  const job = {
    id: "delete-test-" + p.id,
    project_id: p.id,
    episode_id: e.id,
    run_id: e.active_run,
    kind: "text",
    state: "queued",
    message: "测试",
    created: 1,
  };
  await saveJob(job);
  await assert.rejects(mutate(p.id, "lock-episode", ids), /任务正在处理/);
  await assert.rejects(mutate(p.id, "delete-episode", ids), /任务正在处理/);
  job.state = "failed";
  await saveJob(job);
  await mutate(p.id, "delete-episode", ids);
  assert.equal(
    (await loadProject(p.id)).episodes.some(
      (candidate) => candidate.id === e.id,
    ),
    false,
  );
  assert.equal(
    (await listJobs(p.id)).some((candidate) => candidate.id === job.id),
    false,
  );
  await assert.rejects(mutate(p.id, "runs", ids), /分集不存在/);
  await mutate(p.id, "episodes", { title: "新集" });
  assert.deepEqual(
    (await loadProject(p.id)).episodes.map((candidate) => candidate.number),
    [2, 3],
  );
});

test("prompt director cards expose model limits and repair invalid short segments before becoming applicable", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const { workflowSummary } =
    await import("../src/lib/server/creation-context");
  const f = await setup();
  const { p, r } = await f.read();
  assert.equal(workflowSummary(p, r).video_model_capabilities.min, 4);
  const frozen = digest(p);
  const content = structuredClone(selected(r, "director")!.content);
  for (const segment of content.segments) {
    delete segment.duration;
    delete segment.references;
  }
  const invalid = structuredClone(content);
  invalid.segments[0].end = 2;
  invalid.segments[1].start = 2;
  let attempts = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.tool_choice === "none") return formToolReply(body, {});
    attempts++;
    if (attempts === 2) {
      const rejection = JSON.parse(body.messages.at(-1).content);
      assert.equal(rejection.executed, false);
      assert.match(rejection.error, /片段需连续排列，单段 4–/);
    }
    return formToolReply(
      body,
      attempts === 1 ? invalid : content,
      "update_director_form",
    );
  };
  try {
    const result = await assistForm({
      mode: "prompt",
      context_scope: { project_id: p.id, ...f.ids },
      form_source: { skill: "director", form: content, context: {} },
      messages: [{ role: "user", text: "使用 @skill:director，生成八秒方案" }],
    });
    assert.equal(attempts, 2);
    assert(result.patch);
    assert.equal(result.patch.segments[0].duration, 4);
    assert.equal(result.patch.segments[1].duration, 4);
    assert.equal(digest(await loadProject(p.id)), frozen);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("prompt settings cards normalize new resource identities and can be saved without adopting or generating media", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  const f = await setup();
  const { p } = await f.read();
  globalThis.fetch = async (_url, init) =>
    formToolReply(
      JSON.parse(String(init?.body)),
      {
        characters: [
          {
            kind: "prop",
            name: "黄色雨伞",
            description: "半透明蜡布，有手工补丁",
            segment_ids: ["A", "B"],
          },
        ],
      },
      "update_settings_form",
    );
  try {
    const result = await assistForm({
      mode: "prompt",
      context_scope: { project_id: p.id, ...f.ids },
      form_source: {
        skill: "settings",
        form: { world: {}, characters: [] },
        context: {},
      },
      messages: [{ role: "user", text: "使用 @skill:settings，生成设定集" }],
    });
    assert(result.patch);
    assert(result.patch.characters[0].asset_id);
    assert(result.patch.characters[0].version);
    assert.equal((await loadProject(p.id)).assets.length, 0);
    globalThis.fetch = async (_url, init) =>
      formToolReply(
        JSON.parse(String(init?.body)),
        { world: { premise: "雨夜街角" } },
        "update_settings_form",
      );
    const followup = await assistForm({
      mode: "prompt",
      context_scope: { project_id: p.id, ...f.ids },
      form_source: { skill: "settings", form: result.patch, context: {} },
      messages: [
        { role: "user", text: "使用 @skill:settings，修改世界观为雨夜街角" },
      ],
    });
    assert(followup.patch);
    assert.equal(
      followup.patch.characters[0].asset_id,
      result.patch.characters[0].asset_id,
    );
    assert.equal((await loadProject(p.id)).assets.length, 0);
    await f.op("save-step", { step: "characters", content: followup.patch });
    assert.equal((await loadProject(p.id)).assets.length, 1);
    assert.equal((await f.read()).r.steps.characters.versions.length, 2);
    assert.equal(
      (await f.read()).r.steps.characters.selected,
      p.episodes[0].runs[0].steps.characters.selected,
    );
    assert.equal((await listJobs(p.id)).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("required prompt generation never reports success without a valid result card", async () => {
  const { assistForm } = await import("../src/lib/server/form-assistant");
  globalThis.fetch = async () =>
    Response.json({
      choices: [{ finish_reason: "stop", message: { content: "已生成" } }],
    });
  try {
    await assert.rejects(
      () =>
        assistForm({
          mode: "prompt",
          messages: [{ role: "user", text: "使用 @skill:project，生成项目" }],
        }),
      /未生成有效结果卡片/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("episode information can be edited without recreating schemes and rejects stale or locked edits", async () => {
  const f = await setup();
  const { p, r } = await f.read();
  const e = p.episodes[0];
  const base_episode = {
    title: e.title,
    brief: e.brief,
    target_duration: e.target_duration ?? 60,
  };
  const body = {
    title: "新的集名",
    brief: "新的本集剧情",
    target_duration: 12,
    base_episode,
  };
  const frozen = digest(r);
  await f.op("episode-settings", body);
  const saved = await loadProject(p.id);
  assert.equal(saved.episodes.length, 1);
  assert.equal(saved.episodes[0].title, body.title);
  assert.equal(saved.episodes[0].brief, body.brief);
  assert.equal(saved.episodes[0].target_duration, 12);
  assert.equal(digest(saved.episodes[0].runs[0]), frozen);
  await assert.rejects(f.op("episode-settings", body), /其他页面更新/);
  const current = { title: body.title, brief: body.brief, target_duration: 12 };
  for (const patch of [
    { title: " " },
    { brief: "x".repeat(10001) },
    { target_duration: 0 },
  ]) {
    await assert.rejects(
      f.op("episode-settings", { ...body, base_episode: current, ...patch }),
    );
  }
  await assert.rejects(
    f.op("episode-settings", { ...body, base_episode: undefined }),
    /其他页面更新/,
  );
  await f.op("lock-episode");
  await assert.rejects(
    f.op("episode-settings", { ...body, base_episode: current }),
    /永久锁定/,
  );
});

test("combined storyboard saves atomically, compiles eight seconds into one request and preserves source stages when changing video models", async () => {
  const { status, segments, generationPlanFresh } =
    await import("../src/lib/domain");
  const f = await setup();
  const { r } = await f.read();
  const content = {
    prompt: "温暖的雨夜",
    beats: [
      {
        id: "b1",
        start: 0,
        end: 2,
        description:
          "画面与动作：看见 @resource:umbrella_default\n镜头：固定\n台词与旁白：无对白\n声音：雨滴落在伞面",
        camera: "固定",
        dialogue: "无对白",
        sound: "雨滴落在伞面",
      },
      {
        id: "b2",
        start: 2,
        end: 5,
        description: "撑起 @resource:umbrella_default",
        camera: "推近",
        dialogue: "",
      },
      {
        id: "b3",
        start: 5,
        end: 8,
        description: "停留",
        camera: "固定",
        dialogue: "",
      },
    ],
  };
  const resources = {
    world: {},
    characters: [
      {
        asset_id: "umbrella",
        version: "umbrella-v1",
        kind: "prop",
        name: "黄色雨伞",
        description: "黄色蜡布伞",
        images: [{ url: "https://example.test/umbrella.jpg" }],
        segment_ids: ["b1", "b2"],
      },
    ],
  };
  await f.op("save-storyboard", {
    content,
    resources,
    confirm: true,
    base_director: r.steps.director.selected,
    base_resources: r.steps.characters.selected,
  });
  let current = await f.read();
  assert.equal(status(current.p, current.r, "director"), "approved");
  assert.equal(status(current.p, current.r, "characters"), "approved");
  assert.equal(segments(current.r).length, 0);
  const compiled = await f.op("compile-video-plan");
  assert.equal(compiled.segments.length, 1);
  assert.equal(compiled.segments[0].duration, 8);
  const { videoPayload } = await import("../src/lib/server/providers");
  const request = await videoPayload(
    current.p,
    current.r,
    compiled.segments[0],
  );
  const videoPrompt = request.payload.content[0].text;
  assert.equal(videoPrompt.split("画面与动作：看见 黄色雨伞").length - 1, 1);
  assert.equal(videoPrompt.split("声音：雨滴落在伞面").length - 1, 1);
  assert.equal(videoPrompt.split("黄色蜡布伞").length - 1, 1);
  assert.equal(videoPrompt.split("温暖的雨夜").length - 1, 1);
  assert.match(videoPrompt, /镜头 1｜0–2 秒/);
  assert.match(videoPrompt, /镜头 2｜2–5 秒/);
  assert.match(videoPrompt, /切镜/);
  assert(!videoPrompt.includes("@resource:"));
  assert(!videoPrompt.includes("本段提示词"));
  assert.equal(
    request.payload.content.filter((item: Json) => item.type === "image_url")
      .length,
    1,
  );

  assert.match(compiled.segments[0].prompt, /声音：雨滴落在伞面/);
  assert.match(
    selected(current.r, "director")!.content.beats[0].description,
    /声音：雨滴落在伞面/,
  );
  assert.equal(
    selected(current.r, "director")!.content.beats[0].sound,
    undefined,
  );
  const preview = await f.op("preview-video-batch");
  assert.equal(preview.new_count, 1);
  assert.equal(preview.new_seconds, 8);
  assert.equal((await listJobs(f.pid)).length, 0);
  current = await f.read();
  assert.equal(generationPlanFresh(current.r), true);
  await f.op("model", { model: "doubao-seedance-2-0-fast-260128" });
  current = await f.read();
  assert.equal(status(current.p, current.r, "director"), "approved");
  assert.equal(status(current.p, current.r, "characters"), "approved");
  assert.equal(generationPlanFresh(current.r), false);
  await assert.rejects(f.op("preview-video-batch"), /重新组合/);
  await f.op("compile-video-plan");
  assert.equal(generationPlanFresh((await f.read()).r), true);
  await assert.rejects(
    f.op("save-storyboard", {
      content,
      resources,
      confirm: true,
      base_director: null,
      base_resources: null,
    }),
    /重新载入/,
  );
});

test("storyboard drafts can prepare reference images before final confirmation", async () => {
  const f = await setup();
  const { r } = await f.read();
  await f.op("save-storyboard", {
    content: {
      prompt: "",
      beats: [
        {
          id: "draft-shot",
          start: 0,
          end: 8,
          description: "雨伞",
          camera: "",
          dialogue: "",
          resources_reviewed: true,
        },
      ],
    },
    resources: {
      world: {},
      characters: [
        {
          asset_id: "draft-umbrella",
          version: "draft-umbrella-v1",
          kind: "prop",
          name: "雨伞",
          description: "黄色蜡布伞",
          images: [],
          segment_ids: ["draft-shot"],
        },
      ],
    },
    base_director: r.steps.director.selected,
    base_resources: r.steps.characters.selected,
  });
  const current = await f.read();
  const { status } = await import("../src/lib/domain");
  assert.equal(status(current.p, current.r, "characters"), "draft");
  await assert.rejects(f.op("compile-video-plan"), /确认/);
  const result = await f.op("generate-all-settings", {
    version_id: current.r.steps.characters.selected,
  });
  assert.equal(result.queued, 1);
  assert.equal((await listJobs(f.pid)).length, 1);
  // A different story invalidates this draft's right to generate images.
  await selectFixture(f, "另一个故事");
  await assert.rejects(
    f.op("character-image", { asset_id: "draft-umbrella" }),
    /更新并确认/,
  );
});

test("storyboard creation and resource analysis share text and workflow model settings and only return proposals", async () => {
  const { storyboardAssistant } =
    await import("../src/lib/server/storyboard-assistant");
  const f = await setup();
  const { p } = await f.read();
  const frozen = digest(p);
  const saved = await config();
  await storeConfig({
    ...saved,
    text_provider: "ark",
    text_model: "text-unit",
    agent_provider: "ark",
    agent_model: "workflow-unit",
  });
  const content = {
    prompt: "雨夜",
    beats: [
      {
        id: "b1",
        start: 0,
        end: 2,
        description: "机器人停下",
      },
      {
        id: "b2",
        start: 2,
        end: 8,
        description: "机器人撑伞",
      },
    ],
  };
  const models: string[] = [];
  let resourceAttempts = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    models.push(body.model);
    if (body.tool_choice === "none") return formToolReply(body, {});
    if (body.model === "workflow-unit") {
      resourceAttempts++;
      if (resourceAttempts > 1) {
        const feedback = body.messages.find((m: Json) => m.role === "tool");
        assert.match(feedback.content, /characters\[0\].*未授权字段：manual/);
        assert.equal(JSON.parse(feedback.content).executed, false);
      }
    }
    return body.model === "text-unit"
      ? formToolReply(body, content, "propose_storyboard")
      : formToolReply(
          body,
          {
            world: {},
            characters: [
              {
                ...(resourceAttempts === 1 ? { manual: true } : {}),
                asset_id: "",
                version: "",
                kind: "prop",
                name: "雨伞",
                description: "黄色蜡布伞",
                segment_ids: ["b2"],
              },
            ],
          },
          "propose_resource_bindings",
        );
  };
  try {
    const first = await storyboardAssistant(p.id, {
      ...f.ids,
      role: "storyboard",
      content: { prompt: "", beats: [] },
      resources: { world: {}, characters: [] },
    });
    assert.equal(first.patch?.planning_mode, "storyboard");
    assert.deepEqual(first.patch?.segments, []);
    const second = await storyboardAssistant(p.id, {
      ...f.ids,
      role: "resource",
      content: first.patch,
      resources: { world: {}, characters: [] },
    });
    assert(second.patch?.characters[0].asset_id);
    assert.deepEqual(second.patch?.characters[0].segment_ids, ["b2"]);
    assert(models.includes("text-unit"));
    assert(models.includes("workflow-unit"));
    assert.equal(resourceAttempts, 2);
    assert.equal(second.patch?.characters[0].manual, false);
    assert.equal(digest(await loadProject(p.id)), frozen);
    assert.equal((await listJobs(p.id)).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await storeConfig(saved);
  }
});

test("single-shot optimization uses shared text model, preserves tags and never writes project state", async () => {
  const { storyboardAssistant } =
    await import("../src/lib/server/storyboard-assistant");
  const f = await setup();
  const frozen = digest(await loadProject(f.pid));
  const saved = await config();
  await storeConfig({
    ...saved,
    text_provider: "ark",
    text_model: "shot-unit",
  });
  const content = {
    prompt: "无对白",
    beats: [
      {
        id: "b1",
        start: 0,
        end: 2,
        description: "@resource:robot_default 走近。",
      },
      { id: "b2", start: 2, end: 8, description: "撑伞。" },
    ],
  };
  const description =
    "画面与动作：@resource:robot_default 走近邮筒。\n镜头：低机位缓慢推近。\n台词与旁白：无对白\n声音：细雨与脚步声。";
  let attempts = 0;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "shot-unit");
    if (request.tool_choice === "none") return formToolReply(request, {});
    attempts++;
    const context = JSON.parse(request.messages[1].content);
    assert.deepEqual(context.current_shot, content.beats[0]);
    assert.deepEqual(context.current_storyboard.beats[1], content.beats[1]);
    assert.deepEqual(
      Object.keys(request.tools[0].function.parameters.properties),
      ["description"],
    );
    if (attempts === 2)
      assert.match(
        request.messages.findLast((message: Json) => message.role === "tool")
          .content,
        /保留当前镜头的全部资源标签/,
      );
    return formToolReply(
      request,
      { description: attempts === 1 ? "错误地删除资源" : description },
      "optimize_shot",
    );
  };
  try {
    const response = await storyboardAssistant(f.pid, {
      ...f.ids,
      role: "storyboard",
      operation: "optimize",
      beat_id: "b1",
      content,
      resources: { world: {}, characters: [] },
    });
    assert.equal(attempts, 2);
    assert.equal(response.role, "shot");
    assert.equal(response.beat_id, "b1");
    assert.deepEqual(response.patch, { description });
    assert.equal(digest(await loadProject(f.pid)), frozen);
    assert.equal((await listJobs(f.pid)).length, 0);
    await assert.rejects(
      storyboardAssistant(f.pid, {
        ...f.ids,
        role: "storyboard",
        operation: "optimize",
        beat_id: "missing",
        content,
      }),
      /有效分镜/,
    );
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await storeConfig(saved);
  }
});

test("required result schema failures are bounded and execute no tools in an invalid batch", async () => {
  const { runCreationAgent } = await import("../src/lib/server/creation-agent");
  let requests = 0;
  let executions = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: `read-${requests}`,
                type: "function",
                function: { name: "read", arguments: "{}" },
              },
              {
                id: `write-${requests}`,
                type: "function",
                function: {
                  name: "write",
                  arguments: JSON.stringify({ forbidden: true }),
                },
              },
            ],
          },
        },
      ],
    });
  };
  try {
    await assert.rejects(
      () =>
        runCreationAgent({
          instructions: "返回结果",
          context: {},
          messages: [],
          requireResult: true,
          maxReads: 1,
          tools: ["read", "write"].map((name) => ({
            name,
            description: name,
            readOnly: name === "read",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            execute() {
              executions++;
            },
          })),
        }),
      /未生成有效结果卡片/,
    );
    assert.equal(requests, 3);
    assert.equal(executions, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resource matching preserves immutable reference images when its world summary or descriptions differ", async () => {
  const { storyboardAssistant } =
    await import("../src/lib/server/storyboard-assistant");
  const f = await setup();
  const { r } = await f.read();
  const content = {
    prompt: "雨夜",
    beats: [
      {
        id: "b1",
        start: 0,
        end: 8,
        description: "黄色雨伞",
        camera: "固定",
        dialogue: "",
        resources_reviewed: true,
      },
    ],
  };
  const resources = {
    world: { premise: "旧规范" },
    characters: [
      {
        asset_id: "reference-umbrella",
        version: "reference-v1",
        kind: "prop",
        name: "黄色雨伞",
        description: "原始蜡布描述",
        images: [{ url: "https://example.test/umbrella.jpg" }],
        segment_ids: ["b1"],
      },
    ],
  };
  await f.op("save-storyboard", {
    content,
    resources,
    base_director: r.steps.director.selected,
    base_resources: r.steps.characters.selected,
  });
  globalThis.fetch = async (_url, init) =>
    formToolReply(
      JSON.parse(String(init?.body)),
      {
        world: { premise: "重述规范" },
        characters: [
          {
            asset_id: "reference-umbrella",
            version: "reference-v1",
            kind: "prop",
            name: "雨伞",
            description: "模型重述的外观",
            appearance_changed: true,
            segment_ids: ["b1"],
          },
        ],
      },
      "propose_resource_bindings",
    );
  try {
    const result = await storyboardAssistant(f.pid, {
      ...f.ids,
      role: "resource",
      content,
      resources,
    });
    assert(result.patch);
    const entry = result.patch.characters[0];
    assert.equal(entry.description, "原始蜡布描述");
    assert.equal(entry.version, "reference-v1");
    assert.equal(entry.images.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resource matching preserves manual per-shot choices and fills other shots", async () => {
  const { storyboardAssistant } =
    await import("../src/lib/server/storyboard-assistant");
  const f = await setup();
  const { r } = await f.read();
  const content = {
    prompt: "雨夜",
    beats: [
      {
        id: "b1",
        start: 0,
        end: 4,
        description: "黄色雨伞",
        camera: "固定",
        dialogue: "",
      },
      {
        id: "b2",
        start: 4,
        end: 8,
        description: "黄色雨伞",
        camera: "固定",
        dialogue: "",
      },
    ],
  };
  const manual = {
    asset_id: "manual-umbrella",
    version: "manual-v1",
    kind: "prop",
    name: "黄色雨伞",
    description: "蜡布伞",
    images: [{ url: "https://example.test/umbrella.jpg" }],
    segment_ids: ["b1"],
    manual: true,
    reference_image: "https://example.test/umbrella.jpg",
  };
  const resources = { world: {}, characters: [manual] };
  await f.op("save-storyboard", {
    content,
    resources,
    base_director: r.steps.director.selected,
    base_resources: r.steps.characters.selected,
  });
  globalThis.fetch = async (_url, init) =>
    formToolReply(
      JSON.parse(String(init?.body)),
      {
        world: {},
        characters: [
          {
            asset_id: manual.asset_id,
            version: manual.version,
            kind: manual.kind,
            name: manual.name,
            description: manual.description,
            segment_ids: ["b1", "b2"],
          },
        ],
      },
      "propose_resource_bindings",
    );
  try {
    const result = await storyboardAssistant(f.pid, {
      ...f.ids,
      role: "resource",
      content,
      resources,
    });
    assert(result.patch);
    assert.equal(result.patch.characters.length, 2);
    assert.deepEqual(result.patch.characters[0], manual);
    assert.deepEqual(result.patch.characters[1].segment_ids, ["b2"]);
    assert.equal(result.patch.characters[1].images.length, 1);
    assert(result.patch.characters[1].binding_id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
