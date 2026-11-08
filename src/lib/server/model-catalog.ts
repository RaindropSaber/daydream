import { PROFILES, digest, assert, type Json } from "../domain";
import {
  imageProvider,
  type ModelProvider,
  type ModelCapability,
  type CatalogModel,
  type ProviderCatalog,
} from "../models";
import { config, serviceConnection, serviceJSON } from "./settings";

export function normalizeCatalogModel(
  provider: ModelProvider,
  raw: Json,
): CatalogModel | null {
  const id = raw.id || raw.model;
  if (typeof id !== "string" || !id || id.length > 200 || /\s/.test(id))
    return null;
  const output =
    raw.modalities?.output_modalities ||
    raw.inference_metadata?.response_modality ||
    [];
  const hints = [
    ...(Array.isArray(output) ? output : []),
    ...(Array.isArray(raw.capabilities) ? raw.capabilities : []),
    raw.domain || "",
    ...(Array.isArray(raw.task_type) ? raw.task_type : []),
  ].map((v) => String(v).toLowerCase());
  const capabilities: ModelCapability[] = [];
  if (
    hints.some((v) =>
      [
        "image",
        "ig",
        "imagegeneration",
        "text_to_image",
        "image_to_image",
      ].includes(v),
    )
  )
    capabilities.push("image");
  if (
    hints.some((v) =>
      [
        "video",
        "vg",
        "videogeneration",
        "text_to_video",
        "image_to_video",
        "multimodal_to_video",
      ].includes(v),
    )
  )
    capabilities.push("video");
  if (
    hints.some((v) =>
      [
        "text",
        "tg",
        "reasoning",
        "llm",
        "vlm",
        "textgeneration",
        "text_generation",
      ].includes(v),
    )
  )
    capabilities.push("text");
  // Minimal OpenAI model lists contain only IDs. Leave their modality unverified
  // instead of classifying image/video/audio IDs as text by default.
  const supported: ModelCapability[] = [];
  if (provider === imageProvider(id) && capabilities.includes("image"))
    supported.push("image");
  if (
    capabilities.includes("video") &&
    PROFILES[id] &&
    (provider === "wan"
      ? PROFILES[id].provider === "wan"
      : provider === "ark" && PROFILES[id].provider === "seedance")
  )
    supported.push("video");
  const json = raw.features?.structured_outputs?.json_object;
  const thinking = raw.features?.thinking?.types;
  if (
    capabilities.includes("text") &&
    raw.api_supported?.["chat/completions"] !== false &&
    json !== false &&
    !(
      provider === "ark" &&
      Array.isArray(thinking) &&
      !thinking.includes("disabled")
    )
  )
    supported.push("text");
  const retired = ["retired", "deprecated", "unpublished", "offline"].includes(
    String(raw.status || "").toLowerCase(),
  );
  return {
    id,
    name: typeof raw.name === "string" ? raw.name.slice(0, 200) : id,
    provider,
    capabilities,
    supported_roles: retired ? [] : supported,
    permission: "unknown",
    ...(!capabilities.length
      ? { reason: "服务未提供能力分类，可使用手动模型 ID" }
      : retired
        ? { reason: "模型已下线" }
        : !supported.length
          ? {
              reason: capabilities.includes("text")
                ? "当前调用方式或 JSON 输出不兼容"
                : "应用暂未适配此模型",
            }
          : {}),
  };
}

type CacheEntry = { expires: number; value: ProviderCatalog };
const state = globalThis as typeof globalThis & {
  frameflowCatalogCache?: Map<string, CacheEntry>;
};
const cache = (state.frameflowCatalogCache ??= new Map());
export function clearModelCatalog() {
  cache.clear();
}

async function pages(
  base: string,
  secret: string,
  kind: "models" | "permissions",
) {
  const rows: Json[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    const url = new URL(
      `${base}/${kind === "permissions" ? "models/permissions" : "models"}`,
    );
    url.searchParams.set("page_no", String(page));
    url.searchParams.set("page_size", "100");
    if (kind === "permissions") {
      url.searchParams.set("authorization_scope", "AUTHORIZED");
      url.searchParams.set("action", "INFERENCE");
    }
    const value = await serviceJSON(url.toString(), secret);
    const batch =
      kind === "permissions" ? value.output?.permissions : value.output?.models;
    assert(Array.isArray(batch), "服务未返回有效的模型列表");
    const signature = digest(batch);
    assert(
      !batch.length || !seen.has(signature),
      "服务返回了重复分页，模型列表未更新，请稍后重试",
    );
    seen.add(signature);
    rows.push(...batch);
    const total = Number(value.output?.total);
    if (
      (Number.isFinite(total) && total >= 0 && rows.length >= total) ||
      (!Number.isFinite(total) && batch.length < 100)
    )
      return rows;
    assert(batch.length > 0, "模型列表分页不完整，请重新拉取");
  }
  throw new Error("模型列表页数超过上限，未更新列表");
}

export async function providerCatalog(
  provider: ModelProvider,
  c: Json,
  force = false,
): Promise<ProviderCatalog> {
  const configured = !!(provider === "ark"
    ? c.api_key
    : provider === "wan"
      ? c.wan_api_key
      : c.llm_api_key && c.llm_base_url);
  if (!configured) return { provider, configured: false, models: [] };
  try {
    const { base, secret } = await serviceConnection({ provider }, c);
    const key = digest({ provider, base, secret });
    const saved = cache.get(key);
    if (!force && saved && saved.expires > Date.now()) return saved.value;
    let raw: Json[];
    if (provider === "wan") raw = await pages(base, secret, "models");
    else {
      const value = await serviceJSON(base + "/models", secret);
      assert(Array.isArray(value.data), "服务未返回有效的模型列表");
      raw = value.data;
    }
    const models = [
      ...new Map(
        raw
          .map((m) => normalizeCatalogModel(provider, m))
          .filter((m): m is CatalogModel => !!m)
          .map((m) => [m.id, m]),
      ).values(),
    ];
    let notice =
      provider === "ark"
        ? "已获取当前账号可见模型；开通状态需要额外的 Access Key 鉴权，当前未核验。"
        : undefined;
    if (provider === "wan") {
      if (c.wan_region === "beijing" && c.wan_workspace) {
        try {
          const permissions = await pages(base, secret, "permissions");
          const authorized = new Set(
            permissions
              .filter((p) => p.permissions?.inference === true)
              .map((p) => p.model),
          );
          for (const model of models)
            if (authorized.has(model.id)) model.permission = "authorized";
          notice =
            "已核对业务空间的显式推理授权；未查到授权的模型保留为待确认。";
        } catch {
          notice = "模型目录已获取，授权信息查询未成功；调用权限待确认。";
        }
      } else
        notice =
          c.wan_region === "beijing"
            ? "填写业务空间 ID 后，可进一步查询北京地域的模型授权。"
            : "该地域暂未核验模型授权，调用权限待确认。";
    }
    const result = {
      provider,
      configured,
      models,
      fetched_at: Date.now(),
      notice,
    };
    cache.set(key, { value: result, expires: Date.now() + 300_000 });
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
    return result;
  } catch (e) {
    return {
      provider,
      configured,
      models: [],
      error: e instanceof Error ? e.message : "模型列表读取失败",
    };
  }
}

export async function modelCatalog(force = false) {
  const c = await config();
  const providers = await Promise.all(
    (["ark", "wan", "compatible"] as const).map((p) =>
      providerCatalog(p, c, force),
    ),
  );
  return { providers };
}
