import { workflowStages } from "./workflow";
import { TITLES, type Episode, type Job, type Project } from "./types";

export function finishedEpisodeRun(episode: Episode) {
  return episode.runs
    .filter((run) => run.finished_at)
    .sort((a, b) => b.finished_at! - a.finished_at!)[0];
}

export function episodeDisplayRun(episode: Episode) {
  return (
    finishedEpisodeRun(episode) ||
    episode.runs.find((run) => run.id === episode.active_run) ||
    episode.runs[0]
  );
}

// Viewing follows the finished scheme even while another scheme is being edited.
export function playableEpisodes(project: Project) {
  return [...project.episodes]
    .sort((a, b) => b.number - a.number)
    .flatMap((episode) => {
      const finished = finishedEpisodeRun(episode);
      const candidates = episode.runs.filter(
        (run) => run.current_export?.content?.url,
      );
      const run = finished
        ? finished.current_export?.content?.url
          ? finished
          : undefined
        : candidates.find((run) => run.id === episode.active_run) ||
          candidates.sort(
            (a, b) =>
              (b.current_export?.created || b.finished_at || b.created) -
              (a.current_export?.created || a.finished_at || a.created),
          )[0];
      return run ? [{ episode, run, output: run.current_export! }] : [];
    });
}

export function episodeCards(project: Project, jobs: Job[]) {
  const films = new Map(
    playableEpisodes(project).map((item) => [item.episode.id, item]),
  );
  return [...project.episodes]
    .sort((a, b) => b.number - a.number)
    .map((episode) => {
      const run = episodeDisplayRun(episode);
      const editableRun = episode.locked_at
        ? undefined
        : episode.runs.find(
            (candidate) =>
              candidate.id === episode.active_run && !candidate.finished_at,
          ) ||
          [...episode.runs]
            .filter((candidate) => !candidate.finished_at)
            .sort((a, b) => b.created - a.created)[0];
      const viewRun = episode.locked_at ? run : finishedEpisodeRun(episode);
      const editStages = editableRun ? workflowStages(editableRun, jobs) : [];
      const editStage =
        editStages.find((stage) =>
          ["running", "queued"].includes(stage.state),
        ) || editStages.find((stage) => stage.status !== "approved");
      const hasNewVersion =
        !!run?.finished_at &&
        episode.runs.some(
          (candidate) =>
            candidate.id !== run.id &&
            !candidate.finished_at &&
            candidate.created >= run.created,
        );
      const stages = run ? workflowStages(run, jobs) : [];
      const stage =
        stages.find((stage) => ["running", "queued"].includes(stage.state)) ||
        stages.find((stage) => stage.status !== "approved");
      const film = films.get(episode.id);
      const step = run?.finished_at ? "complete" : stage?.id || "story";
      const status = episode.locked_at
        ? "已锁定"
        : run?.finished_at
          ? "已完成"
          : stage?.state === "running"
            ? `正在${TITLES[stage.id]}`
            : stage?.state === "queued"
              ? `${TITLES[stage.id]}排队中`
              : stage?.state === "failed"
                ? `${TITLES[stage.id]}需处理`
                : stage?.state === "stale"
                  ? `${TITLES[stage.id]}待更新`
                  : run?.current_export
                    ? "成片已就绪"
                    : stage?.id === "story" && stage.state === "empty"
                      ? "待制作"
                      : `制作中 · ${TITLES[step] || "故事"}`;
      return {
        episode,
        viewRun,
        editableRun,
        editStep: editStage?.id || "story",
        run,
        film,
        step,
        status,
        hasNewVersion,
        working:
          !run?.finished_at &&
          !!stage &&
          ["running", "queued"].includes(stage.state),
      };
    });
}
