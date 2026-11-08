import { dialogueText } from "../src/lib/storyboard";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resizeShot,
  insertShot,
  deleteShot,
  sequenceShots,
} from "../src/lib/storyboard-timeline";
const shots = [
  {
    id: "a",
    start: 0,
    end: 1.5,
    description: "@resource:robot",
    dialogue: "机器人：你好",
    sound: "雨声",
  },
  {
    id: "b",
    start: 1.5,
    end: 4,
    description: "走近",
    dialogue: "无对白",
    sound: "脚步声",
  },
  {
    id: "c",
    start: 4,
    end: 8,
    description: "撑伞",
    dialogue: "旁白：天亮了",
    sound: "风声",
  },
];
test("resizing a shot ripples later times and preserves resource tags and audio", () => {
  const result = resizeShot(shots, "a", 2.3);
  assert.deepEqual(
    result.map((shot) => [shot.start, shot.end]),
    [
      [0, 2.3],
      [2.3, 4.8],
      [4.8, 8.8],
    ],
  );
  assert.equal(result[0].description, "@resource:robot");
  assert.equal(result[1].sound, "脚步声");
  assert.equal(result[2].dialogue, "旁白：天亮了");
  assert.equal(shots[1].start, 1.5);
  for (const duration of [0, -1, NaN, Infinity])
    assert.equal(resizeShot(shots, "a", duration), shots);
});
test("inserting on either side and deleting keeps the timeline continuous", () => {
  const before = insertShot(
    shots,
    { id: "new", start: 0, end: 3 },
    "b",
    "before",
  );
  const after = insertShot(
    shots,
    { id: "new", start: 0, end: 3 },
    "b",
    "after",
  );
  assert.deepEqual(
    before.map((shot) => shot.id),
    ["a", "new", "b", "c"],
  );
  assert.deepEqual(
    after.map((shot) => shot.id),
    ["a", "b", "new", "c"],
  );
  assert.equal(before[2].start, 4.5);
  assert.equal(after[2].start, 4);
  assert.equal(
    insertShot([], { id: "first", start: 0, end: 3 }, "", "before")[0].end,
    3,
  );
  assert.deepEqual(deleteShot([shots[0]], "a"), []);
  const deleted = deleteShot(shots, "b");
  assert.deepEqual(
    deleted.map((shot) => [shot.start, shot.end]),
    [
      [0, 1.5],
      [1.5, 5.5],
    ],
  );
  const inserted = sequenceShots([
    shots[0],
    { id: "new", start: 0, end: 3 },
    ...shots.slice(1),
  ]);
  assert.deepEqual(
    inserted.map((shot) => [shot.start, shot.end]),
    [
      [0, 1.5],
      [1.5, 4.5],
      [4.5, 7],
      [7, 11],
    ],
  );
});

test("explicit no-dialogue directions and sound effects are not subtitle text", () => {
  assert.equal(dialogueText({ dialogue: " 无对白 ", sound: "雨声" }), "");
  assert.equal(dialogueText({ sound: "脚步声" }), "");
  assert.equal(
    dialogueText({ dialogue: "机器人：你好", sound: "风声" }),
    "机器人：你好",
  );
});

test("subtitle text is read from the complete shot description, excluding sound design", () => {
  assert.equal(
    dialogueText({
      description:
        "画面与动作：机器人走近。\n镜头：中景。\n台词与旁白：机器人：你好\n声音：脚步声与风声",
    }),
    "机器人：你好",
  );
  assert.equal(
    dialogueText({ description: "台词与旁白：无对白\n声音：雨声" }),
    "",
  );
});
