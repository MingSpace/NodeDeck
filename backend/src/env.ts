import { z } from "zod";
import "dotenv/config";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATA_DIR: z.string().default("./data"),
  STATIC_DIR: z.string().optional(),
  INITIAL_PASSWORD: z.string().min(4).default("changeme"),
  // SESSION_SECRET 不再要求必填。环境变量未设置时,backend/src/auth/secret.ts
  // 会在首次启动自动生成一份并持久化到 data/secret.key(0600 权限),
  // 后续启动直接复用。显式设置环境变量仍会优先生效,兼容 k8s Secret 注入等场景。
  SESSION_SECRET: z.string().min(16).optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  LOG_BUFFER_SIZE: z.coerce.number().int().positive().default(2000),
  // 仅本地开发:本机回环请求免登录(auth/dev-bypass.ts),给 agent 验证 UI 用
  DEV_AUTH_BYPASS: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
}).superRefine((e, ctx) => {
  if (e.DEV_AUTH_BYPASS && e.NODE_ENV === "production") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DEV_AUTH_BYPASS"],
      message: "生产环境不允许开启 DEV_AUTH_BYPASS",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
