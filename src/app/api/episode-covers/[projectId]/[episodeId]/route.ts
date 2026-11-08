import { NextRequest } from "next/server";
import { episodeCover } from "@/lib/server/episode-cover";
import { checkRequestOrigin } from "@/lib/server/request-origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) {
  try {
    checkRequestOrigin(req.headers, req.nextUrl.protocol);
    const { projectId, episodeId } = await context.params;
    const data = await episodeCover(projectId, episodeId);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("封面暂不可用", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
