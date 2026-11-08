import { NextRequest, NextResponse } from "next/server";
import { changeAccountPassword } from "@/lib/server/account";
import { requireSession, SESSION_COOKIE } from "@/lib/server/auth";
import { AppError, assert } from "@/lib/domain";
import { checkRequestOrigin } from "@/lib/server/request-origin";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    checkRequestOrigin(req.headers, req.nextUrl.protocol);
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    await requireSession(token);
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
    const result = await changeAccountPassword(token, body);
    const response = NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: req.nextUrl.protocol === "https:",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : "修改密码失败，请稍后重试",
      },
      {
        status: error instanceof AppError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
