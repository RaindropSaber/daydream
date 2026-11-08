import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  imageRequest,
  saveImageResponse,
} from "../src/lib/server/image-provider";
import { imageSource } from "../src/lib/server/files";
import { IMAGE_MODELS, imageProvider } from "../src/lib/models";
import { normalizeCatalogModel } from "../src/lib/server/model-catalog";

const originalFetch = globalThis.fetch;
const originalDataDir = process.env.DATA_DIR;
let directory: string;
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "frameflow-image-test-"));
  process.env.DATA_DIR = directory;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
after(async () => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  await fs.rm(directory, { recursive: true, force: true });
});

const connection = {
  api_key: "ark-key",
  wan_api_key: "wan-key",
  wan_region: "singapore",
  wan_workspace: "test-space",
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/N8AAAAASUVORK5CYII=",
  "base64",
);
const output = (url: string) => ({
  output: { choices: [{ message: { content: [{ image: url }] } }] },
});

test("every registered Qwen model uses Bailian image generation, matching workspace, region and reference protocol", () => {
  for (const model of Object.keys(IMAGE_MODELS).filter(
    (id) => imageProvider(id) === "wan",
  )) {
    const request = imageRequest(
      connection,
      model,
      "角色设定",
      "data:image/png;base64,abc=",
    );
    assert.equal(
      request.url,
      "https://test-space.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
    assert.equal(request.key, "wan-key");
    assert.equal(request.payload.model, model);
    assert.deepEqual(request.payload.input?.messages, [
      {
        role: "user",
        content: [
          { image: "data:image/png;base64,abc=" },
          { text: "角色设定" },
        ],
      },
    ]);
    assert.deepEqual(
      normalizeCatalogModel("wan", { model, capabilities: ["IG"] })
        ?.supported_roles,
      ["image"],
    );
    assert.deepEqual(
      normalizeCatalogModel("ark", { id: model, domain: "ImageGeneration" })
        ?.supported_roles,
      [],
    );
  }
  const request = imageRequest(
    { wan_api_key: "key" },
    "qwen-image-3.0",
    "场景",
  );
  assert.match(request.url, /^https:\/\/dashscope.aliyuncs.com\/api\/v1\//);
  assert.deepEqual(request.payload.input?.messages[0].content, [
    { text: "场景" },
  ]);
  assert.equal(request.payload.parameters?.n, 1);
});

test("unsupported Qwen and image translation models stay unavailable; missing Bailian credentials fail before submission", () => {
  for (const model of [
    "qwen-mt-image",
    "qwen-image-future",
    "qwen-image-edit",
  ]) {
    assert.equal(imageProvider(model), undefined);
    assert.throws(() => imageRequest(connection, model, "test"), /尚未适配/);
  }
  assert.throws(
    () => imageRequest({ api_key: "ark-only" }, "qwen-image-2.1-pro", "test"),
    /百炼 API Key/,
  );
  assert.deepEqual(
    normalizeCatalogModel("wan", {
      model: "qwen-image-3.0",
      capabilities: ["IG"],
      status: "offline",
    })?.supported_roles,
    [],
  );
});

test("Seedream preserves its existing JPEG request and storage path", async () => {
  const request = imageRequest(
    connection,
    "doubao-seedream-5-0-pro-260628",
    "test",
    "https://example.com/ref.jpg",
  );
  assert.equal(request.key, "ark-key");
  assert.match(request.url, /volces.com\/api\/v3\/images\/generations$/);
  assert("image" in request.payload);
  assert.equal(request.payload.image, "https://example.com/ref.jpg");
  assert.equal(request.payload.response_format, "b64_json");
  const jpeg = Buffer.from([255, 216, 255, 224]);
  const image = await saveImageResponse(
    { data: [{ b64_json: jpeg.toString("base64") }] },
    request.payload.model,
    "seedream.jpg",
  );
  assert.equal(image.file, "seedream.jpg");
  assert.deepEqual(
    await fs.readFile(path.join(directory, "media", image.file)),
    jpeg,
  );
});

test("Qwen PNG results are downloaded locally and reusable as PNG reference images without leaking credentials", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://results.example.com/image.png?signature=fixture",
    );
    assert.equal(options?.headers, undefined);
    return new Response(png);
  };
  const image = await saveImageResponse(
    output("https://results.example.com/image.png?signature=fixture"),
    "qwen-image-3.0",
    "character-test-portrait.jpg",
  );
  assert.equal(image.file, "character-test-portrait.png");
  assert.equal(image.url, "/media/character-test-portrait.png");
  assert.deepEqual(
    await fs.readFile(path.join(directory, "media", image.file)),
    png,
  );
  assert.equal(
    await imageSource(image),
    `data:image/png;base64,${png.toString("base64")}`,
  );
});

test("Qwen rejects failed responses, invalid media and oversized downloads without writing files", async () => {
  await assert.rejects(
    saveImageResponse(
      { code: "InvalidParameter" },
      "qwen-image-3.0",
      "failed.jpg",
    ),
    /生图响应无效/,
  );
  await assert.rejects(
    saveImageResponse(
      output("http://results.example.com/image.png"),
      "qwen-image-3.0",
      "failed.jpg",
    ),
    /下载地址无效/,
  );
  globalThis.fetch = async () => new Response("not-an-image");
  await assert.rejects(
    saveImageResponse(
      output("https://results.example.com/bad.png"),
      "qwen-image-3.0",
      "failed.jpg",
    ),
    /有效的PNG或JPEG/,
  );
  globalThis.fetch = async () =>
    new Response(png, {
      headers: { "content-length": String(21 * 1024 * 1024) },
    });
  await assert.rejects(
    saveImageResponse(
      output("https://results.example.com/large.png"),
      "qwen-image-3.0",
      "failed.jpg",
    ),
    /超过20MB/,
  );
  globalThis.fetch = async () => new Response(new Uint8Array(21 * 1024 * 1024));
  await assert.rejects(
    saveImageResponse(
      output("https://results.example.com/large.png"),
      "qwen-image-3.0",
      "failed.jpg",
    ),
    /超过20MB/,
  );
  await assert.rejects(fs.access(path.join(directory, "media", "failed.png")));
});
