import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, SESSION_COOKIE } from "@/lib/server/auth";
import { database } from "@/lib/server/db";
import { AppError } from "@/lib/domain";
import { checkRequestOrigin } from "@/lib/server/request-origin";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    checkRequestOrigin(req.headers, req.nextUrl.protocol);
    await requireAdmin(req.cookies.get(SESSION_COOKIE)?.value);
    const row = (
      await database().query(
        "SELECT COUNT(*) AS pending FROM users WHERE access_status='pending'",
      )
    ).rows[0];
    return NextResponse.json(row, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof AppError ? error.message : "读取失败" },
      {
        status: error instanceof AppError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
