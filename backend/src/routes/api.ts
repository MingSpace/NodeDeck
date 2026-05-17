import type { Hono } from "hono";
import { authRouter } from "./auth.js";
import { entitiesRouter } from "./entities.js";
import { providerActionsRouter } from "./provider-actions.js";
import { dashboardRouter } from "./dashboard.js";
import { importRouter } from "./import.js";
import { profilePreviewRouter } from "./profile-preview.js";
import { configRouter } from "./config.js";
import { logsRouter } from "./logs.js";
import { requireSession, ipAllowlist } from "../auth/middleware.js";

export function mountApiRoutes(app: Hono): void {
  app.get("/api/health", (c) => c.json({ ok: true, service: "nodedeck" }));
  app.get("/api/version", (c) => c.json({ version: "0.1.0" }));

  // Auth routes (login is public, others guarded inside)
  app.route("/api/auth", authRouter);

  // Everything below requires session + ip allowlist
  app.use("/api/entities/*", ipAllowlist, requireSession);
  app.use("/api/providers/*", ipAllowlist, requireSession);
  app.use("/api/dashboard/*", ipAllowlist, requireSession);
  app.use("/api/import/*", ipAllowlist, requireSession);
  app.use("/api/profiles/*", ipAllowlist, requireSession);
  app.use("/api/config/*", ipAllowlist, requireSession);
  app.use("/api/config", ipAllowlist, requireSession);
  app.use("/api/logs/*", ipAllowlist, requireSession);

  app.route("/api/entities", entitiesRouter);
  app.route("/api/providers", providerActionsRouter);
  app.route("/api/dashboard", dashboardRouter);
  app.route("/api/import", importRouter);
  app.route("/api/profiles", profilePreviewRouter);
  app.route("/api/config", configRouter);
  app.route("/api/logs", logsRouter);
}
