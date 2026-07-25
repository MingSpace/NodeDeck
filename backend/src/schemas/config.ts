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

// 日志落盘保留天数(按本地日期切文件,今天算 1 天)。
// 3 天足够回溯一次夜间 provider 刷新异常,又不会让 data/logs 无限膨胀;0 = 只留内存。
export const logsConfigSchema = z
  .object({
    retention_days: z.number().int().min(0).max(90).default(3),
  })
  .default({});

export type LogsConfig = z.infer<typeof logsConfigSchema>;

export const appConfigSchema = z.object({
  admin: z.object({
    username: z.string().min(1).default("admin"),
    password_hash: z.string().min(1),
    must_change_password: z.boolean().default(true),
  }),
  // 空字符串条目(Web UI 点了「新增」却没填就保存)会让白名单"非空但匹配不上任何 IP",
  // 而 PUT /api/config 本身也在白名单后面,管理员将被永久锁在设置页外无法自救。
  // 因此读写两侧都在这里统一清洗,顺带自愈磁盘上已经写坏的 config.yaml。
  ip_allowlist: z
    .array(z.string())
    .default([])
    .transform((list) => list.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  public_base_url: z.string().url().optional(),
  default_user_agent: z.string().default("Surge/2400"),
  logs: logsConfigSchema,
  auth: z
    .object({
      login_rate_limit: loginRateLimitSchema,
    })
    .default({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
