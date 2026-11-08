import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { database, transaction, type DB } from "./db";
import { AppError, assert, PROFILES, type Json } from "../domain";
import {
  IMAGE_MODELS,
  imageProvider,
  TEXT_PROVIDERS,
  DEFAULT_TEXT_MODEL,
  ARK,
  WAN,
  wanBase,
} from "../models";
export { ARK, WAN } from "../models";
export const dataDir = () => path.resolve(process.env.DATA_DIR || "data");
async function key() {
  const file = path.join(dataDir(), ".encryption-key");
  await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 });
  try {
    return await fs.readFile(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    try {
      await fs.writeFile(file, randomBytes(32), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    return fs.readFile(file);
  }
}
export async function config(db: DB = database()): Promise<Json> {
  const row = (
    await db.query("SELECT encrypted FROM settings WHERE id='models'")
  ).rows[0];
  let c: Json = {};
  if (row) {
    const [iv, tag, payload] = row.encrypted
      .split(":")
      .map((s: string) => Buffer.from(s, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", await key(), iv);
    decipher.setAuthTag(tag);
    c = JSON.parse(
      Buffer.concat([decipher.update(payload), decipher.final()]).toString(),
    );
  }
  const resolved = {
    ...c,
    api_key: c.api_key || process.env.ARK_API_KEY || "",
    wan_api_key: c.wan_api_key || process.env.DASHSCOPE_API_KEY || "",
    wan_region: c.wan_region || process.env.WAN_REGION || "beijing",
    wan_workspace: c.wan_workspace || "",
    image_model:
      c.image_model ||
      process.env.ARK_IMAGE_MODEL ||
      "doubao-seedream-5-0-pro-260628",
    model: c.model || "doubao-seedance-2-5-260628",
    llm_api_key: c.llm_api_key || process.env.LLM_API_KEY || "",
    llm_base_url: c.llm_base_url || process.env.LLM_BASE_URL || "",
  };
  const provider =
    c.text_provider ||
    (resolved.api_key ? "ark" : resolved.llm_api_key ? "compatible" : "ark");
  const textModel =
    c.text_model ||
    (provider === "ark"
      ? process.env.ARK_TEXT_MODEL || DEFAULT_TEXT_MODEL
      : process.env.LLM_MODEL || "");
  return {
    ...resolved,
    text_provider: provider,
    text_model: textModel,
    agent_provider: c.agent_provider || provider,
    agent_model: c.agent_model || textModel,
  };
}
export async function storeConfig(c: Json, db: DB = database()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await key(), iv);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify(c)),
    cipher.final(),
  ]);
  const text = [iv, cipher.getAuthTag(), payload]
    .map((b) => b.toString("base64"))
    .join(":");
  await db.query(
    "INSERT INTO settings(id,encrypted) VALUES('models',$1) ON CONFLICT(id) DO UPDATE SET encrypted=$1,updated_at=CURRENT_TIMESTAMP",
    [text],
  );
}
function validateKey(value: unknown) {
  assert(
    typeof value === "string" && value.length <= 4096 && !/\s/.test(value),
    "API Key 格式不正确",
  );
}
function validateBase(value: unknown) {
  assert(typeof value === "string" && value.length <= 2000, "服务地址不正确");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("请输入完整的 HTTP 或 HTTPS 服务地址");
  }
  assert(
    ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "服务地址必须为 HTTP 或 HTTPS，且不能包含账号、密钥或查询参数",
  );
  return value.replace(/\/+$/, "");
}
export async function updateConfig(body: Json) {
  return transaction(async (db) => {
    assert(
      !body.section || ["models", "connections"].includes(body.section),
      "配置模块不正确",
    );
    assert(
      !(
        await db.query(
          "SELECT 1 FROM jobs WHERE state IN ('queued','running') AND kind IN ('video','video-batch','character-image','conversation','text','characters','finish') LIMIT 1",
        )
      ).rowCount,
      "模型任务执行期间不能修改配置，请等待任务完成",
    );
    const c = await config(db);
    if (body.section !== "models") {
      for (const field of ["api_key", "wan_api_key", "llm_api_key"]) {
        if (body[field]) {
          validateKey(body[field]);
          c[field] = body[field];
        }
      }
      if (body.wan_region) {
        assert(WAN[body.wan_region], "地域不正确");
        c.wan_region = body.wan_region;
      }
      if (body.wan_workspace !== undefined) {
        assert(
          typeof body.wan_workspace === "string" &&
            (!body.wan_workspace ||
              /^[a-zA-Z0-9-]{1,100}$/.test(body.wan_workspace)),
          "业务空间 ID 格式不正确",
        );
        c.wan_workspace = body.wan_workspace;
      }
      if (body.llm_base_url !== undefined)
        c.llm_base_url = body.llm_base_url
          ? validateBase(body.llm_base_url)
          : "";
    }
    if (body.section !== "connections") {
      if (body.image_model) {
        assert(Object.hasOwn(IMAGE_MODELS, body.image_model), "生图模型不正确");
        c.image_model = body.image_model;
      }
      if (body.model) {
        assert(Object.hasOwn(PROFILES, body.model), "视频模型不支持");
        c.model = body.model;
      }
      for (const field of ["text_provider", "agent_provider"]) {
        if (body[field] !== undefined) {
          assert(Object.hasOwn(TEXT_PROVIDERS, body[field]), "文本服务不支持");
          c[field] = body[field];
        }
      }
      for (const field of ["text_model", "agent_model"]) {
        if (body[field] !== undefined) {
          assert(
            typeof body[field] === "string" &&
              body[field].trim().length > 0 &&
              body[field].length <= 200 &&
              !/\s/.test(body[field]),
            "请填写有效的模型 ID（不能包含空格）",
          );
          c[field] = body[field];
        }
      }
    }
    await storeConfig(c, db);
    return publicConfig(db);
  });
}
export function textConnection(c: Json, role: "text" | "agent" = "text") {
  const provider = c[`${role}_provider`];
  return {
    provider,
    key:
      provider === "ark"
        ? c.api_key
        : provider === "wan"
          ? c.wan_api_key
          : c.llm_api_key,
    base:
      provider === "ark"
        ? ARK
        : provider === "wan"
          ? wanBase(c.wan_region, c.wan_workspace).replace(
              /\/api\/v1$/,
              "/compatible-mode/v1",
            )
          : c.llm_base_url,
    model: c[`${role}_model`],
  };
}
export async function publicConfig(db: DB = database()) {
  const c = await config(db);
  const text = textConnection(c),
    agent = textConnection(c, "agent");
  return {
    video_configured: !!c.api_key,
    wan_configured: !!c.wan_api_key,
    ark_configured: !!c.api_key,
    compatible_configured: !!(c.llm_api_key && c.llm_base_url),
    text_configured: !!(text.key && text.base && text.model),
    agent_configured: !!(agent.key && agent.base && agent.model),
    image_configured: !!(imageProvider(c.image_model) === "wan"
      ? c.wan_api_key
      : c.api_key),
    audio_configured: !!c.api_key,
    image_model: c.image_model,
    video_model: c.model,
    wan_region: c.wan_region,
    wan_workspace: c.wan_workspace,
    text_provider: c.text_provider,
    text_model: c.text_model,
    agent_provider: c.agent_provider,
    agent_model: c.agent_model,
    llm_base_url: c.llm_base_url,
  };
}

