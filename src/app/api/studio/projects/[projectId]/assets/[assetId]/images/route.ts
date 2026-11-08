import { NextRequest, NextResponse } from "next/server";
import { requireSession, SESSION_COOKIE } from "@/lib/server/auth";
import { withAccount, assertProjectAccess } from "@/lib/server/account-context";
import { checkRequestOrigin } from "@/lib/server/request-origin";
import { uploadAssetImage } from "@/lib/server/asset-library";
import { AppError, assert } from "@/lib/domain";
export const runtime = "nodejs";
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string; assetId: string }> },
) {
  try {
    checkRequestOrigin(req.headers, req.nextUrl.protocol);
    const user = await requireSession(req.cookies.get(SESSION_COOKIE)?.value);
    return await withAccount(user.id, async () => {
      const { projectId, assetId } = await context.params;
      await assertProjectAccess(projectId);
      const limit = 21 * 1024 * 1024;
      assert(
        Number(req.headers.get("content-length") || 0) <= limit,
        "图片大小需在20MB以内",
      );
      assert(req.body, "请选择图片");
      const reader = req.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          assert(length <= limit, "图片大小需在20MB以内");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const form = await new Request(req.url, {
        method: "POST",
        headers: { "content-type": req.headers.get("content-type") || "" },
        body: Buffer.concat(chunks),
      }).formData();
      const file = form.get("image");
      const version = form.get("version_id");
      assert(
        file instanceof File && typeof version === "string",
        "请选择图片和设定版本",
      );
      const result = await uploadAssetImage(
        projectId,
        assetId,
        version,
        Buffer.from(await file.arrayBuffer()),
      );
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    });
  } catch (error) {
    if (!(error instanceof AppError))
      console.error(
        "Asset upload failed:",
        error instanceof Error ? error.message : "unknown",
      );
    return NextResponse.json(
      { error: error instanceof AppError ? error.message : "上传失败，请重试" },
      { status: error instanceof AppError ? error.status : 500 },
    );
  }
}
