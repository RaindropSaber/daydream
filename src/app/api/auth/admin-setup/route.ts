import { NextRequest, NextResponse } from "next/server";
import { completeInitialAdminSetup } from "@/lib/server/initial-setup";
import { SESSION_COOKIE, SESSION_SECONDS } from "@/lib/server/auth";
import { checkRequestOrigin } from "@/lib/server/request-origin";
import { AppError, assert } from "@/lib/domain";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    checkRequestOrigin(req.headers, req.nextUrl.protocol);
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
    const result = await completeInitialAdminSetup(body);
    assert(result.status === "authenticated", "初始化失败，请重试");
    const response = NextResponse.json(
      { user: result.user },
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
    response.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AppError ? error.message : "初始化失败，请稍后重试",
      },
      {
        status: error instanceof AppError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
