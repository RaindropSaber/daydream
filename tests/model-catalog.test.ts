import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCatalogModel,
  providerCatalog,
  clearModelCatalog,
} from "../src/lib/server/model-catalog";
import type { Json } from "../src/lib/types";
import { textConnection } from "../src/lib/server/settings";
import { wanBase } from "../src/lib/models";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearModelCatalog();
});
const connection = {
  wan_api_key: "catalog-test-key",
  wan_region: "beijing",
  wan_workspace: "workspace-test",
};

test("Bailian text and video calls use the same configured workspace and region", () => {
  const text = textConnection({
    ...connection,
    text_provider: "wan",
    text_model: "qwen-test",
  });
  assert.equal(
    text.base,
    "https://workspace-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  );
  assert.equal(text.key, "catalog-test-key");
  assert.equal(
    wanBase("singapore", "workspace-test"),
    "https://workspace-test.ap-southeast-1.maas.aliyuncs.com/api/v1",
  );
  assert.equal(wanBase("beijing"), "https://dashscope.aliyuncs.com/api/v1");
});

test("classification uses output capabilities and distinguishes application support from provider visibility", () => {
  const vision = normalizeCatalogModel("ark", {
    id: "vision",
    domain: "VLM",
    modalities: {
      input_modalities: ["text", "image", "video"],
      output_modalities: ["text"],
    },
    features: { structured_outputs: { json_object: true } },
  })!;
  assert.deepEqual(vision.capabilities, ["text"]);
  assert.deepEqual(vision.supported_roles, ["text"]);
  assert.equal(vision.permission, "unknown");
  assert.deepEqual(
    normalizeCatalogModel("ark", {
      id: "doubao-seedream-5-0-pro-260628",
      domain: "ImageGeneration",
    })!.supported_roles,
    ["image"],
  );
  const newVideo = normalizeCatalogModel("wan", {
    model: "future-video",
    capabilities: ["VG"],
  })!;
  assert.deepEqual(newVideo.capabilities, ["video"]);
  assert.deepEqual(newVideo.supported_roles, []);
  assert.match(newVideo.reason!, /未适配/);
  assert.deepEqual(
    normalizeCatalogModel("ark", {
      id: "no-json",
      domain: "LLM",
      features: { structured_outputs: { json_object: false } },
    })!.supported_roles,
    [],
  );
  assert.deepEqual(
    normalizeCatalogModel("ark", {
      id: "retired",
      domain: "LLM",
      status: "Deprecated",
    })!.supported_roles,
    [],
  );
  assert.deepEqual(
    normalizeCatalogModel("compatible", { id: "unknown-capability" })!
      .capabilities,
    [],
  );
  assert.equal(normalizeCatalogModel("ark", { id: "invalid id" }), null);
});

test("Bailian catalog and permissions read all pages and only explicit positive grants become authorized", async () => {
  const calls: URL[] = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(
      (options?.headers as Json).Authorization,
      "Bearer catalog-test-key",
    );
    assert.equal(options?.body, undefined);
    assert.equal(options?.redirect, "error");
    const page = Number(url.searchParams.get("page_no"));
    if (url.pathname.endsWith("/permissions")) {
      assert.equal(url.searchParams.get("authorization_scope"), "AUTHORIZED");
      return Response.json({
        output: {
          total: 2,
          permissions:
            page === 1
              ? [{ model: "qwen-0", permissions: { inference: true } }]
              : [{ model: "qwen-1", permissions: { inference: false } }],
        },
      });
    }
    return Response.json({
      output: {
        total: 101,
        models: Array.from({ length: page === 1 ? 100 : 1 }, (_, i) => ({
          model: `qwen-${(page - 1) * 100 + i}`,
          capabilities: ["TG"],
        })),
      },
    });
  };
  const result = await providerCatalog("wan", connection);
  assert.equal(result.models.length, 101);
  assert.equal(result.models[0].permission, "authorized");
  assert.equal(result.models[1].permission, "unknown");
  assert.deepEqual(result.models[100].supported_roles, ["text"]);
  assert.equal(calls.length, 4);
  assert.equal(
    calls[0].hostname,
    "workspace-test.cn-beijing.maas.aliyuncs.com",
  );
  assert(!JSON.stringify(result).includes("catalog-test-key"));
  await providerCatalog("wan", connection);
  assert.equal(calls.length, 4, "cached list must not refetch");
  await providerCatalog("wan", connection, true);
  assert.equal(calls.length, 8);
});

test("permission failure leaves the catalog usable and unknown, and key changes invalidate the cache", async () => {
  let reads = 0;
  globalThis.fetch = async (input) => {
    reads++;
    return String(input).includes("/permissions")
      ? new Response("forbidden", { status: 403 })
      : Response.json({
          output: {
            total: 1,
            models: [{ model: "wan2.6-t2v", capabilities: ["VG"] }],
          },
        });
  };
  const result = await providerCatalog("wan", connection);
  assert.equal(result.models[0].permission, "unknown");
  assert.deepEqual(result.models[0].supported_roles, ["video"]);
  assert.match(result.notice!, /未成功/);
  await providerCatalog("wan", { ...connection, wan_api_key: "changed-key" });
  assert.equal(reads, 4);
});

test("repeated or incomplete pagination is rejected without returning a misleading partial catalog", async () => {
  globalThis.fetch = async () =>
    Response.json({
      output: { total: 200, models: [{ model: "one", capabilities: ["TG"] }] },
    });
  const repeated = await providerCatalog("wan", connection);
  assert.deepEqual(repeated.models, []);
  assert.match(repeated.error!, /重复分页/);
  globalThis.fetch = async () =>
    Response.json({ output: { total: 5, models: [] } });
  const incomplete = await providerCatalog("wan", connection);
  assert.deepEqual(incomplete.models, []);
  assert.match(incomplete.error!, /分页不完整/);
});

test("catalog failure and malformed connection details stay isolated from other providers", async () => {
  globalThis.fetch = async () =>
    new Response("secret-from-upstream", { status: 401 });
  const failed = await providerCatalog("ark", {
    api_key: "secret-from-upstream",
  });
  assert.match(failed.error!, /401/);
  assert(!JSON.stringify(failed).includes("secret-from-upstream"));
  const malformed = await providerCatalog("compatible", {
    llm_api_key: "test",
    llm_base_url: "bad-url",
  });
  assert(malformed.error);
  assert.equal((await providerCatalog("wan", {})).configured, false);
});
