import type { Json } from "./types";

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
export function sequenceShots(shots: Json[]): Json[] {
  let start = 0;
  return shots.map((shot) => {
    const duration = round(shot.end - shot.start);
    const next = { ...shot, start, end: round(start + duration) };
    start = next.end;
    return next;
  });
}

// Editing a duration shifts subsequent shots, keeping the sequence gap-free.
export function resizeShot(
  shots: Json[],
  shotId: string,
  duration: number,
): Json[] {
  if (!Number.isFinite(duration) || duration < 0.1) return shots;
  return sequenceShots(
    shots.map((shot) =>
      shot.id === shotId
        ? { ...shot, end: round(shot.start + duration) }
        : shot,
    ),
  );
}
export function insertShot(
  shots: Json[],
  shot: Json,
  referenceId: string,
  side: "before" | "after",
): Json[] {
  const reference = shots.findIndex((item) => item.id === referenceId);
  const index =
    reference < 0 ? shots.length : reference + (side === "after" ? 1 : 0);
  const next = [...shots];
  next.splice(index, 0, shot);
  return sequenceShots(next);
}
export function deleteShot(shots: Json[], shotId: string): Json[] {
  return sequenceShots(shots.filter((shot) => shot.id !== shotId));
}
