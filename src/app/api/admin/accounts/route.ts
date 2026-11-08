import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, SESSION_COOKIE } from "@/lib/server/auth";
import { adminAccounts, reviewAccount } from "@/lib/server/admin";
import { checkRequestOrigin } from "@/lib/server/request-origin";
import { AppError, assert } from "@/lib/domain";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: NextRequest) {
  try {
    checkRequestOrigin(req.headers, req.nextUrl.protocol);
    const admin = await requireAdmin(req.cookies.get(SESSION_COOKIE)?.value);
    if (req.method === "GET")
      return NextResponse.json(
        { accounts: await adminAccounts() },
        { headers: { "Cache-Control": "no-store" } },
      );
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
    const result = await reviewAccount(
      admin.id,
      body.userId,
      body.action,
      body.expectedStatus,
      body.expectedRole,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof AppError ? error.message : "操作失败，请稍后重试",
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
