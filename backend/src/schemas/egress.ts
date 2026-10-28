import { z } from "zod";
import { idSchema } from "./common.js";

/** 节点源 fetch_via 里代表「服务器直连」的保留字,出口 id 不能占用。 */
export const DIRECT_ROUTE = "direct";

/**
 * 节点源实际的尝试顺序。服务器直连是固定兜底线路,不能去掉:fetch_via 里写了 `direct`
 * 就按写的位置试,没写就排在最后(空 = 只直连)。
 */
export function resolveFetchRoutes(fetchVia: readonly string[] = []): string[] {
  return fetchVia.includes(DIRECT_ROUTE) ? [...fetchVia] : [...fetchVia, DIRECT_ROUTE];
}

export const FETCH_PROXY_PROTOCOLS = ["http:", "https:", "socks5:", "socks:"] as const;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

// 代理型出口的地址。空串视为未填,方便 Web UI 清空字段。
export const fetchProxySchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .url("代理地址格式不对,示例 http://172.18.0.1:18888 或 socks5://127.0.0.1:1080")
    .refine(
      // .url() 失败时 zod 仍会跑 refine,new URL 要兜住
      (s) => URL.canParse(s) && (FETCH_PROXY_PROTOCOLS as readonly string[]).includes(new URL(s).protocol),
      "代理只支持 http:// / https:// / socks5://",
    )
    .optional(),
);

// OpenSSH `ssh-keygen -lf` 同款格式:SHA256: + 43 位无填充 base64
const hostKeySchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .regex(/^SHA256:[A-Za-z0-9+/]{43}$/, "主机指纹格式应为 SHA256:xxxx(43 位)")
    .optional(),
);

/**
 * 「出口」:拉订阅时借用的另一台机器的网络。机场按来源 IP 拦截(境外服务器、机房 IP)时,
 * 节点源在 fetch_via 里按顺序列出要用的出口,前一个失败换下一个。
 *
 * - ssh:NodeDeck 拉取时主动 SSH 到这台机器,借它的网络发请求,用完即断。对方只需开 SSH、
 *   允许 TCP 转发,不用装任何东西,也没有常驻进程。默认用 NodeDeck 自己的密钥登录
 *   (公钥见出口页,providers/egress-key.ts)。
 * - proxy:已经有 http / socks5 代理可用(如出口机主动建的反向隧道),直接填地址。
 */
export const egressSchema = z
  .object({
    id: idSchema.refine((id) => id !== DIRECT_ROUTE, `id 不能是 ${DIRECT_ROUTE}(保留给直连)`),
    name: z.string().trim().min(1),
    type: z.enum(["ssh", "proxy"]),
    // ---- ssh ----
    host: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().trim().min(1).default("root"),
    auth: z.enum(["key", "password"]).default("key"),
    password: z.preprocess(emptyToUndefined, z.string().optional()),
    // 填了就校验对方主机密钥,不符拒连;留空不校验(订阅走 HTTPS,内容本身仍有 TLS 保护)
    host_key: hostKeySchema,
    // ---- proxy ----
    url: fetchProxySchema,
    notes: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.type === "ssh" && !e.host) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "SSH 出口要填主机地址", path: ["host"] });
    }
    if (e.type === "ssh" && e.auth === "password" && !e.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "密码登录要填密码", path: ["password"] });
    }
    if (e.type === "proxy" && !e.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "代理出口要填代理地址", path: ["url"] });
    }
  });

export type Egress = z.infer<typeof egressSchema>;
