import { currentAccount, assertProjectAccess } from "./account-context";
import { database, transaction, type DB } from "./db";
import {
  type Project,
  type Run,
  type Job,
  type Json,
  newRun,
  now,
  AppError,
} from "../domain";
const omit = (v: Json, keys: string[]) =>
  Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
export async function listProjects() {
  const { rows } = await database().query(
    `SELECT p.id,p.title,p.brief,p.updated_at AS updated,(SELECT count(*) FROM episodes e WHERE e.project_id=p.id) AS episodes,(SELECT count(*) FROM assets a WHERE a.project_id=p.id) AS assets FROM projects p WHERE ($1 IS NULL OR p.user_id=$1) ORDER BY updated_at DESC`,
    [currentAccount() ?? null],
  );
  return rows;
}
export async function loadProject(
  id: string,
  db: DB = database(),
): Promise<Project> {
  await assertProjectAccess(id);
  const row = (await db.query("SELECT * FROM projects WHERE id=$1", [id]))
    .rows[0];
  if (!row) throw new AppError("项目不存在", 404);
  const p: Project = {
    ...row.metadata,
    id: row.id,
    title: row.title,
    brief: row.brief,
    production: (
      await db.query(
        "SELECT style,ratio,prompt,adaptation,revision FROM production_settings WHERE project_id=$1",
        [id],
      )
    ).rows[0] as Project["production"],
    created: row.created_at,
    updated: row.updated_at,
    assets: [],
    episodes: [],
  };
  const assets = (
    await db.query("SELECT * FROM assets WHERE project_id=$1 ORDER BY id", [id])
  ).rows;
  const avs = (
    await db.query(
      "SELECT * FROM asset_versions WHERE project_id=$1 ORDER BY number",
      [id],
    )
  ).rows;
  p.assets = assets.map((a) => ({
    ...a.metadata,
    id: a.id,
    name: a.name,
    kind: a.kind,
    selected: a.selected_version,
    versions: avs
      .filter((v) => v.asset_id === a.id)
      .map((v) => ({
        ...v.content,
        id: v.id,
        number: v.number,
        created: v.created_at,
      })),
  }));
  const eps = (
    await db.query(
      "SELECT * FROM episodes WHERE project_id=$1 ORDER BY number",
      [id],
    )
  ).rows;
  const runs = (
    await db.query(
      "SELECT * FROM production_runs WHERE project_id=$1 ORDER BY created_at,id",
      [id],
    )
  ).rows;
  const ids = runs.map((r) => r.id);
  const get = async (table: string, order: string) =>
    ids.length
      ? (
          await db.query(
            `SELECT * FROM ${table} WHERE run_id IN (SELECT value FROM json_each($1)) ORDER BY ${order}`,
            [JSON.stringify(ids)],
          )
        ).rows
      : [];
  const [versions, selections, messages, media, mediaSelections, exports] = [
    await get("content_versions", "number"),
    await get("selected_versions", "step"),
    await get("conversation_messages", "position"),
    await get("media_versions", "number"),
    await get("media_selections", "segment_id"),
    await get("exports", "created_at"),
  ];
  p.episodes = eps.map((e) => ({
    ...e.metadata,
    id: e.id,
    title: e.title,
    brief: e.brief,
    number: e.number,
    active_run: e.active_run,
    created: e.created_at,
    runs: runs
      .filter((r) => r.episode_id === e.id)
      .map((row) => {
        const r: Run = {
          ...newRun(row.name),
          ...row.metadata,
          id: row.id,
          name: row.name,
          model: row.model,
          planning_schema: row.planning_schema,
          created: row.created_at,
        };
        for (const v of versions.filter((v) => v.run_id === r.id)) {
          const g = (r.steps[v.step] ??= { versions: [], selected: null });
          g.versions.push({
            ...v.metadata,
            id: v.id,
            number: v.number,
            content: v.content,
            inputs: v.inputs,
            approved: v.approved,
            source: v.source,
            created: v.created_at,
          });
        }
        for (const s of selections.filter((s) => s.run_id === r.id))
          r.steps[s.step].selected = s.version_id;
        for (const m of messages.filter((m) => m.run_id === r.id))
          (r.conversations[m.step] ??= []).push({
            ...m.metadata,
            id: m.id,
            role: m.role,
            text: m.text,
            created: m.created_at,
          });
        for (const v of media.filter((v) => v.run_id === r.id))
          (r.media[v.segment_id] ??= []).push({
            ...v.metadata,
            id: v.id,
            number: v.number,
            content: v.content,
            input_hash: v.input_hash,
            created: v.created_at,
          });
        for (const m of mediaSelections.filter((m) => m.run_id === r.id))
          r.media_selection[m.segment_id] = m.version_id;
        r.exports = exports
          .filter((x) => x.run_id === r.id)
          .map((x) => ({
            ...x.metadata,
            id: x.id,
            content: x.content,
            inputs: x.inputs,
            created: x.created_at,
          }));
        return r;
      }),
  }));
  return p;
}
export async function saveProject(
  p: Project,
  db: DB = database(),
  touch = true,
) {
  if (touch) p.updated = now();
  await db.query(
    `INSERT INTO projects(id,title,brief,metadata,created_at,updated_at,user_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET title=$2,brief=$3,metadata=$4,updated_at=$6`,
    [
      p.id,
      p.title,
      p.brief || "",
      omit(p, [
        "id",
        "title",
        "brief",
        "production",
        "assets",
        "episodes",
        "created",
        "updated",
      ]),
      p.created,
      p.updated,
      currentAccount() ?? null,
    ],
  );
  await db.query(
    "INSERT INTO production_settings(project_id,style,ratio,prompt,adaptation,revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id) DO UPDATE SET style=$2,ratio=$3,prompt=$4,adaptation=$5,revision=$6",
    [
      p.id,
      p.production.style,
      p.production.ratio,
      p.production.prompt,
      p.production.adaptation,
      p.production.revision,
    ],
  );
  for (const a of p.assets) {
    await db.query(
      `INSERT INTO assets(project_id,id,name,kind,selected_version,metadata) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,id) DO UPDATE SET name=$3,kind=$4,selected_version=$5,metadata=$6`,
      [
        p.id,
        a.id,
        a.name,
        a.kind,
        a.selected,
        omit(a, ["id", "name", "kind", "selected", "versions"]),
      ],
    );
    for (const v of a.versions)
      await db.query(
        `INSERT INTO asset_versions(project_id,asset_id,id,number,content,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [
          p.id,
          a.id,
          v.id,
          v.number,
          omit(v, ["id", "number", "created"]),
          v.created || now(),
        ],
      );
  }
  for (const e of p.episodes) {
    await db.query(
      `INSERT INTO episodes(id,project_id,title,brief,number,active_run,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET title=$3,brief=$4,active_run=$6,metadata=$7`,
      [
        e.id,
        p.id,
        e.title,
        e.brief || "",
        e.number,
        e.active_run,
        omit(e, [
          "id",
          "title",
          "brief",
          "number",
          "active_run",
          "runs",
          "created",
        ]),
        e.created || p.created,
      ],
    );
    for (const r of e.runs) {
      await db.query(
        `INSERT INTO production_runs(id,episode_id,project_id,name,model,planning_schema,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=$4,model=$5,planning_schema=$6,metadata=$7`,
        [
          r.id,
          e.id,
          p.id,
          r.name,
          r.model,
          r.planning_schema || 2,
          omit(r, [
            "id",
            "name",
            "model",
            "planning_schema",
            "created",
            "steps",
            "media",
            "media_selection",
            "conversations",
            "exports",
            "statuses",
            "media_fresh",
            "current_export",
          ]),
          r.created || p.created,
        ],
      );
      for (const [step, g] of Object.entries(r.steps)) {
        for (const v of g.versions)
          await db.query(
            `INSERT INTO content_versions(run_id,step,id,number,content,inputs,approved,source,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(run_id,step,id) DO UPDATE SET approved=$7`,
            [
              r.id,
              step,
              v.id,
              v.number,
              v.content,
              v.inputs || {},
              !!v.approved,
              v.source || "legacy",
              omit(v, [
                "id",
                "number",
                "content",
                "inputs",
                "approved",
                "source",
                "created",
              ]),
              v.created || now(),
            ],
          );
        if (g.selected)
          await db.query(
            `INSERT INTO selected_versions VALUES($1,$2,$3) ON CONFLICT(run_id,step) DO UPDATE SET version_id=$3`,
            [r.id, step, g.selected],
          );
        else
          await db.query(
            "DELETE FROM selected_versions WHERE run_id=$1 AND step=$2",
            [r.id, step],
          );
      }
      for (const [step, messages] of Object.entries(r.conversations || {}))
        for (const [position, m] of messages.entries())
          await db.query(
            `INSERT INTO conversation_messages(run_id,step,id,position,role,text,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
            [
              r.id,
              step,
              m.id,
              position,
              m.role,
              m.text,
              omit(m, ["id", "role", "text", "created"]),
              m.created || now(),
            ],
          );
      for (const [sid, versions] of Object.entries(r.media))
        for (const v of versions)
          await db.query(
            `INSERT INTO media_versions(run_id,segment_id,id,number,content,input_hash,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
            [
              r.id,
              sid,
              v.id,
              v.number,
              v.content,
              v.input_hash || "",
              omit(v, ["id", "number", "content", "input_hash", "created"]),
              v.created || now(),
            ],
          );
      for (const [sid, id] of Object.entries(r.media_selection))
        await db.query(
          `INSERT INTO media_selections VALUES($1,$2,$3) ON CONFLICT(run_id,segment_id) DO UPDATE SET version_id=$3`,
          [r.id, sid, id],
        );
      for (const x of r.exports)
        await db.query(
          `INSERT INTO exports(run_id,id,content,inputs,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [
            r.id,
            x.id,
            x.content,
            x.inputs || {},
            omit(x, ["id", "content", "inputs", "created"]),
            x.created || now(),
          ],
        );
    }
  }
  return p;
}
export function editProject<T>(
  id: string,
  fn: (p: Project, db: DB) => Promise<T>,
) {
  return transaction(async (db) => {
    const p = await loadProject(id, db);
    const result = await fn(p, db);
    await saveProject(p, db);
    return result;
  });
}
export async function saveJob(j: Job, db: DB = database()) {
  await db.query(
    `INSERT INTO jobs(id,project_id,episode_id,run_id,kind,state,message,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET state=$6,message=$7,data=$8,updated_at=$10`,
    [
      j.id,
      j.project_id,
      j.kind === "asset-image" ? null : j.episode_id,
      j.kind === "asset-image" ? null : j.run_id,
      j.kind,
      j.state,
      j.message,
      omit(j, [
        "id",
        "project_id",
        "episode_id",
        "run_id",
        "kind",
        "state",
        "message",
        "created",
        "updated",
      ]),
      j.created,
      now(),
    ],
  );
  return j;
}
export const jobFromRow = (row: Json): Job => ({
  ...row.data,
  id: row.id,
  project_id: row.project_id,
  episode_id: row.episode_id,
  run_id: row.run_id,
  kind: row.kind,
  state: row.state,
  message: row.message,
  created: row.created_at,
  updated: row.updated_at,
});
export async function loadJob(id: string, db: DB = database()) {
  const row = (await db.query("SELECT * FROM jobs WHERE id=$1", [id])).rows[0];
  if (!row) throw new AppError("任务不存在", 404);
  await assertProjectAccess(row.project_id);
  return jobFromRow(row);
}
export async function listJobs(
  id: string,
  db: DB = database(),
  privateData = false,
) {
  const { rows } = await db.query(
    "SELECT * FROM jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 200",
    [id],
  );
  return rows.map((row) => {
    const j = jobFromRow(row);
    return privateData
      ? j
      : (omit(j, [
          "snapshot",
          "payload",
          "raw_output",
          "key_fingerprint",
          "input_hash",
        ]) as Job);
  });
}
export async function busy(rid: string, kinds: string[], db: DB = database()) {
  return !!(
    await db.query(
      "SELECT 1 FROM jobs WHERE run_id=$1 AND kind IN (SELECT value FROM json_each($2)) AND state IN ('queued','running') LIMIT 1",
      [rid, JSON.stringify(kinds)],
    )
  ).rowCount;
}
