import next from "next";
import http from "node:http";
import fs from "node:fs/promises";
import { migrate, database } from "../src/lib/server/db";
import { startWorker } from "../src/lib/server/worker";
import { dataDir } from "../src/lib/server/settings";
import { stopRendering } from "../src/lib/server/render";
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
  await fs.mkdir(dataDir() + "/media", { recursive: true });
  await migrate();
  const app = next({ dev, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  server.on("request", (req, res) => void handle(req, res));
  const upgrade = app.getUpgradeHandler();
  server.on("upgrade", upgrade);
  const stopWorker = await startWorker();
  console.log(`Daydream: http://${hostname}:${port}`);
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
