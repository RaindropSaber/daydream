import { stateId, stateName } from "./asset-state";
import type { Asset, Json, Project } from "./types";

export function assetDefinition(asset: Asset, state: string): Json | undefined {
  const id = asset.draft_versions?.[state];
  return (
    asset.versions.find((v) => v.id === id) ||
    [...asset.versions]
      .reverse()
      .find((v) => stateId(v) === state && !v.definition_id)
  );
}

export function adoptedAssetVersion(
  asset: Asset,
  state: string,
): Json | undefined {
  const id = asset.adopted_versions?.[state] || asset.selected;
  return asset.versions.find(
    (v) => v.id === id && stateId(v) === state && (v.images?.length || v.url),
  );
}

export function searchAssets(
  assets: Asset[],
  search: string,
  category = "all",
) {
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return assets.filter((a) => {
    if (category !== "all" && a.kind !== category) return false;
    const text = [
      a.name,
      ...a.versions.flatMap((v) => [
        v.description || "",
        stateName(v),
        ...(v.tags || []),
      ]),
    ]
      .join(" ")
      .toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export type AssetUsage = {
  key: string;
  episode_id: string;
  run_id: string;
  settings_id: string;
  version_id: string;
  episode_title: string;
  run_name: string;
  shots: string[];
  locked: boolean;
};

export function assetUsages(
  project: Project,
  assetId: string,
  state: string,
): AssetUsage[] {
  return project.episodes.flatMap((episode) =>
    episode.runs.flatMap((run) => {
      const settings = run.steps.characters;
      const current = settings?.versions.find(
        (v) => v.id === settings.selected,
      );
      if (!current) return [];
      const director = run.steps.director?.versions.find(
        (v) => v.id === run.steps.director.selected,
      );
      return (current.content.characters || [])
        .filter(
          (entry: Json) =>
            entry.asset_id === assetId && stateId(entry) === state,
        )
        .map((entry: Json) => ({
          key: `${episode.id}:${run.id}:${entry.version}`,
          episode_id: episode.id,
          run_id: run.id,
          settings_id: current.id,
          version_id: entry.version,
          episode_title: episode.title,
          run_name: run.name,
          shots: (entry.segment_ids || []).map((id: string) => {
            const index =
              director?.content.beats?.findIndex(
                (beat: Json) => beat.id === id,
              ) ?? -1;
            return index >= 0
              ? `镜头 ${String(index + 1).padStart(2, "0")}`
              : director?.content.segments?.find((s: Json) => s.id === id)
                  ?.title || id;
          }),
          locked: !!episode.locked_at || !!run.finished_at,
        }));
    }),
  );
}
