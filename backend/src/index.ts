import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { ensureDataDirs } from "./storage/paths.js";
import { startWatcher } from "./storage/watcher.js";
import { startProviderScheduler } from "./providers/scheduler.js";
import { mountApiRoutes } from "./routes/api.js";
import { mountSubRoute } from "./routes/sub.js";

async function bootstrap() {
  await ensureDataDirs(env.DATA_DIR);
  logger.info({ dataDir: resolve(env.DATA_DIR) }, "Data directory ready");

  const app = new Hono();

  app.use("*", honoLogger((message: string) => logger.info(message)));

  app.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

  mountApiRoutes(app);
  mountSubRoute(app);

  const staticDir = resolveStaticDir();
  if (staticDir) {
    logger.info({ staticDir }, "Serving frontend SPA");
    const indexHtml = readFileSync(`${staticDir}/index.html`, "utf8");
    app.use(
      "/assets/*",
      serveStatic({ root: relativizeForHono(staticDir) }),
    );
    app.get("/", (c) => c.html(indexHtml));
    app.get("*", (c) => {
      // SPA fallback for client routes
      if (c.req.path.startsWith("/api") || c.req.path.startsWith("/sub")) {
        return c.notFound();
      }
      return c.html(indexHtml);
    });
  } else {
    logger.warn("No frontend dist found. Run `pnpm -F frontend build` for production. In dev, use vite proxy.");
  }

  startWatcher();
  startProviderScheduler();

  serve({ fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" }, (info) => {
    logger.info({ port: info.port }, `MConvert listening on http://0.0.0.0:${info.port}`);
  });
}

function resolveStaticDir(): string | null {
  const candidates = [
    env.STATIC_DIR,
    resolve(process.cwd(), "public"),
    resolve(process.cwd(), "..", "public"),
    resolve(process.cwd(), "../frontend/dist"),
    resolve(process.cwd(), "frontend/dist"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}

function relativizeForHono(absDir: string): string {
  // hono serveStatic resolves relative to cwd
  const cwd = process.cwd();
  if (absDir.startsWith(cwd)) {
    return absDir.slice(cwd.length).replace(/^\/+/, "") + "/";
  }
  return absDir + "/";
}

bootstrap().catch((err) => {
  logger.error({ err }, "Failed to bootstrap");
  process.exit(1);
});
