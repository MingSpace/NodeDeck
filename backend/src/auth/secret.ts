import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { env } from "../env.js";
import { dataPath } from "../storage/paths.js";
import { logger } from "../logger.js";

/**
 * Session 签名密钥的获取策略(优先级从高到低):
 *
 * 1. 环境变量 `SESSION_SECRET` 显式设置 — 适用于 k8s Secret 注入 / 想跨实例共享密钥的场景
 * 2. data/secret.key 已存在且 ≥ 16 字符 — 后续启动直接复用,签发的会话不会被踢
 * 3. 都没有 — 用 crypto.randomBytes(48) 生成 base64url(64 字符)写入 data/secret.key
 *
 * 密钥单独成文件(不塞 config.yaml),好处:
 * - admin 密码哈希损坏 / config.yaml 被用户改坏,不会让所有会话失效
 * - reset 功能不会误删(reset 只清 .yaml/.yml/.json)
 * - 用户想强制踢人重新生成,删 secret.key 重启即可
 *
 * 文件权限设为 0600(尽力而为,Windows/某些 FS 失败时静默忽略),避免同主机其他用户读到。
 */

const SECRET_FILE = "secret.key";
const MIN_LENGTH = 16;

let cachedSecret: string | null = null;

export function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;
  cachedSecret = resolveSessionSecret();
  return cachedSecret;
}

/**
 * 在 bootstrap 中显式调一次,让"自动生成密钥"这件事出现在启动日志里,
 * 而不是延迟到第一次登录请求才暴露。
 */
export function ensureSessionSecret(): string {
  return getSessionSecret();
}

function resolveSessionSecret(): string {
  const fromEnv = env.SESSION_SECRET?.trim();
  if (fromEnv && fromEnv.length >= MIN_LENGTH) {
    logger.info({ source: "env" }, "Session secret loaded from SESSION_SECRET env var");
    return fromEnv;
  }

  const path = dataPath(SECRET_FILE);
  if (existsSync(path)) {
    const text = readFileSync(path, "utf8").trim();
    if (text.length >= MIN_LENGTH) {
      logger.info({ source: "file", path }, "Session secret loaded from disk");
      return text;
    }
    logger.warn({ path }, "secret.key 内容过短或损坏,将重新生成");
  }

  const generated = randomBytes(48).toString("base64url");
  writeFileSync(path, generated + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows / 某些 FS 不支持 chmod,忽略
  }
  logger.warn(
    { path },
    "已自动生成 SESSION_SECRET 并写入 data/secret.key。若需跨实例共享,请改用环境变量。",
  );
  return generated;
}

export function __resetForTest(): void {
  cachedSecret = null;
}
