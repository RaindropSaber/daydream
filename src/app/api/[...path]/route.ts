import { withAccount, assertProjectAccess } from "@/lib/server/account-context";
import { requireSession, SESSION_COOKIE } from "@/lib/server/auth";
import {
  novelTask,
  controlNovel,
  assistNovelPlan,
  assistNovelTask,
} from "@/lib/server/novel";
import {
  projectStory,
  createStory,
  saveStory,
  assistStory,
} from "@/lib/server/stories";
import { assistForm } from "@/lib/server/form-assistant";
import { storyboardAssistant } from "@/lib/server/storyboard-assistant";
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
    if (path.join("/") === "health" && req.method === "GET") {
      await database().query("SELECT 1");
      return NextResponse.json({
        service: "daydream",
        status: "ok",
        database: "sqlite",
      });
    }
    const user = await requireSession(req.cookies.get(SESSION_COOKIE)?.value);
    return await withAccount(user.id, async () => {
      if (path[0] === "studio" && path[1] === "projects" && path[2])
        await assertProjectAccess(path[2]);
      let result;
      if (req.method === "GET") {
        if (path.join("/") === "settings/models/catalog")
          result = await modelCatalog(
            req.nextUrl.searchParams.get("refresh") === "1",
          );
        else if (
          path.length === 4 &&
          path[0] === "studio" &&
          path[1] === "projects" &&
          path[3] === "story"
        ) {
          const revision = req.nextUrl.searchParams.get("revision");
          const current = revision
            ? (
                await database().query(
                  "SELECT revision FROM stories WHERE project_id=$1",
                  [path[2]],
                )
              ).rows[0]
            : null;
          result =
            current && String(current.revision) === revision
              ? { unchanged: true, task: await novelTask(path[2]) }
              : {
                  story: await projectStory(path[2]),
                  task: await novelTask(path[2]),
                };
        } else if (path.join("/") === "studio") result = await index();
        else if (path[0] === "studio" && path[1] === "projects" && path[2]) {
          result = await project(path[2]);
          if (path[3] === "export")
            result = {
              ...result,
              story: await projectStory(path[2]),
              format: "frameflow-v3",
            };
          else assert(path.length === 3, "接口不存在");
        } else if (
          path.join("/") === "settings/models" ||
          path.join("/") === "config"
        )
          result = await publicConfig();
        else throw new AppError("接口不存在", 404);
      } else {
        const bodyLimit =
          path[0] === "studio" && path[1] === "projects" && path[3] === "story"
            ? 192_000_000
            : 2_000_000;
        assert(
          Number(req.headers.get("content-length") || 0) <= bodyLimit,
          "请求内容过大",
        );
        const text = await req.text();
        assert(Buffer.byteLength(text) <= bodyLimit, "请求内容过大");
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
        else if (
          path.length === 5 &&
          path[0] === "studio" &&
          path[1] === "projects" &&
          path[3] === "story" &&
          path[4] === "novel"
        )
          result = await controlNovel(path[2], body);
        else if (
          path.length === 5 &&
          path[0] === "studio" &&
          path[1] === "projects" &&
          path[3] === "story" &&
          ["assist", "plan-assist", "task-assist"].includes(path[4])
        )
          result =
            path[4] === "task-assist"
              ? await assistNovelTask(path[2], body)
              : path[4] === "plan-assist"
                ? await assistNovelPlan(path[2], body)
                : await assistStory(path[2], body);
        else if (
          path.length === 4 &&
          path[0] === "studio" &&
          path[1] === "projects" &&
          path[3] === "story"
        )
          result =
            body.action === "create"
              ? await createStory(path[2], body)
              : await saveStory(path[2], body);
        else if (path.join("/") === "studio/assistant")
          result = await assistForm(body);
        else if (path.join("/") === "studio/projects")
          result = await createProject(body);
        else if (
          path.length === 4 &&
          path[0] === "studio" &&
          path[1] === "projects" &&
          path[3] === "storyboard-assist"
        )
          result = await storyboardAssistant(path[2], body);
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
