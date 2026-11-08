import type { Job, Run } from "./types";

export function videoCardState(
  run: Run,
  jobs: Job[],
  segmentId: string,
  viewedVersionId?: string,
) {
  const tasks = jobs
    .filter(
      (job) =>
        job.run_id === run.id &&
        job.kind === "video" &&
        job.segment_id === segmentId,
    )
    .sort((a, b) => b.created - a.created);
  const active =
    tasks.find((job) => job.state === "running") ||
    tasks.find((job) => job.state === "queued");
  const versions = run.media[segmentId] || [];
  const version =
    versions.find((v) => v.id === viewedVersionId) || versions.at(-1);
  const latest = tasks[0];
  const failed =
    latest?.state === "failed" &&
    latest.created >= Math.max(0, ...versions.map((v) => v.created));
  const job = active || (failed ? latest : undefined);
  const state = active
    ? active.state
    : failed
      ? "failed"
      : !version
        ? "empty"
        : version.id === run.media_selection[segmentId]
          ? run.media_fresh?.[segmentId]
            ? "approved"
            : "stale"
          : "candidate";
  return { state, job };
}
