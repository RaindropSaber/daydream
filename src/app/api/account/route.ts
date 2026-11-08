import { NextRequest, NextResponse } from "next/server";
import { accountProfile, updateAccountName } from "@/lib/server/account";
import { requireSession, SESSION_COOKIE } from "@/lib/server/auth";
import { AppError, assert } from "@/lib/domain";
import { checkRequestOrigin } from "@/lib/server/request-origin";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(req: NextRequest) {
  try {
    checkRequestOrigin(req.headers, req.nextUrl.protocol);
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    await requireSession(token);
    if (req.method === "GET")
      return NextResponse.json(await accountProfile(token), {
        headers: { "Cache-Control": "no-store" },
      });
    assert(
      Number(req.headers.get("content-length") || 0) <= 4096,
      "请求内容过大",
    );
    const text = await req.text();
    assert(Buffer.byteLength(text) <= 4096, "请求内容过大");
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AppError("请求格式无效");
    }
    assert(
      body && typeof body === "object" && !Array.isArray(body),
      "请求格式无效",
    );
    return NextResponse.json(await updateAccountName(token, body), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AppError ? error.message : "保存失败，请稍后重试",
      },
      {
        status: error instanceof AppError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
export const GET = handle;
export const POST = handle;
