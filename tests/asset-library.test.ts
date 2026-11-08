import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrate, database } from "../src/lib/server/db";
import { createProject, mutate } from "../src/lib/server/studio";
import { uploadAssetImage } from "../src/lib/server/asset-library";
import {
  loadProject,
  saveProject,
  saveJob,
} from "../src/lib/server/repository";
import {
  assetDefinition,
  adoptedAssetVersion,
  searchAssets,
  assetUsages,
} from "../src/lib/asset-library";
import {
  selected,
  addVersion,
  newRun,
  copy,
  digest,
  uid,
  now,
} from "../src/lib/domain";
import { withAccount } from "../src/lib/server/account-context";

let directory: string;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/N8AAAAASUVORK5CYII=",
  "base64",
);
before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "daydream-assets-"));
  process.env.DATA_DIR = directory;
  process.env.SQLITE_PATH = path.join(directory, "test.sqlite3");
  await migrate();
});
after(async () => {
  await database().end();
  await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const { project } = await createProject({ title: "素材交互验证" });
  const asset = await mutate(project.id, "asset", {
    name: "小机器人 Robot",
    kind: "character",
    description: "米白色金属，暖黄色眼睛",
  });
  const read = async () =>
    (await loadProject(project.id)).assets.find(
      (a) => a.id === asset.asset_id,
    )!;
  return { pid: project.id, asset, read };
}

test("uploads and generated candidates stay separate from definitions and adoption", async () => {
  const f = await fixture();
  const draft = await f.read();
  const original = digest(draft.versions);
  const image = await uploadAssetImage(
    f.pid,
    draft.id,
    f.asset.version_id,
    png,
  );
  let a = await f.read();
  assert.equal(a.selected, draft.selected);
  assert.equal(adoptedAssetVersion(a, "default"), undefined);
  assert.equal(assetDefinition(a, "default")!.id, f.asset.version_id);
  assert.equal(digest(a.versions.slice(0, 1)), original);
  assert.equal(a.versions.at(-1)!.images[0].pose, "uploaded");
  assert(
    (
      await fs.stat(
        path.join(directory, "media", a.versions.at(-1)!.images[0].file),
      )
    ).size > 0,
  );
  await mutate(f.pid, "asset-adopt", {
    asset_id: a.id,
    version_id: image.version_id,
    expected_adopted: null,
  });
  a = await f.read();
  assert.equal(adoptedAssetVersion(a, "default")!.id, image.version_id);
  const edit = await mutate(f.pid, "asset", {
    asset_id: a.id,
    kind: a.kind,
    name: a.name,
    base_version: f.asset.version_id,
    description: "换成深蓝色金属外壳",
  });
  a = await f.read();
  assert.equal(adoptedAssetVersion(a, "default")!.id, image.version_id);
  assert.equal(assetDefinition(a, "default")!.id, edit.version_id);
  assert.deepEqual(
    assetDefinition(a, "default")!.reference_images,
    a.versions.find((v) => v.id === image.version_id)!.images,
  );
  const second = await uploadAssetImage(f.pid, a.id, edit.version_id, png);
  assert.equal(
    adoptedAssetVersion(await f.read(), "default")!.id,
    image.version_id,
  );
  await assert.rejects(
    mutate(f.pid, "asset-adopt", {
      asset_id: a.id,
      version_id: second.version_id,
      expected_adopted: null,
    }),
    /采用版本已变化/,
  );
  await mutate(f.pid, "asset-adopt", {
    asset_id: a.id,
    version_id: second.version_id,
    expected_adopted: image.version_id,
  });
  await assert.rejects(
    mutate(f.pid, "asset", {
      asset_id: a.id,
      kind: a.kind,
      name: a.name,
      base_version: f.asset.version_id,
      description: "旧页面覆盖",
    }),
    /设定已更新/,
  );
  const frozen = digest((await f.read()).versions);
  await assert.rejects(
    uploadAssetImage(
      f.pid,
      a.id,
      edit.version_id,
      Buffer.from("<svg>not allowed</svg>"),
    ),
    /PNG或JPEG/,
  );
  await assert.rejects(
    uploadAssetImage(f.pid, a.id, "missing", png),
    /版本不存在/,
  );
  await assert.rejects(
    withAccount("another-account", () =>
      uploadAssetImage(f.pid, a.id, edit.version_id, png),
    ),
    /项目不存在/,
  );
  assert.equal(digest((await f.read()).versions), frozen);
});

test("story states keep independent definitions and adopted images; search includes states, descriptions and tags", async () => {
  const f = await fixture();
  const image = await uploadAssetImage(
    f.pid,
    f.asset.asset_id,
    f.asset.version_id,
    png,
  );
  await mutate(f.pid, "asset-adopt", {
    asset_id: f.asset.asset_id,
    version_id: image.version_id,
    expected_adopted: null,
  });
  const state = await mutate(f.pid, "asset-state", {
    asset_id: f.asset.asset_id,
    version_id: f.asset.version_id,
    state_name: "穿雨衣",
    description: "黄色雨衣，保持原有外形",
  });
  let a = await f.read();
  assert.equal(adoptedAssetVersion(a, "default")!.id, image.version_id);
  assert.equal(adoptedAssetVersion(a, state.state_id), undefined);
  assert.deepEqual(
    assetDefinition(a, state.state_id)!.reference_images,
    a.versions.find((v) => v.id === image.version_id)!.images,
  );
  const rainImage = await uploadAssetImage(f.pid, a.id, state.version_id, png);
  await mutate(f.pid, "asset-adopt", {
    asset_id: a.id,
    version_id: rainImage.version_id,
    expected_adopted: null,
  });
  a = await f.read();
  assert.equal(adoptedAssetVersion(a, "default")!.id, image.version_id);
  assert.equal(
    adoptedAssetVersion(a, state.state_id)!.id,
    rainImage.version_id,
  );
  assert.equal(searchAssets([a], " ROBOT 雨衣 ").length, 1);
  assert.equal(searchAssets([a], "金属").length, 1);
  a.versions[0].tags = ["机械角色"];
  assert.equal(searchAssets([a], "机械角色").length, 1);
  assert.equal(searchAssets([a], "robot", "scene").length, 0);
  assert.equal(searchAssets([a], "不存在").length, 0);
  assert.equal(searchAssets([a], "   ").length, 1);
  await assert.rejects(
    mutate(f.pid, "asset-state", {
      asset_id: a.id,
      version_id: image.version_id,
      state_name: "穿雨衣",
      description: "同名状态",
    }),
    /同名状态/,
  );
});

test("adoption never updates shots; explicit reference updates are atomic, scoped and preserve ended schemes", async () => {
  const f = await fixture();
  const firstImage = await uploadAssetImage(
    f.pid,
    f.asset.asset_id,
    f.asset.version_id,
    png,
  );
  await mutate(f.pid, "asset-adopt", {
    asset_id: f.asset.asset_id,
    version_id: firstImage.version_id,
    expected_adopted: null,
  });
  await mutate(f.pid, "episodes", { title: "第1集" });
  let p = await loadProject(f.pid);
  const a = p.assets[0];
  const image = a.versions.find((v) => v.id === firstImage.version_id)!;
  const episode = p.episodes[0];
  const run = episode.runs[0];
  addVersion(
    run,
    "director",
    {
      planning_mode: "storyboard",
      beats: [{ id: "b1", start: 0, end: 4, description: "机器人走过街角" }],
      segments: [],
    },
    p,
    "manual",
    true,
    true,
  );
  addVersion(
    run,
    "characters",
    {
      world: {},
      characters: [
        {
          ...copy(image),
          asset_id: a.id,
          kind: a.kind,
          version: image.id,
          name: a.name,
          segment_ids: ["b1"],
        },
      ],
    },
    p,
    "manual",
    true,
    true,
  );
  const ended = {
    ...copy(run),
    id: uid(),
    name: "已结束方案",
    finished_at: now(),
  };
  episode.runs.push(ended);
  const untouched = newRun("另一个方案");
  episode.runs.push(untouched);
  await saveProject(p);
  const originalSettings = selected(run, "characters")!;
  const before = digest(originalSettings);
  const nextImage = await uploadAssetImage(
    f.pid,
    a.id,
    f.asset.version_id,
    png,
  );
  await mutate(f.pid, "asset-adopt", {
    asset_id: a.id,
    version_id: nextImage.version_id,
    expected_adopted: firstImage.version_id,
  });
  p = await loadProject(f.pid);
  assert.equal(digest(selected(p.episodes[0].runs[0], "characters")), before);
  const usage = assetUsages(p, a.id, "default");
  assert.equal(usage.length, 2);
  assert.deepEqual(usage[0].shots, ["镜头 01"]);
  assert.equal(usage.find((u) => u.run_id === ended.id)!.locked, true);
  await assert.rejects(
    mutate(f.pid, "asset-update-references", {
      asset_id: a.id,
      version_id: nextImage.version_id,
      targets: usage,
    }),
    /结束或锁定/,
  );
  assert.equal(
    digest(
      selected((await loadProject(f.pid)).episodes[0].runs[0], "characters"),
    ),
    before,
  );
  const targets = usage.filter((u) => !u.locked);
  const job = {
    id: uid(),
    project_id: f.pid,
    episode_id: episode.id,
    run_id: run.id,
    kind: "video",
    state: "queued",
    message: "等待",
    created: now(),
  };
  await saveJob(job);
  await assert.rejects(
    mutate(f.pid, "asset-update-references", {
      asset_id: a.id,
      version_id: nextImage.version_id,
      targets,
    }),
    /正在生成/,
  );
  await saveJob({ ...job, state: "failed" });
  await mutate(f.pid, "asset-update-references", {
    asset_id: a.id,
    version_id: nextImage.version_id,
    targets,
  });
  p = await loadProject(f.pid);
  const updated = selected(p.episodes[0].runs[0], "characters")!;
  assert.notEqual(updated.id, originalSettings.id);
  assert.equal(updated.approved, false);
  assert.equal(updated.content.characters[0].version, nextImage.version_id);
  assert.equal(
    digest(
      p.episodes[0].runs[0].steps.characters.versions.find(
        (v) => v.id === originalSettings.id,
      ),
    ),
    before,
  );
  assert.equal(
    digest(p.episodes[0].runs.find((r) => r.id === ended.id)),
    digest(ended),
  );
  assert.equal(
    digest(p.episodes[0].runs.find((r) => r.id === untouched.id)),
    digest(untouched),
  );
  await assert.rejects(
    mutate(f.pid, "asset-update-references", {
      asset_id: a.id,
      version_id: nextImage.version_id,
      targets,
    }),
    /绑定已变化/,
  );
});
