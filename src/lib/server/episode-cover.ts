import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { assert, digest, view } from "../domain";
import { playableEpisodes } from "../project-overview";
import { loadProject } from "./repository";
import { mediaPath } from "./files";
import { ff } from "./render";

const pending = new Map<string, Promise<void>>();
export async function episodeCover(projectId: string, episodeId: string) {
  const project = view(await loadProject(projectId));
  const item = playableEpisodes(project).find(
    (entry) => entry.episode.id === episodeId,
  );
  assert(item, "本集暂无可播放成片");
  return cachedVideoCover(item.output.content.url);
}

export async function cachedVideoCover(url: string) {
  assert(
    typeof url === "string" && url.startsWith("/media/"),
    "封面需要本地成片",
  );
  const source = await mediaPath(decodeURIComponent(url.slice(7)));
  const stat = await fs.stat(source);
  const key = digest({ source, size: stat.size, modified: stat.mtimeMs });
  const target = await mediaPath(`covers/${key}.jpg`, false);
  try {
    return await fs.readFile(target);
  } catch {}
  let task = pending.get(key);
  if (!task) {
    task = (async () => {
      const temporary = await mediaPath(
        `covers/${key}-${randomUUID()}.jpg`,
        false,
      );
      try {
        await ff(
          [
            "-y",
            "-i",
            source,
            "-frames:v",
            "1",
            "-vf",
            "scale=640:-2",
            "-q:v",
            "3",
            temporary,
          ],
          30000,
        );
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    })();
    pending.set(key, task);
  }
  try {
    await task;
  } finally {
    if (pending.get(key) === task) pending.delete(key);
  }
  return fs.readFile(target);
}
