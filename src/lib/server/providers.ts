import { projectPrompt } from "../creative-spec";
import fs from "node:fs/promises";
import {
  assert,
  AppError,
  type Json,
  type Project,
  type Run,
  selected,
  segments,
  entries,
  chosen,
  fresh,
  PROFILES,
  digest,
  mediaHash,
} from "../domain";
import { config, ARK, textConnection } from "./settings";
import { wanBase, videoReferenceLimits } from "../models";
import { imageRequest, saveImageResponse } from "./image-provider";
import { mediaPath, imageSource } from "./files";
export async function providerJSON(
  url: string,
  key: string,
  body?: Json,
  timeout = 180000,
  headers: Json = {},
) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new AppError(
      body
        ? "供应商连接失败，提交结果可能不确定。请先核对控制台，勿重复生成。"
        : "供应商查询失败，可继续查询原任务。",
    );
  }
  let value: Json;
  try {
    value = await response.json();
  } catch {
    throw new AppError("供应商返回无效响应，请核对控制台任务");
  }
  if (!response.ok) {
    const detail = String(
      value.error?.message ||
        value.message ||
        value.code ||
        "请检查模型权限、余额和配置",
    )
      .replaceAll(key, "[redacted]")
      .slice(0, 600);
    throw new AppError(`模型服务 HTTP ${response.status}：${detail}`);
  }
  return value;
}
export async function textJSON(
  system: string,
  context: Json,
  role: "text" | "agent" = "text",
) {
  const c = await config();
  const { key, base, model, provider } = textConnection(c, role);
  assert(
    key,
    `请先配置${role === "agent" ? "功能（流程）" : "文字"}所用服务的 API Key`,
  );
  assert(/^https?:\/\//.test(base), "文本服务地址未配置");
  assert(model, "请先配置文本模型 ID");
  const result = await providerJSON(
    base.replace(/\/$/, "") + "/chat/completions",
    key,
    {
      model,
      response_format: { type: "json_object" },
      max_tokens: 16000,
      ...(provider === "ark" ? { thinking: { type: "disabled" } } : {}),
      messages: [
        {
          role: "system",
          content: system + " 严格返回完整 JSON 对象，不使用 Markdown 围栏。",
        },
        { role: "user", content: JSON.stringify(context) },
      ],
    },
  );
  assert(
    result.choices?.[0]?.finish_reason !== "length",
    "模型输出达到长度上限，请缩小范围后重试",
  );
  try {
    const value = JSON.parse(result.choices[0].message.content);
    assert(value && typeof value === "object", "无效JSON");
    return value;
  } catch {
    throw new AppError("文本模型返回了不完整或无效的 JSON，原有版本保留");
  }
}
export async function videoPayload(
  p: Project,
  r: Run,
  s: Json,
  quality = "standard",
  draftId?: string,
) {
  const c = await config(),
    cap = PROFILES[r.model];
  assert(cap, "视频模型不支持");
  const key = cap.provider === "wan" ? c.wan_api_key : c.api_key;
  assert(key, "请先配置视频模型 API Key");
  if (quality === "final") {
    assert(cap.draft, "模型不支持样片升级");
    const v = r.media[s.id]?.find((v) => v.id === draftId);
    assert(
      v?.content.quality === "draft" && v.input_hash === mediaHash(r, s),
      "请选择有效样片",
    );
    return {
      provider: "seedance",
      key,
      base: ARK,
      payload: {
        model: r.model,
        content: [
          { type: "draft_task", draft_task: { id: v.content.remote_id } },
        ],
        resolution: "1080p",
        watermark: false,
      },
    };
  }
  assert(quality !== "draft" || cap.draft, "模型不支持样片");
  const direction = selected(r, "director")!.content;
  const settings = selected(r, "characters");
  const storyboard = direction.planning_mode === "storyboard";
  // The compiler's segment prompt already contains the complete shot timetable.
  // Send it once; do not append a second copy from direction.beats.
  const timetable = storyboard
    ? s.prompt
    : direction.beats
        .filter((b: Json) => b.start < s.end && b.end > s.start)
        .map(
          (b: Json) =>
            `${Math.max(0, b.start - s.start)}–${Math.min(s.end, b.end) - s.start}秒：${b.description}；镜头：${b.camera || ""}；台词与旁白：${b.dialogue || "未指定"}；环境声与音效：${b.sound || "未指定"}`,
        )
        .join("\n");
  const prompt = [
    `项目创作规范：\n${projectPrompt(p)}`,
    direction.prompt?.trim()
      ? `整集补充要求：\n${direction.prompt.trim()}`
      : "",
    settings?.content.world &&
    Object.values(settings.content.world).some(
      (value) => typeof value === "string" && value.trim(),
    )
      ? `本集美术约定：\n${JSON.stringify(settings.content.world)}`
      : "",
    storyboard
      ? "每个镜头区间是一段连续拍摄，只在标注的镜头边界切镜。保持相邻镜头的动作、视线、位置和道具连续。"
      : "",
    `镜头时间表：\n${timetable}`,
    !storyboard && s.prompt?.trim() ? `片段补充要求：\n${s.prompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const bound = entries(r, s.id),
    boundIds = new Set(bound.map((e) => e.asset_id));
  const refs: Json[] = (s.references || []).filter(
    (ref: Json) =>
      storyboard || (ref.kind !== "character" && !boundIds.has(ref.asset_id)),
  );
  for (const e of storyboard ? [] : bound)
    for (const image of e.images?.length
      ? e.images
      : e.url
        ? [{ url: e.url }]
        : [])
      refs.push({
        asset_id: e.asset_id,
        kind: e.kind || "character",
        name: e.name,
        description: e.description,
        image,
      });
  const content: Json[] = [{ type: "text", text: prompt }];
  const texts: string[] = [];
  const counts: Json = { image: 0, video: 0, audio: 0 };
  for (const ref of refs) {
    const kind =
      ref.kind === "voice" ? "audio" : ref.kind === "video" ? "video" : "image";
    texts.push(`${ref.name}：${ref.description || ""}`);
    if (ref.image?.pose === "character-sheet")
      texts[texts.length - 1] +=
        "（参考图为同一个角色的正面、侧面、背面与半身四视图设定板，仅用于保持角色造型一致；视频按分镜呈现单一连续画面，不复刻四区布局，不把各视图生成为多个角色）";
    if (cap.provider === "wan") {
      assert(!["audio", "video"].includes(kind), "万相不支持音视频参考");
      continue;
    }
    const url = ref.image ? await imageSource(ref.image) : ref.url;
    if (url) {
      assert(
        url.startsWith("https://") ||
          (ref.image && url.startsWith("data:image/")),
        "资源地址需为 HTTPS",
      );
      counts[kind]++;
      content.push({
        type: kind + "_url",
        [kind + "_url"]: { url },
        role: "reference_" + kind,
      });
      texts[texts.length - 1] += `（参考 @${kind}${counts[kind]}）`;
    }
  }
  if (texts.length) content[0].text += "\n资源设定：\n" + texts.join("\n");
  for (const sid of s.depends_on || []) {
    assert(cap.extend, "当前模型不支持续写");
    const parent = segments(r).find((s) => s.id === sid);
    assert(parent && fresh(r, parent), "请先采用有效上游视频");
    const v = chosen(r, sid)!;
    assert(v.content.remote_url, "上游视频缺少原始参考地址");
    counts.video++;
    content.push({
      type: "video_url",
      video_url: { url: v.content.remote_url },
      role: "reference_video",
    });
  }
  if (s.mode === "extend")
    content[0].text =
      `向后续写 @video${counts.video}，延续人物、声音与场景。\n` +
      content[0].text;
  const limits = videoReferenceLimits(r.model);
  assert(
    (["image", "video", "audio"] as const).every((k) => counts[k] <= limits[k]),
    "参考素材超过模型数量上限",
  );
  let payload: Json;
  if (cap.provider === "wan") {
    assert(!s.depends_on?.length && s.mode !== "extend", "万相不支持续写");
    assert(
      content[0].text.length <= 1500,
      "万相完整提示词最多1500字符，请精简设定",
    );
    const options = r.video_options?.[s.id] || {};
    const params: Json = {
      duration: Math.ceil(s.duration),
      prompt_extend: true,
      shot_type: "multi",
      watermark: false,
    };
    const input: Json = { prompt: content[0].text };
    if (cap.image_mode === "text")
      params.size = (
        { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960" } as Json
      )[p.production.ratio];
    else {
      let frame = options.first_frame;
      assert(frame, "请选择首帧图片");
      if (!frame.startsWith("https://")) {
        const ref = refs.find((ref) => ref.image?.file === frame);
        assert(ref, "首帧已不在本段设定集中");
        frame = await imageSource(ref.image);
      }
      input.img_url = frame;
      params.resolution = "720P";
      if (r.model.endsWith("-flash")) params.audio = options.audio !== false;
    }
    payload = { model: r.model, input, parameters: params };
  } else {
    payload = {
      model: r.model,
      content,
      resolution: quality === "draft" ? "480p" : "720p",
      duration: Math.ceil(s.duration),
      ratio: s.mode === "extend" ? "adaptive" : p.production.ratio,
      generate_audio: true,
      watermark: false,
    };
    if (quality === "draft") payload.draft = true;
    if (content.length > 1 && cap.draft)
      payload.omni_reference_task_type = s.mode || "reference";
  }
  assert(
    Buffer.byteLength(JSON.stringify(payload)) < 60 * 1024 * 1024,
    "生成请求超过60MB",
  );
  return {
    provider: cap.provider,
    key,
    base: cap.provider === "wan" ? wanBase(c.wan_region, c.wan_workspace) : ARK,
    payload,
  };
}
export async function createVideo(
  provider: string,
  base: string,
  key: string,
  payload: Json,
) {
  const result = await providerJSON(
    base +
      (provider === "wan"
        ? "/services/aigc/video-generation/video-synthesis"
        : "/contents/generations/tasks"),
    key,
    payload,
    60000,
    provider === "wan" ? { "X-DashScope-Async": "enable" } : {},
  );
  const id = provider === "wan" ? result.output?.task_id : result.id;
  assert(
    typeof id === "string" && /^[\w-]{1,150}$/.test(id),
    "提交响应没有任务ID，请核对控制台，避免重复计费",
  );
  return id;
}
export async function queryVideo(
  provider: string,
  base: string,
  key: string,
  id: string,
) {
  const result = await providerJSON(
    base +
      (provider === "wan" ? "/tasks/" : "/contents/generations/tasks/") +
      encodeURIComponent(id),
    key,
    undefined,
    60000,
  );
  if (provider !== "wan") return result;
  const output = result.output || {};
  return {
    status:
      (
        {
          PENDING: "queued",
          RUNNING: "running",
          SUCCEEDED: "succeeded",
          FAILED: "failed",
          CANCELED: "cancelled",
          UNKNOWN: "expired",
        } as Json
      )[output.task_status] || "unknown",
    content: { video_url: output.video_url },
    duration: result.usage?.output_video_duration || result.usage?.duration,
    usage: result.usage,
    error: { code: output.code },
  };
}
export async function downloadVideo(url: string, file: string) {
  const parsed = new URL(url);
  assert(
    parsed.protocol === "https:" && !parsed.username && !parsed.password,
    "下载地址无效",
  );
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  assert(response.ok && response.body, "视频下载失败，可继续查询原任务");
  const target = await mediaPath(file, false),
    temporary = target + ".part";
  const out = await fs.open(temporary, "w");
  let total = 0,
    first = Buffer.alloc(0);
  try {
    for await (const bytes of response.body as any) {
      const chunk = Buffer.from(bytes);
      if (first.length < 32)
        first = Buffer.concat([first, chunk]).subarray(0, 32);
      total += chunk.length;
      assert(total <= 300 * 1024 * 1024, "视频超过300MB");
      await out.write(chunk);
    }
    assert(
      total >= 32 && first.includes(Buffer.from("ftyp")),
      "下载结果不是有效MP4",
    );
  } finally {
    await out.close();
  }
  await fs.rename(temporary, target);
}
export async function generateImage(
  model: string,
  prompt: string,
  file: string,
  reference?: string,
) {
  const c = await config();
  const request = imageRequest(c, model, prompt, reference);
  const value = await providerJSON(
    request.url,
    request.key,
    request.payload,
    request.timeout,
  );
  return saveImageResponse(value, model, file);
}
