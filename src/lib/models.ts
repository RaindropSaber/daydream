export const IMAGE_MODELS: Record<string, string> = {
  "doubao-seedream-5-0-pro-260628": "Seedream 5.0 Pro",
  "doubao-seedream-5-0-flash-260915": "Seedream 5.0 Flash",
  "qwen-image-3.0-pro": "Qwen Image 3.0 Pro",
  "qwen-image-3.0": "Qwen Image 3.0",
  "qwen-image-2.1-pro": "Qwen Image 2.1 Pro",
  "qwen-image-2.1-turbo": "Qwen Image 2.1 Turbo",
  "qwen-image-2.0-pro": "Qwen Image 2.0 Pro",
  "qwen-image-2.0-pro-2026-06-22": "Qwen Image 2.0 Pro · 2026-06-22",
  "qwen-image-2.0-pro-2026-04-22": "Qwen Image 2.0 Pro · 2026-04-22",
  "qwen-image-2.0-pro-2026-03-03": "Qwen Image 2.0 Pro · 2026-03-03",
  "qwen-image-2.0": "Qwen Image 2.0",
  "qwen-image-2.0-2026-03-03": "Qwen Image 2.0 · 2026-03-03",
};

export const TEXT_PROVIDERS: Record<string, string> = {
  ark: "火山方舟",
  wan: "阿里云百炼",
  compatible: "自定义兼容服务",
};

export type ModelProvider = "ark" | "wan" | "compatible";
export type ModelCapability = "text" | "image" | "video";
export interface CatalogModel {
  id: string;
  name: string;
  provider: ModelProvider;
  capabilities: ModelCapability[];
  supported_roles: ModelCapability[];
  permission: "authorized" | "unknown";
  reason?: string;
}
export interface ProviderCatalog {
  provider: ModelProvider;
  configured: boolean;
  models: CatalogModel[];
  fetched_at?: number;
  error?: string;
  notice?: string;
}
export function wanBase(region: string, workspace = "") {
  if (!workspace) return WAN[region];
  const location = region === "singapore" ? "ap-southeast-1" : "cn-beijing";
  return `https://${workspace}.${location}.maas.aliyuncs.com/api/v1`;
}

export const DEFAULT_TEXT_MODEL = "deepseek-v4-1-flash-261017";

export const ARK = "https://ark.cn-beijing.volces.com/api/v3";
export const WAN: Record<string, string> = {
  beijing: "https://dashscope.aliyuncs.com/api/v1",
  singapore: "https://dashscope-intl.aliyuncs.com/api/v1",
};

export function imageProvider(model: string): "ark" | "wan" | undefined {
  if (!Object.hasOwn(IMAGE_MODELS, model)) return undefined;
  return model.startsWith("qwen-image-") ? "wan" : "ark";
}

// Keep planning constraints aligned with the payload adapter.
export function videoReferenceLimits(model: string) {
  if (model === "wan2.6-t2v") return { image: 0, video: 0, audio: 0 };
  if (model.startsWith("wan")) return { image: 1, video: 0, audio: 0 };
  return model.includes("2-5")
    ? { image: 30, video: 10, audio: 10 }
    : { image: 9, video: 3, audio: 3 };
}
