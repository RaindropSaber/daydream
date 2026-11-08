import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionedSkills, mentionQuery } from "../src/lib/assistant-mentions";
import { mentionInstructions } from "../src/lib/server/creation-agent";

test("skill mentions load only registered skills and preserve editing boundaries", async () => {
  assert.deepEqual(
    mentionedSkills(
      "使用 @skill:director 和 @skill:director、@stage:story @skill:unknown",
    ),
    ["director"],
  );
  const result = await mentionInstructions(
    [{ text: "使用 @skill:director 参考 @stage:story" }],
    "episode",
  );
  assert.deepEqual(result.skills, ["episode", "director"]);
  assert.match(result.instructions, /name: director/);
  assert.match(result.instructions, /不扩大写入权限/);
  await assert.rejects(
    () =>
      mentionInstructions([
        {
          text: "@skill:project @skill:episode @skill:run @skill:asset @skill:director",
        },
      ]),
    /最多引用四个/,
  );
});

test("mention picker finds the query at the caret without treating emails as references", () => {
  assert.deepEqual(mentionQuery("参考 @故事 后面的文字", 6), {
    start: 3,
    end: 6,
    query: "故事",
  });
  assert.deepEqual(mentionQuery("@", 1), { start: 0, end: 1, query: "" });
  assert.equal(mentionQuery("hello@example.com", 17), null);
  assert.equal(mentionQuery("@story 已经写完", 11), null);
});
