import { z } from "zod";

// 登录限流默认值:与 docs/deployment.md "安全加固" 小节保持一致。
// 数值偏宽松(只防自动化撞库,不影响正常人偶尔输错),想更严直接改 config.yaml 即可热加载。
export const loginRateLimitSchema = z
  .object({
    enabled: z.boolean().default(true),
    ip_max_fails: z.number().int().positive().default(5),
    ip_window_seconds: z.number().int().positive().default(300),
    ip_lock_seconds: z.number().int().positive().default(1800),
    account_max_fails: z.number().int().positive().default(10),
    account_window_seconds: z.number().int().positive().default(3600),
    account_lock_seconds: z.number().int().positive().default(3600),
  })
  .default({});

export type LoginRateLimitConfig = z.infer<typeof loginRateLimitSchema>;

export const appConfigSchema = z.object({
  admin: z.object({
    username: z.string().min(1).default("admin"),
    password_hash: z.string().min(1),
    must_change_password: z.boolean().default(true),
  }),
  ip_allowlist: z.array(z.string()).default([]),
  public_base_url: z.string().url().optional(),
  default_user_agent: z.string().default("Surge/2400"),
  auth: z
    .object({
      login_rate_limit: loginRateLimitSchema,
    })
    .default({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
