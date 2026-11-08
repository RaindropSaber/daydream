import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mediaResponse } from "../src/lib/server/media";
let temporary: string;
before(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "daydream-media-test-"));
  process.env.DATA_DIR = temporary;
  await fs.mkdir(path.join(temporary, "media"));
  await fs.writeFile(path.join(temporary, "media", "clip.mp4"), "0123456789");
});
after(async () => {
  await fs.rm(temporary, { recursive: true, force: true });
});
test("media GET and HEAD retain the exact size while HEAD has no body", async () => {
  const get = await mediaResponse("GET", "clip.mp4", null);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("Content-Length"), "10");
  assert.equal(get.headers.get("Content-Type"), "video/mp4");
  assert.equal(await get.text(), "0123456789");
  const head = await mediaResponse("HEAD", "clip.mp4", null);
  assert.equal(head.headers.get("Content-Length"), "10");
  assert.equal(head.body, null);
});
test("media byte ranges support seeking, open ends and suffixes without sending extra bytes", async () => {
  for (const [range, content, position] of [
    ["bytes=2-5", "2345", "2-5"],
    ["bytes=8-", "89", "8-9"],
    ["bytes=-3", "789", "7-9"],
    ["bytes=7-100", "789", "7-9"],
  ]) {
    const response = await mediaResponse("GET", "clip.mp4", range);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), `bytes ${position}/10`);
    assert.equal(
      response.headers.get("Content-Length"),
      String(content.length),
    );
    assert.equal(await response.text(), content);
  }
});
test("media rejects invalid ranges and paths outside the workspace", async () => {
  for (const range of [
    "bytes=10-",
    "bytes=5-2",
    "bytes=-0",
    "bytes=0-1,3-4",
    "bytes=-",
  ]) {
    const response = await mediaResponse("GET", "clip.mp4", range);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("Content-Range"), "bytes */10");
    assert.equal(response.body, null);
  }
  for (const file of ["missing.mp4", "../clip.mp4", "clip\\mp4"]) {
    assert.equal((await mediaResponse("GET", file, null)).status, 404);
  }
});
