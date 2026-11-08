import { withAccount } from "@/lib/server/account-context";
import { sessionUser, SESSION_COOKIE } from "@/lib/server/auth";
import { NextRequest } from "next/server";
import { mediaResponse } from "@/lib/server/media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const user = await sessionUser(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user)
    return new Response("请先登录", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  return withAccount(user.id, async () =>
    mediaResponse(
      req.method,
      (await context.params).path.join("/"),
      req.headers.get("range"),
    ),
  );
}
export const GET = handle;
export const HEAD = handle;
