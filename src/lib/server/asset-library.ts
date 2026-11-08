import fs from "node:fs/promises";
import {
  assert,
  addVersion,
  copy,
  digest,
  inputs,
  selected,
  uid,
  now,
  type Project,
  type Json,
  type Asset,
} from "../domain";
import { stateFields, stateId, stateName } from "../asset-state";
import {
  assetDefinition,
  adoptedAssetVersion,
  assetUsages,
} from "../asset-library";
import type { DB } from "./db";
import { busy, editProject } from "./repository";
import { mediaPath } from "./files";

const findAsset = (p: Project, id: string) => {
  const a = p.assets.find((a) => a.id === id);
  assert(a, "素材不存在");
  return a;
};
function description(value: unknown) {
  assert(
    typeof value === "string" && value.trim() && value.length <= 15000,
    "请填写设定描述（最多15000字）",
  );
  return value.trim();
}
function setDefinition(a: Asset, v: Json) {
  a.versions.push(v);
  a.draft_versions = { ...a.draft_versions, [stateId(v)]: v.id };
  a.selected ??= v.id;
}
export function saveAssetDefinition(p: Project, b: Json) {
  assert(
    ["character", "scene", "prop", "style", "voice", "video"].includes(b.kind),
    "素材类型不正确",
  );
  assert(
    typeof b.name === "string" && b.name.trim() && b.name.length <= 100,
    "请填写素材名称（最多100字）",
  );
  const text = description(b.description);
  assert(
    !b.url ||
      (typeof b.url === "string" &&
        b.url.startsWith("https://") &&
        b.url.length <= 4096),
    "参考地址需为HTTPS",
  );
  let a = b.asset_id ? findAsset(p, b.asset_id) : undefined;
  if (!a) {
    a = {
      id: uid(),
      name: b.name.trim(),
      kind: b.kind,
      versions: [],
      selected: null,
    };
    p.assets.push(a);
  } else assert(a.kind === b.kind, "已有素材不能更改类型，请新建素材");
  const base = b.base_version
    ? a.versions.find((v) => v.id === b.base_version)
    : a.versions.find((v) => v.id === a!.selected);
  if (b.base_version) {
    assert(base, "设定版本不存在");
    assert(
      assetDefinition(a, stateId(base))?.id === base.id,
      "设定已更新，请重新载入后再保存",
    );
  }
  a.name = b.name.trim();
  const reference = adoptedAssetVersion(a, stateId(base || {}));
  const v = {
    ...stateFields(base || {}),
    id: uid(),
    number: a.versions.length + 1,
    description: text,
    images: [],
    url: b.url || "",
    created: now(),
    source: "manual",
    reference_images: copy(
      base?.images?.length
        ? base.images
        : reference?.images?.length
          ? reference.images
          : base?.reference_images || (base?.url ? [{ url: base.url }] : []),
    ),
  };
  setDefinition(a, v);
  return { asset_id: a.id, version_id: v.id, state_id: stateId(v) };
}

