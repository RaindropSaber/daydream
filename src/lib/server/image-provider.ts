import fs from "node:fs/promises";
import { assert, type Json } from "../domain";
import { ARK, imageProvider, wanBase } from "../models";
import { mediaPath } from "./files";

export function imageRequest(
  config: Json,
  model: string,
  prompt: string,
  reference?: string,
) {
  const provider = imageProvider(model);
  assert(provider, "生图模型尚未适配");
  const qwen = provider === "wan";
  const key = qwen ? config.wan_api_key : config.api_key;
  assert(key, qwen ? "请先配置阿里云百炼 API Key" : "请先配置方舟 API Key");
  const base = qwen
    ? wanBase(config.wan_region || "beijing", config.wan_workspace || "")
    : ARK;
  assert(base, "生图服务地域无效");
  if (qwen && reference?.startsWith("data:")) {
    const encoded = reference.split(",")[1] || "";
    assert(
      Buffer.from(encoded, "base64").length <= 10 * 1024 * 1024,
      "Qwen 参考图片不能超过10MB",
    );
  }
  return {
    key,
    base,
    url:
      base +
      (qwen
        ? "/services/aigc/multimodal-generation/generation"
        : "/images/generations"),
    timeout: qwen ? 600000 : 180000,
    payload: qwen
      ? {
          model,
          input: {
            messages: [
              {
                role: "user",
                content: [
                  ...(reference ? [{ image: reference }] : []),
                  { text: prompt },
                ],
              },
            ],
          },
          parameters: {
            size: "2048*2048",
            n: 1,
            watermark: false,
            prompt_extend: false,
          },
        }
      : {
          model,
          prompt,
          size: "2K",
          output_format: "jpeg",
          response_format: "b64_json",
          watermark: false,
          ...(reference ? { image: reference } : {}),
        },
  };
}

const imageLimit = 20 * 1024 * 1024;
async function downloadImage(url: string) {
  const parsed = new URL(url);
  assert(
    parsed.protocol === "https:" && !parsed.username && !parsed.password,
    "生图下载地址无效",
  );
  const response = await fetch(url, {
    signal: AbortSignal.timeout(120000),
    redirect: "error",
  });
  assert(
    response.ok && response.body,
    "生图结果下载失败，请核对控制台，勿重复提交",
  );
  assert(
    Number(response.headers.get("content-length") || 0) <= imageLimit,
    "图片超过20MB",
  );
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      assert(total <= imageLimit, "图片超过20MB");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export async function saveImageResponse(
  value: Json,
  model: string,
  file: string,
) {
  let bytes: Buffer;
  if (imageProvider(model) === "wan") {
    const url = value.output?.choices?.[0]?.message?.content?.find(
      (part: Json) => typeof part.image === "string",
    )?.image;
    assert(typeof url === "string", "生图响应无效，请核对控制台，勿重复提交");
    bytes = await downloadImage(url);
  } else {
    const encoded = value.data?.[0]?.b64_json;
    assert(
      typeof encoded === "string" && encoded.length < 30 * 1024 * 1024,
      "生图响应无效，请核对控制台，勿重复提交",
    );
    bytes = Buffer.from(encoded, "base64");
  }
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  assert(
    bytes.length <= imageLimit && (png || jpeg),
    "生图结果不是有效的PNG或JPEG",
  );
  const target = file.replace(/\.(?:jpg|png)$/, png ? ".png" : ".jpg");
  assert(
    target !== file || (png ? file.endsWith(".png") : file.endsWith(".jpg")),
    "生图文件名无效",
  );
  await fs.writeFile(await mediaPath(target, false), bytes);
  return { file: target, url: "/media/" + target, model };
}
