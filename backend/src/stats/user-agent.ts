import { isIP } from "node:net";

/**
 * 从拉取订阅的 User-Agent 里拆出能看的细节。
 *
 * 订阅客户端的 UA 普遍很短(实测 Surge Mac 是 `Surge Mac/12800 SurgeCore/6011000`),
 * 没有单独的「设备型号」头;只有走系统 HTTP 栈、带标准括号段的 UA(如 Android 的
 * `Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/…)`)才带得出系统版本和机型。
 * 认不出的部分留空,不猜。
 *
 * 在汇总时现算而不是落盘:改进解析规则后,已存的历史 UA 也能用上。
 */
export interface UserAgentDetail {
  /** 主产品的版本号,原样保留(Surge 是纯数字 build 号,前端据此显示成 `build N`) */
  version?: string;
  /** UA 里的其它产品段,如 `SurgeCore 6011000`、`mihomo v1.19.2` */
  components: string[];
  /** 系统,如 `Android 14`、`iOS 18.2`、`Windows` */
  os?: string;
  /** 机型,如 `Pixel 8`、`iPhone`;只有 UA 自己写了才有 */
  device?: string;
}

// 浏览器 / 系统 HTTP 栈的通用段,对认设备没有信息量
const NOISE_PRODUCTS = new Set([
  "mozilla",
  "applewebkit",
  "safari",
  "chrome",
  "gecko",
  "firefox",
  "version",
  "mobile",
  "dalvik",
  "cfnetwork",
  "darwin",
  "okhttp",
  "khtml",
  "like",
]);

const PRODUCT = /([A-Za-z][\w.+-]*)\/(v?[\w.+-]+)/g;

export function describeUserAgent(userAgent: string | undefined): UserAgentDetail {
  const ua = userAgent?.trim() ?? "";
  const detail: UserAgentDetail = { components: [] };
  if (!ua) return detail;

  const paren = /\(([^)]*)\)/.exec(ua)?.[1] ?? "";
  const outside = ua.replace(/\([^)]*\)/g, " ");

  let first = true;
  for (const [, name, version] of outside.matchAll(PRODUCT)) {
    if (NOISE_PRODUCTS.has(name.toLowerCase())) continue;
    if (first) {
      detail.version = version;
      first = false;
      continue;
    }
    detail.components.push(`${name} ${version}`);
  }

  const android = /Android\s+([\d.]+)/i.exec(paren);
  if (android) {
    detail.os = `Android ${android[1]}`;
    const model = /;\s*([^;]+?)\s+Build\//.exec(paren)?.[1]?.trim();
    if (model) detail.device = model;
  } else {
    const ios = /(?:iPhone|CPU) OS (\d+(?:_\d+)*)/.exec(paren);
    const apple = /\b(iPhone|iPad|iPod)\b/.exec(paren)?.[1];
    const mac = /Mac OS X (\d+(?:[_.]\d+)*)/.exec(paren);
    if (ios) detail.os = `${apple === "iPad" ? "iPadOS" : "iOS"} ${ios[1].replace(/_/g, ".")}`;
    else if (mac) detail.os = `macOS ${mac[1].replace(/_/g, ".")}`;
    else if (/Windows/i.test(paren)) detail.os = "Windows";
    else if (/HarmonyOS|OpenHarmony/i.test(paren)) detail.os = "HarmonyOS";
    else if (/Linux/i.test(paren)) detail.os = "Linux";
    if (apple) detail.device = apple;
  }

  // 没有括号段的客户端偶尔把平台写成产品段(如 `Platform/android`);
  // 不认 `Surge iOS/3456` 里那种裸词,那是客户端名的一部分,再显示一遍是重复
  if (!detail.os) {
    const platform = /\b(?:platform|os)[/=](android|windows|linux|macos|ios|harmonyos)\b/i.exec(outside)?.[1];
    if (platform) detail.os = PLATFORM_LABEL[platform.toLowerCase()];
  }
  return detail;
}

const PLATFORM_LABEL: Record<string, string> = {
  android: "Android",
  windows: "Windows",
  linux: "Linux",
  macos: "macOS",
  ios: "iOS",
  harmonyos: "HarmonyOS",
};

/** loopback = 本机(含反代转进来但没带真实 IP 的情况);private = 局域网 / Docker 网桥 / Tailscale 等内网段 */
export type IpScope = "loopback" | "private" | "public" | "unknown";

export function classifyIp(raw: string): IpScope {
  const ip = raw.replace(/^::ffff:/i, "");
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return "loopback";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
    if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT,Tailscale 也用这段
    if (a === 169 && b === 254) return "private";
    return "public";
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return "loopback";
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)) return "private";
    return "public";
  }
  return "unknown";
}