export async function mutateAssetLibrary(
  p: Project,
  action: string,
  b: Json,
  db: DB,
) {
  const a = findAsset(p, b.asset_id);
  const version = a.versions.find((v) => v.id === b.version_id);
  assert(version, "素材版本不存在");
  const state = stateId(version);
  if (action === "asset-state") {
    assert(
      typeof b.state_name === "string" &&
        b.state_name.trim() &&
        b.state_name.length <= 80,
      "请填写状态名称（最多80字）",
    );
    assert(
      !a.versions.some((v) => stateName(v) === b.state_name.trim()),
      "已存在同名状态",
    );
    const reference = adoptedAssetVersion(a, state);
    const v = {
      ...stateFields(version),
      state_id: uid(),
      state_name: b.state_name.trim(),
      base_version: version.id,
      id: uid(),
      number: a.versions.length + 1,
      description: description(b.description),
      images: [],
      url: "",
      source: "manual",
      created: now(),
      reference_images: copy(
        version.images?.length
          ? version.images
          : reference?.images?.length
            ? reference.images
            : version.reference_images ||
              (version.url ? [{ url: version.url }] : []),
      ),
    };
    setDefinition(a, v);
    return { version_id: v.id, state_id: v.state_id };
  }
  assert(version.images?.length || version.url, "此版本尚无图片或参考素材");
  if (action === "asset-adopt") {
    assert(
      b.expected_adopted === (adoptedAssetVersion(a, state)?.id || null),
      "当前采用版本已变化，请重新载入后再采用",
    );
    a.adopted_versions = { ...a.adopted_versions, [state]: version.id };
    a.selected = version.id;
    return { version_id: version.id };
  }
  assert(action === "asset-update-references", "素材操作不存在");
  assert(
    adoptedAssetVersion(a, state)?.id === version.id,
    "请先采用需要更新到的版本",
  );
  assert(
    Array.isArray(b.targets) && b.targets.length > 0 && b.targets.length <= 200,
    "请选择要更新的引用",
  );
  const usages = assetUsages(p, a.id, state);
  const targets = b.targets.map((t: Json) => {
    const usage = usages.find(
      (u) =>
        u.episode_id === t.episode_id &&
        u.run_id === t.run_id &&
        u.version_id === t.version_id,
    );
    assert(
      usage && usage.settings_id === t.settings_id,
      "分镜绑定已变化，请重新载入后再更新",
    );
    assert(!usage.locked, "已结束或锁定的方案不能更新引用");
    return usage;
  });
  assert(
    new Set(targets.map((t: Json) => t.run_id)).size === targets.length,
    "同一方案请勿重复选择",
  );
  for (const target of targets) {
    const episode = p.episodes.find((e) => e.id === target.episode_id)!;
    const run = episode.runs.find((r) => r.id === target.run_id)!;
    assert(
      !(await busy(
        run.id,
        [
          "characters",
          "character-image",
          "text",
          "conversation",
          "video",
          "video-batch",
          "finish",
        ],
        db,
      )),
      "所选方案正在生成，请等待任务结束后再更新",
    );
    const current = selected(run, "characters")!;
    assert(
      digest(current.inputs) === digest(inputs(p, run, "characters")),
      "所选方案的上游已变化，请先更新分镜与资源",
    );
    const content = copy(current.content);
    const entry = content.characters.find(
      (entry: Json) =>
        entry.asset_id === a.id &&
        stateId(entry) === state &&
        entry.version === target.version_id,
    );
    assert(entry, "引用已变化，请重新载入");
    Object.assign(entry, stateFields(version), {
      version: version.id,
      name: a.name,
      kind: a.kind,
      description: version.description,
      images: copy(version.images || []),
      url: version.url || "",
      manual: true,
    });
    delete entry.reference_image;
    addVersion(
      run,
      "characters",
      content,
      p,
      "asset-library",
      true,
      false,
      current.inputs,
    );
  }
  return { updated: targets.length };
}

export async function uploadAssetImage(
  projectId: string,
  assetId: string,
  versionId: string,
  bytes: Buffer,
) {
  assert(
    bytes.length > 0 && bytes.length <= 20 * 1024 * 1024,
    "图片大小需在20MB以内",
  );
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  assert(png || jpeg, "请上传PNG或JPEG图片");
  return editProject(projectId, async (p) => {
    const a = findAsset(p, assetId);
    assert(
      ["character", "scene", "prop"].includes(a.kind),
      "此类型不支持上传设定图",
    );
    const base = a.versions.find((v) => v.id === versionId);
    assert(base, "设定版本不存在");
    const id = uid();
    const file = `asset-${id}.${png ? "png" : "jpg"}`;
    await fs.writeFile(await mediaPath(file, false), bytes, { flag: "wx" });
    const v = {
      ...copy(base),
      id,
      number: a.versions.length + 1,
      definition_id: base.definition_id || base.id,
      images: [{ file, url: `/media/${file}`, pose: "uploaded" }],
      url: "",
      source: "upload",
      created: now(),
    };
    a.versions.push(v);
    return { version_id: id };
  });
}
