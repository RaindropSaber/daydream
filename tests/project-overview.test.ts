import { test } from "node:test";
import assert from "node:assert/strict";
import {
  playableEpisodes,
  episodeCards,
  episodeDisplayRun,
} from "../src/lib/project-overview";
import type { Project } from "../src/lib/types";
const film = (id: string, created: number) => ({
  id,
  created,
  content: { url: `/media/${id}.mp4` },
});

test("a new active draft does not hide the finished episode's playable film", () => {
  const project = {
    episodes: [
      {
        id: "e1",
        title: "第1集",
        number: 1,
        active_run: "draft",
        runs: [
          {
            id: "finished",
            name: "完成方案",
            current_export: film("final", 1),
          },
          { id: "draft", name: "新的修改方案", current_export: null },
        ],
      },
    ],
  } as unknown as Project;
  const result = playableEpisodes(project);
  assert.equal(result.length, 1);
  assert.equal(result[0].run.id, "finished");
  assert.equal(result[0].output.content.url, "/media/final.mp4");
});

test("prefer an active valid film; otherwise use the newest valid film and exclude stale exports", () => {
  const project = {
    episodes: [
      {
        id: "e",
        number: 1,
        active_run: "active",
        runs: [
          { id: "active", current_export: film("active-film", 1) },
          { id: "newer", current_export: film("newer-film", 3) },
          {
            id: "stale",
            current_export: null,
            exports: [film("outdated", 10)],
          },
        ],
      },
    ],
  } as unknown as Project;
  assert.equal(playableEpisodes(project)[0].output.id, "active-film");
  project.episodes[0].active_run = "stale";
  assert.equal(playableEpisodes(project)[0].output.id, "newer-film");
  project.episodes[0].runs.forEach((run) => {
    run.current_export = null;
  });
  assert.deepEqual(playableEpisodes(project), []);
});

test("completed episode list follows episode order without mutating production data", () => {
  const project = {
    episodes: [1, 2].map((number) => ({
      id: `e${number}`,
      number,
      active_run: "r",
      runs: [{ id: "r", current_export: film(`film${number}`, number) }],
    })),
  } as unknown as Project;
  assert.deepEqual(
    playableEpisodes(project).map((item) => item.episode.number),
    [2, 1],
  );
  assert.deepEqual(
    project.episodes.map((episode) => episode.number),
    [1, 2],
  );
});

test("episode cards prefer finished status and only flag newer production schemes", async () => {
  const { newRun } = await import("../src/lib/domain");
  const finished = newRun("成片方案");
  finished.id = "finished";
  finished.finished_at = 1;
  finished.current_export = film("final", 1);
  const active = newRun("修改方案");
  active.id = "active";
  active.statuses = { story: "approved", director: "empty" };
  const fresh = newRun();
  fresh.id = "new";
  const project = {
    episodes: [
      { id: "e1", number: 1, active_run: active.id, runs: [finished, active] },
      { id: "e2", number: 2, active_run: fresh.id, runs: [fresh] },
    ],
  } as unknown as Project;
  const cards = episodeCards(project, []);
  assert.deepEqual(
    cards.map((card) => card.episode.id),
    ["e2", "e1"],
  );
  assert.equal(cards[0].status, "待制作");
  assert.equal(cards[0].film, undefined);
  assert.equal(cards[1].run.id, finished.id);
  assert.equal(cards[1].film!.run.id, finished.id);
  assert.equal(cards[1].step, "complete");
  assert.equal(cards[1].status, "已完成");
  assert.equal(cards[1].working, false);
  assert.equal(cards[1].hasNewVersion, true);
  assert.equal(episodeDisplayRun(project.episodes[0]).id, finished.id);
});

test("a newer active export never replaces a finished scheme's preview", async () => {
  const { newRun } = await import("../src/lib/domain");
  const finished = newRun("方案 A");
  finished.created = 1;
  finished.finished_at = 2;
  finished.current_export = film("final-a", 2);
  const draft = newRun("方案 B");
  draft.created = 3;
  draft.current_export = film("draft-b", 4);
  const project = {
    episodes: [
      { id: "e", number: 1, active_run: draft.id, runs: [finished, draft] },
    ],
  } as unknown as Project;
  assert.equal(playableEpisodes(project)[0].output.id, "final-a");
  const [card] = episodeCards(project, [
    {
      id: "job",
      project_id: "p",
      episode_id: "e",
      run_id: draft.id,
      kind: "finish",
      state: "running",
      created: 5,
      message: "导出中",
    },
  ]);
  assert.equal(card.run.id, finished.id);
  assert.equal(card.status, "已完成");
  assert.equal(card.working, false);
  assert.equal(card.hasNewVersion, true);
  draft.created = 0;
  assert.equal(episodeCards(project, [])[0].hasNewVersion, false);
});

test("card actions distinguish editable, finished, revised and permanently locked episodes", async () => {
  const { newRun } = await import("../src/lib/domain");
  const draft = newRun("草稿");
  const finished = newRun("完成");
  finished.finished_at = 1;
  const episode = { id: "e", number: 1, active_run: draft.id, runs: [draft] };
  const project = { episodes: [episode] } as unknown as Project;
  let card = episodeCards(project, [])[0];
  assert.equal(card.viewRun, undefined);
  assert.equal(card.editableRun?.id, draft.id);
  episode.runs = [finished];
  card = episodeCards(project, [])[0];
  assert.equal(card.viewRun?.id, finished.id);
  assert.equal(card.editableRun, undefined);
  episode.runs.push(draft);
  card = episodeCards(project, [])[0];
  assert.equal(card.viewRun?.id, finished.id);
  assert.equal(card.editableRun?.id, draft.id);
  project.episodes[0].locked_at = 2;
  card = episodeCards(project, [])[0];
  assert.equal(card.viewRun?.id, finished.id);
  assert.equal(card.editableRun, undefined);
  assert.equal(card.status, "已锁定");
});
