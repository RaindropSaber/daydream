import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantRequest } from "../src/lib/assistant-request";

const page = { project_id: "background", episode_id: "old", run_id: "ended" };

test("new chat requests supply read locators without adding page content or prior messages", () => {
  for (const text of ["聊聊太空旅行", "使用 @skill:episode，写太空冒险大纲"]) {
    assert.deepEqual(assistantRequest([{ role: "user", text }], page), {
      mode: "prompt",
      context_scope: page,
      messages: [{ role: "user", text }],
    });
  }
});

test("current drafts are available as a separate read source without routing the task", () => {
  const messages = [{ role: "user", text: "请完善本集剧情" }];
  const source = {
    skill: "episode" as const,
    form: { title: "", target_duration: 60 },
    context: {},
  };
  const request = assistantRequest(messages, page, source);
  assert.deepEqual(request.form_source, source);
  assert.deepEqual(request.messages, messages);
  assert.equal(Object.hasOwn(request, "skill"), false);
});
