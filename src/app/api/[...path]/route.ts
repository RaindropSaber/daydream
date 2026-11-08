import { assistForm } from "@/lib/server/form-assistant";
import { NextRequest, NextResponse } from "next/server";
import { AppError, assert } from "@/lib/domain";
import { database } from "@/lib/server/db";
import { checkRequestOrigin } from "@/lib/server/request-origin";
import { modelCatalog } from "@/lib/server/model-catalog";
import { index, project, createProject, mutate } from "@/lib/server/studio";
import {
  updateConfig,
  publicConfig,
  testConnection,
} from "@/lib/server/settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function check(req: NextRequest) {
  checkRequestOrigin(req.headers, req.nextUrl.protocol);
}
async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    check(req);
    const { path } = await context.params;
    let result;
    if (req.method === "GET") {
      if (path.join("/") === "health") {
        await database().query("SELECT 1");
        result = { service: "daydream", status: "ok", database: "sqlite" };
      } else if (path.join("/") === "settings/models/catalog")
        result = await modelCatalog(
          req.nextUrl.searchParams.get("refresh") === "1",
        );
      else if (path.join("/") === "studio") result = await index();
      else if (path[0] === "studio" && path[1] === "projects" && path[2]) {
        result = await project(path[2]);
        if (path[3] === "export")
          result = { ...result, format: "frameflow-v3" };
        else assert(path.length === 3, "接口不存在");
      } else if (
        path.join("/") === "settings/models" ||
        path.join("/") === "config"
      )
        result = await publicConfig();
      else throw new AppError("接口不存在", 404);
    } else {
      assert(
        Number(req.headers.get("content-length") || 0) <= 2_000_000,
        "请求超过2MB",
      );
      const text = await req.text();
      assert(Buffer.byteLength(text) <= 2_000_000, "请求超过2MB");
      let body;
      try {
        body = JSON.parse(text || "{}");
      } catch {
        throw new AppError("请求必须为JSON");
      }
      assert(
        body && typeof body === "object" && !Array.isArray(body),
        "请求格式无效",
      );
      if (path.join("/") === "settings/connections/test")
        result = await testConnection(body);
      else if (
        ["settings/models", "settings/seedance"].includes(path.join("/"))
      )
        result = await updateConfig(body);
      else if (path.join("/") === "studio/assistant")
        result = await assistForm(body);
      else if (path.join("/") === "studio/projects")
        result = await createProject(body);
      else if (
        path.length === 4 &&
        path[0] === "studio" &&
        path[1] === "projects"
      )
        result = await mutate(path[2], path[3], body);
      else throw new AppError("接口不存在", 404);
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (!(error instanceof AppError))
      console.error(
        "API error:",
        error instanceof Error ? error.message : "unknown",
      );
    return NextResponse.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : "请求失败，请检查服务日志",
      },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
export const GET = handle;
export const POST = handle;
