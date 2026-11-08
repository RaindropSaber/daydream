import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { mediaPath } from "./files";
export async function mediaResponse(
  method: string,
  filename: string,
  range: string | null,
) {
  let file: string;
  try {
    file = await mediaPath(filename);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const stat = await fs.stat(file);
  if (!stat.isFile()) return new Response("Not found", { status: 404 });
  let start = 0,
    end = stat.size - 1;
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    let valid = !!m && (!!m[1] || !!m[2]);
    if (valid && m) {
      if (m[1]) {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
      } else start = Math.max(0, stat.size - Number(m[2]));
      valid =
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        0 <= start &&
        start <= end &&
        end < stat.size;
    }
    if (!valid)
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${stat.size}`,
          "Content-Length": "0",
        },
      });
  }
  const types: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".srt": "application/x-subrip; charset=utf-8",
    ".ass": "text/plain; charset=utf-8",
  };
  const headers: Record<string, string> = {
    "Content-Type": types[path.extname(file)] || "application/octet-stream",
    "Content-Length": String(Math.max(0, end - start + 1)),
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  return new Response(
    method === "HEAD" || !stat.size
      ? null
      : (Readable.toWeb(
          createReadStream(file, { start, end }),
        ) as ReadableStream),
    { status: range ? 206 : 200, headers },
  );
}
