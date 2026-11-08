/** One-way, idempotent import. The legacy SQLite source remains untouched. */
import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { migrate, transaction, database } from "../src/lib/server/db";
import { saveProject, saveJob } from "../src/lib/server/repository";
import { dataDir, storeConfig } from "../src/lib/server/settings";
import {
  type Project,
  type Job,
  type Json,
  copy,
  digest,
  mediaHash,
  inputs,
  selected,
} from "../src/lib/domain";
const source = path.resolve(
  process.argv[2] || path.join(dataDir(), "studio.sqlite3"),
);
await migrate();
await fs.mkdir(path.join(dataDir(), "backups"), {
  recursive: true,
  mode: 0o700,
});
const destination = path.join(
  dataDir(),
  "backups",
  `legacy-sqlite-${Date.now()}.sqlite3`,
);
const old = new DatabaseSync(source, { readOnly: true });
await backup(old, destination);
old.close();
await fs.chmod(destination, 0o600);
const legacy = new DatabaseSync(destination, { readOnly: true });
const projects = legacy
  .prepare("SELECT body FROM studio_projects")
  .all()
  .map((row) => JSON.parse(String(row.body))) as Project[];
const jobs = legacy
  .prepare("SELECT body FROM studio_jobs")
  .all()
  .map((row) => JSON.parse(String(row.body))) as Job[];
legacy.close();
const sourceHash = digest({ projects, jobs });
let rawConfig: Json = {};
try {
  rawConfig = JSON.parse(
    await fs.readFile(path.join(path.dirname(source), "seedance.json"), "utf8"),
  );
} catch {}
const views = new Map<string, Project>();
const legacyURL = process.env.LEGACY_API_URL || "http://127.0.0.1:8787";
for (const p of projects) {
  try {
    const res = await fetch(`${legacyURL}/api/studio/projects/${p.id}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const value = await res.json();
      if (value.project?.updated === p.updated) views.set(p.id, value.project);
    }
  } catch {}
}
const report = {
  projects: projects.length,
  episodes: 0,
  runs: 0,
  assets: 0,
  content_versions: 0,
  media_versions: 0,
  jobs: jobs.length,
  revalidated_media: 0,
  unverified_media: 0,
};
for (const p of projects) {
  p.production = {
    style: p.style,
    ratio: p.ratio,
    prompt: [
      p.creative_prompt || "",
      ...Object.entries(p.creative_spec || {}).map(
        ([key, value]) => `${key}：${value}`,
      ),
    ]
      .filter(Boolean)
      .join("\n"),
    adaptation: "",
    revision: p.config_revision || 0,
  };
  delete p.style;
  delete p.ratio;
  delete p.creative_prompt;
  delete p.creative_spec;
  delete p.config_revision;
  report.assets += p.assets.length;
  for (const e of p.episodes) {
    report.episodes++;
    for (const r of e.runs) {
      report.runs++;
      r.conversations ??= { story: [], director: [], characters: [] };
      r.steps.characters ??= { versions: [], selected: null };
      const oldView = views
        .get(p.id)
        ?.episodes.find((x) => x.id === e.id)
        ?.runs.find((x) => x.id === r.id);
      for (const step of Object.values(r.steps))
        report.content_versions += step.versions.length;
      for (const [sid, vs] of Object.entries(r.media)) {
        report.media_versions += vs.length;
        const adopted = vs.find((v) => v.id === r.media_selection[sid]);
        const s = selected(r, "director")?.content.segments?.find(
          (s: Json) => s.id === sid,
        );
        if (adopted && s && oldView?.media_fresh?.[sid]) {
          const prior = adopted.input_hash,
            replacement = mediaHash(r, s);
          for (const v of vs)
            if (v.input_hash === prior) {
              v.legacy_input_hash = v.input_hash;
              v.input_hash = replacement;
              report.revalidated_media++;
            }
        } else if (adopted) report.unverified_media++;
      }
      if (oldView?.current_export) {
        const out = r.exports.find((x) => x.id === oldView.current_export!.id);
        if (out?.kind === "finish") {
          out.legacy_inputs = copy(out.inputs);
          out.inputs = inputs(p, r, "finish");
        }
      }
    }
  }
}
for (const j of jobs) {
  if (["queued", "running"].includes(j.state)) {
    j.state = "failed";
    j.message = "已从旧工作区迁移；有远端ID可继续查询，请勿重复提交";
  }
  const key =
    j.provider === "wan" || String(j.payload?.model || "").startsWith("wan")
      ? rawConfig.wan_api_key
      : rawConfig.api_key;
  if (
    key &&
    j.key_fingerprint === createHash("sha256").update(key).digest("hex")
  ) {
    j.key_fingerprint = digest(key);
  }
  if (j.snapshot?.entry) j.entry_hash = digest(j.snapshot.entry);
}
const imported = await transaction(async (db) => {
  if (
    (
      await db.query("SELECT 1 FROM legacy_imports WHERE source_hash=$1", [
        sourceHash,
      ])
    ).rowCount
  )
    return false;
  for (const p of projects) {
    if ((await db.query("SELECT 1 FROM projects WHERE id=$1", [p.id])).rowCount)
      throw Error("目标库存在同ID项目，未覆盖现有数据");
    await saveProject(p, db, false);
  }
  for (const j of jobs) await saveJob(j, db);
  await db.query(
    "INSERT INTO legacy_imports(source_hash,report) VALUES($1,$2)",
    [sourceHash, report],
  );
  return true;
});
if (
  imported &&
  Object.keys(rawConfig).length &&
  !(await database().query("SELECT 1 FROM settings WHERE id='models'")).rowCount
)
  await storeConfig(rawConfig);
console.log(
  imported
    ? JSON.stringify(
        { imported: true, ...report, backup: destination },
        null,
        2,
      )
    : "此工作区已经导入，未重复写入。",
);
if (imported && report.unverified_media)
  console.log(
    "部分媒体无法核对旧服务状态，保留为候选；可手动审阅。迁移前保持旧服务运行可完成完整核对。",
  );
await database().end();
