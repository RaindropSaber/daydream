import { ensureInitialAdminSetup } from "../src/lib/server/initial-setup";
import { withAccount } from "../src/lib/server/account-context";
import { sessionUser, sessionToken } from "../src/lib/server/auth";
import next from "next";
import http from "node:http";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import { migrate, database } from "../src/lib/server/db";
import { startWorker } from "../src/lib/server/worker";
import { dataDir } from "../src/lib/server/settings";
import { stopRendering } from "../src/lib/server/render";
import { mediaResponse } from "../src/lib/server/media";
const dev = !process.argv.includes("--production"),
  port = Number(process.env.PORT || 3000),
  hostname = "127.0.0.1";
// Reserve the application port before running migrations or recovering tasks.
const server = http.createServer();
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, hostname, resolve);
});
try {
  await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 });
  await fs.mkdir(dataDir() + "/media", { recursive: true });
  await migrate();
  const initialSetupToken = await ensureInitialAdminSetup();
  const app = next({
    dev,
    hostname,
    port,
    httpServer: server,
    ...(dev ? { webpack: true } : {}),
  });
  await app.prepare();
  const handle = app.getRequestHandler();
  server.on("request", (req, res) => {
    // Next strips Content-Length from route Responses. Serve local media here
    // so HEAD and byte ranges retain the exact file length without buffering.
    if (req.url?.startsWith("/media/")) {
      void (async () => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, { Allow: "GET, HEAD" }).end();
          return;
        }
        const user = await sessionUser(sessionToken(req.headers.cookie));
        if (!user) {
          res.writeHead(401, { "Cache-Control": "no-store" }).end("请先登录");
          return;
        }
        let filename: string;
        try {
          filename = decodeURIComponent(
            new URL(req.url!, "http://localhost").pathname.slice(7),
          );
        } catch {
          res.writeHead(404).end();
          return;
        }
        const result = await withAccount(user.id, () =>
          mediaResponse(req.method!, filename, req.headers.range || null),
        );
        res.writeHead(result.status, Object.fromEntries(result.headers));
        if (!result.body || req.method === "HEAD") res.end();
        else {
          const stream = Readable.fromWeb(
            result.body as import("node:stream/web").ReadableStream,
          );
          stream.on("error", () => res.destroy());
          res.on("close", () => stream.destroy());
          stream.pipe(res);
        }
      })().catch(() => {
        if (res.headersSent) res.destroy();
        else res.writeHead(500).end();
      });
    } else void handle(req, res);
  });
  // The custom Next server installs its upgrade handler on the HTTP server.
  // A second handler would process HMR's WebSocket handshake twice.
  const stopWorker = await startWorker();
  console.log(`Daydream: http://${hostname}:${port}`);
  if (initialSetupToken)
    console.log(
      `首次使用，请初始化管理员（链接 24 小时有效）：\nhttp://${hostname}:${port}/admin/setup?token=${initialSetupToken}`,
    );
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    server.close();
    stopRendering();
    const deadline = setTimeout(() => process.exit(0), 5000);
    deadline.unref();
    await stopWorker();
    await app.close();
    await database().end();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (e) {
  server.close();
  console.error(e instanceof Error ? e.message : e);
  await database()
    .end()
    .catch(() => {});
  process.exit(1);
}
