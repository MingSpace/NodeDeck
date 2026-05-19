import bcrypt from "bcryptjs";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { configPath } from "./paths.js";
import { readYaml, writeYaml } from "./yaml-io.js";
import { appConfigSchema, type AppConfig } from "../schemas/config.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { getCache, setCache, invalidate } from "./cache.js";

const CACHE_NS = "app-config";
const CACHE_KEY = "single";

export async function loadConfig(): Promise<AppConfig> {
  const path = configPath();
  if (existsSync(path)) {
    const stats = await stat(path);
    const cached = getCache<AppConfig>(CACHE_NS, CACHE_KEY, stats.mtimeMs);
    if (cached) return cached;
    const raw = await readYaml<unknown>(path);
    if (raw) {
      const result = appConfigSchema.safeParse(raw.data);
      if (result.success) {
        setCache<AppConfig>(CACHE_NS, CACHE_KEY, raw.mtimeMs, result.data);
        return result.data;
      }
      logger.warn({ errors: result.error.flatten() }, "config.yaml invalid; regenerating from defaults");
    }
  }
  const cfg = await initDefaultConfig();
  return cfg;
}

export async function saveConfig(cfg: AppConfig): Promise<AppConfig> {
  const parsed = appConfigSchema.parse(cfg);
  await writeYaml(configPath(), parsed);
  invalidate(CACHE_NS);
  return parsed;
}

async function initDefaultConfig(): Promise<AppConfig> {
  const initialPassword = env.INITIAL_PASSWORD || "changeme";
  const hash = await bcrypt.hash(initialPassword, 10);
  // 让 schema 的 .default() 链替我们填默认值,避免在两处维护
  const cfg = appConfigSchema.parse({
    admin: {
      username: "admin",
      password_hash: hash,
      must_change_password: true,
    },
    public_base_url: env.PUBLIC_BASE_URL,
  });
  await saveConfig(cfg);
  logger.warn(
    "Initial admin config written. Please log in and change the password immediately.",
  );
  return cfg;
}