export async function serviceConnection(body: Json, supplied?: Json) {
  const c = supplied || (await config());
  assert(["ark", "wan", "compatible"].includes(body.provider), "服务不支持");
  const field =
    body.provider === "ark"
      ? "api_key"
      : body.provider === "wan"
        ? "wan_api_key"
        : "llm_api_key";
  const secret = body.api_key || c[field];
  assert(secret, "请先输入或保存 API Key");
  validateKey(secret);
  const region = body.wan_region || c.wan_region;
  if (body.provider === "wan") assert(WAN[region], "地域不正确");
  const base =
    body.provider === "ark"
      ? ARK
      : body.provider === "wan"
        ? wanBase(region, body.wan_workspace ?? c.wan_workspace)
        : validateBase(body.base_url ?? c.llm_base_url);
  if (body.provider === "wan")
    assert(
      !body.wan_workspace ||
        (typeof body.wan_workspace === "string" &&
          /^[a-zA-Z0-9-]{1,100}$/.test(body.wan_workspace)),
      "业务空间 ID 格式不正确",
    );
  return { secret, base };
}

export async function serviceJSON(url: string, secret: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new AppError("连接失败或超时，请检查服务地址、网络与地域");
  }
  if (!response.ok) {
    if (response.status === 401)
      throw new AppError("鉴权失败（HTTP 401），请检查 API Key 和地域");
    if (response.status === 403)
      throw new AppError(
        "无访问权限（HTTP 403），请检查 Key 权限、地域及账号状态",
      );
    if (response.status === 404)
      throw new AppError(
        "模型列表接口不存在（HTTP 404），请检查 API 地址；部分服务可能不支持模型列表查询",
      );
    // Do not echo provider messages: upstream errors may contain credentials.
    throw new AppError(
      `连接测试未通过（HTTP ${response.status}），请检查服务配置或稍后重试`,
    );
  }
  let value: Json;
  try {
    value = await response.json();
  } catch {
    throw new AppError(
      `服务返回非 JSON 响应（HTTP ${response.status}），请检查 API 地址`,
    );
  }
  assert(
    value &&
      typeof value === "object" &&
      value.success !== false &&
      !value.code,
    "服务未返回有效的模型列表，暂无法确认连接与鉴权状态",
  );
  return value;
}

export async function testConnection(body: Json) {
  const { secret, base } = await serviceConnection(body);
  const started = Date.now();
  const value = await serviceJSON(base + "/models", secret);
  const models = Array.isArray(value?.data)
    ? value.data
    : value?.output?.models;
  assert(
    Array.isArray(models),
    "服务未返回有效的模型列表，暂无法确认连接与鉴权状态",
  );
  return {
    ok: true,
    latency_ms: Date.now() - started,
    checked_at: Date.now(),
    model_count: models.length,
    message: "连接与鉴权成功；具体模型权限以实际调用为准",
  };
}
