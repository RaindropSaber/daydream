import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesDraft,
  pendingDraft,
  formExcerpt,
} from "../src/lib/assistant-draft";

const before = {
  form: { title: "原名称", brief: "原方向" },
  context: { entry: "a" },
  disabled: false,
};
test("result cards cannot overwrite edited content, changed targets or locked forms", () => {
  assert.equal(matchesDraft(structuredClone(before), before), true);
  assert.equal(
    matchesDraft(
      { ...before, form: { ...before.form, title: "手动修改" } },
      before,
    ),
    false,
  );
  assert.equal(
    matchesDraft({ ...before, context: { entry: "b" } }, before),
    false,
  );
  assert.equal(matchesDraft({ ...before, disabled: true }, before), false);
  assert.equal(matchesDraft(before), false);
});
test("follow-up edits retain the pending proposal without changing the source form", () => {
  const patch = { title: "新名称", brief: "新方向" };
  const messages = [{ patch, before }];
  const pending = pendingDraft(before, messages);
  const nextCard = { ...pending, brief: "修改后的方向" };
  assert.deepEqual(nextCard, { title: "新名称", brief: "修改后的方向" });
  assert.equal(before.form.title, "原名称");
  assert.deepEqual(
    pendingDraft(before, [
      ...messages,
      { patch: nextCard, before, applied: true },
    ]),
    {},
  );
  assert.deepEqual(
    pendingDraft({ ...before, form: { title: "手动编辑" } }, messages),
    {},
  );
});
test("large module content fits the composer while retaining the full form separately", () => {
  const form = { text: "正文".repeat(50000) };
  const excerpt = formExcerpt(form);
  assert.ok(excerpt.length < 11000);
  assert.match(excerpt, /完整内容将随请求提供/);
  assert.equal(form.text.length, 100000);
  assert.equal(
    formExcerpt({ title: "名称" }),
    JSON.stringify({ title: "名称" }, null, 2),
  );
});
