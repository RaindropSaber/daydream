import { NextRequest, NextResponse } from "next/server";
import {
  authenticate,
  logout,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from "@/lib/server/auth";
import { checkRequestOrigin } from "@/lib/server/request-origin";
import { AppError, assert } from "@/lib/domain";
export const runtime = "nodejs";
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  try {
    checkRequestOrigin(req.headers, req.nextUrl.protocol);
    const { action } = await context.params;
    assert(["login", "logout"].includes(action), "接口不存在");
    const options = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: req.nextUrl.protocol === "https:",
      path: "/",
    };
    if (action === "logout") {
      await logout(req.cookies.get(SESSION_COOKIE)?.value);
      const response = NextResponse.json({ ok: true });
      response.cookies.set(SESSION_COOKIE, "", { ...options, maxAge: 0 });
      return response;
    }
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
    const result = await authenticate(body);
    if (result.status !== "authenticated")
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    const { token, user, registered } = result;
    await logout(req.cookies.get(SESSION_COOKIE)?.value);
    const response = NextResponse.json(
      { user, registered, status: "authenticated" },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(SESSION_COOKIE, token, {
      ...options,
      maxAge: SESSION_SECONDS,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AppError ? error.message : "登录失败，请稍后重试",
        registrationRequired: error instanceof AppError && error.status === 422,
      },
      {
        status: error instanceof AppError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
